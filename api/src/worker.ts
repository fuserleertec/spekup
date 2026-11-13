import { pathToFileURL } from "node:url";
import { pool } from "./db.js";
import { assertProductionSecrets } from "./secrets.js";
import { migrate } from "./migrate.js";
import { publishDue } from "./studio.js";
import { processStudioRender } from "./studio-render.js";
import { outputKey, posterKey, privateKey, publicError, safeMediaFile, transcodeToReady, videoLimits } from "./video.js";

type VideoRow = {
  id: string;
  original_key: string;
  audio_codec: string | null;
  attempts: number;
  purpose: string;
};

async function claim(): Promise<VideoRow | null> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query<VideoRow>(
      `select id, original_key, audio_codec, attempts, purpose
       from videos
       where attempts < $1 and (
         status = 'queued'
         or (status = 'processing' and locked_at < now() - interval '2 minutes')
       )
       order by created_at
       for update skip locked
       limit 1`,
      [videoLimits().maxAttempts],
    );
    const row = found.rows[0];
    if (!row) {
      await client.query("commit");
      return null;
    }
    await client.query(
      `update videos set status = 'processing', attempts = attempts + 1, locked_at = now(), updated_at = now() where id = $1`,
      [row.id],
    );
    await client.query("commit");
    return { ...row, attempts: row.attempts + 1 };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function processNext() {
  const row = await claim();
  if (!row) return false;
  const source = safeMediaFile(row.original_key);
  try {
    if (!source || !row.original_key.startsWith("private/")) throw new Error("Original clip is missing.");
    const demo = row.purpose === "listing_demo";
    const prepared = await transcodeToReady(row.id, source, Boolean(row.audio_codec), demo ? { mute: true, maxSeconds: 15 } : undefined);
    await pool.query(
      `update videos
       set status = 'ready', output_key = $2, poster_key = $3, duration_ms = $4, width = $5, height = $6,
           audio_codec = case when $7 then null else audio_codec end,
           error = null, locked_at = null, updated_at = now()
       where id = $1`,
      [row.id, prepared.output, prepared.poster, prepared.durationMs, prepared.width, prepared.height, demo],
    );
  } catch (err) {
    const message = publicError(err);
    const status = row.attempts >= videoLimits().maxAttempts ? "failed" : "queued";
    await pool.query(
      `update videos set status = $2, error = $3, locked_at = null, updated_at = now() where id = $1`,
      [row.id, status, message],
    );
  }
  return true;
}

export async function workForever() {
  await migrate();
  for (;;) {
    const did = await processNext().catch((err) => {
      console.error(publicError(err));
      return false;
    });
    const studio = await processStudioRender().catch((err) => {
      console.error(publicError(err));
      return false;
    });
    const published = await publishDue().catch((err) => {
      console.error(publicError(err));
      return false;
    });
    if (!did && !studio && !published) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invoked === import.meta.url) {
  try { assertProductionSecrets({ proxy: false }); } catch (err) { console.error(err); process.exit(1); }
  workForever().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export const readyPaths = { outputKey, posterKey, privateKey };
