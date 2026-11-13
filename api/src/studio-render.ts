import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { one, pool, q } from "./db.js";
import { ensureMediaDirs, outputKey, posterKey, privateKey, probeFile, publicError, runTool, safeMediaFile, videoLimits, VIDEO_MAX_BYTES, VIDEO_MAX_DURATION_MS, VIDEO_MIN_DURATION_MS } from "./video.js";

export const SPEEDS = [0.5, 1, 1.5, 2] as const;
export type Speed = (typeof SPEEDS)[number];

const PTS: Record<Speed, string> = { 0.5: "2", 1: "1", 1.5: "2/3", 2: "1/2" };
const ATEMPO: Record<Speed, string> = { 0.5: "0.5", 1: "1.0", 1.5: "1.5", 2: "2.0" };
const SAFE_TEXT = /^[A-Za-z0-9 .,!?'"()#&+\-/]{1,120}$/;

export function isSpeed(value: number): value is Speed {
  return SPEEDS.includes(value as Speed);
}

export function renderedDurationMs(segments: Array<{ startMs: number; endMs: number; speed: number }>) {
  let total = 0;
  for (const segment of segments) {
    if (!isSpeed(segment.speed)) throw new Error("Speed must be 0.5, 1, 1.5, or 2.");
    const span = segment.endMs - segment.startMs;
    if (!Number.isInteger(segment.startMs) || !Number.isInteger(segment.endMs) || span < 200) {
      throw new Error("Each piece must be at least 0.2 seconds.");
    }
    total += span / segment.speed;
  }
  const ms = Math.round(total);
  if (ms < VIDEO_MIN_DURATION_MS || ms > VIDEO_MAX_DURATION_MS) {
    throw new Error(`The rendered clip would be ${(ms / 1000).toFixed(1)} seconds. The limit is 0.2 to 30 seconds after speed changes, and it was not raised.`);
  }
  return ms;
}

export function assertPlainText(value: string, max: number) {
  const text = value.trim();
  if (!text || text.length > max || !SAFE_TEXT.test(text)) {
    throw new Error("Use plain words and simple punctuation only.");
  }
  return text;
}

export function parseCaptionFile(raw: string) {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r/g, "").slice(0, 20_000);
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const cues: Array<{ startMs: number; endMs: number; text: string }> = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter((line) => line && !/^WEBVTT|^NOTE|^STYLE|^REGION/i.test(line) && !/^\d+$/.test(line));
    const timing = lines.find((line) => line.includes("-->"));
    if (!timing) continue;
    const [start, end] = timing.split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const body = lines.filter((line) => !line.includes("-->")).join(" ").replace(/<[^>]*>/g, "").trim();
    if (!start || !end || !body) continue;
    cues.push({ startMs: cueTime(start), endMs: cueTime(end), text: assertPlainText(body, 120) });
    if (cues.length > 40) throw new Error("Import at most 40 captions.");
  }
  if (!cues.length) throw new Error("No captions were found in that file.");
  return cues;
}

function cueTime(value: string) {
  const match = value.match(/^(?:(\d{2}):)?(\d{2}):(\d{2})[.](\d{1,3})$/);
  if (!match) throw new Error("A caption time was not understood.");
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4].padEnd(3, "0"));
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

export function captionFont() {
  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  ];
  return candidates.find((file) => existsSync(file)) || null;
}

function escapeDrawtext(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/%/g, "\\%");
}

export function segmentVideoFilter(speed: Speed) {
  return `setpts=${PTS[speed]}*PTS,scale=min(720\\,iw):-2,fps=30`;
}

type SegmentRow = { video_id: string; start_ms: number; end_ms: number; speed: number; output_key: string | null; audio_codec: string | null; status: string; duration_ms: number };
type OverlayRow = { start_ms: number; end_ms: number; text: string; x_pct: number; y_pct: number; size: string };
type CaptionRow = { start_ms: number; end_ms: number; text: string };

export async function processStudioRender() {
  const job = await claimJob();
  if (!job) return false;
  const dir = await mkdtemp(path.join(tmpdir(), "cv-studio-"));
  try {
    const project = await one<Record<string, unknown>>("select * from studio_projects where id = $1 and deleted_at is null", [job.project_id]);
    if (!project) throw new Error("Project is missing.");
    const segments = await q<SegmentRow>(
      `select s.video_id, s.start_ms, s.end_ms, s.speed, v.output_key, v.audio_codec, v.status, v.duration_ms
       from studio_segments s join videos v on v.id = s.video_id
       where s.project_id = $1 order by s.position`,
      [job.project_id],
    );
    if (!segments.length) throw new Error("Add at least one clip.");
    if (segments.some((segment) => segment.status === "failed")) throw new Error("A source clip could not be prepared.");
    if (segments.some((segment) => segment.status !== "ready" || !segment.output_key)) {
      await q("update studio_jobs set status = 'queued', locked_at = null, error = $2 where id = $1 and status = 'running'", [job.id, "Waiting for source clips to be prepared."]);
      return true;
    }
    const planned = renderedDurationMs(segments.map((segment) => ({ startMs: segment.start_ms, endMs: segment.end_ms, speed: Number(segment.speed) })));
    const overlays = await q<OverlayRow>("select start_ms, end_ms, text, x_pct, y_pct, size from studio_overlays where project_id = $1 order by position", [job.project_id]);
    const captions = await q<CaptionRow>("select start_ms, end_ms, text from studio_captions where project_id = $1 order by position", [job.project_id]);
    const voice = project.voiceover_id
      ? await one<{ storage_key: string; owner_id: string }>("select storage_key, owner_id from studio_audio where id = $1", [project.voiceover_id])
      : null;
    if (voice && voice.owner_id !== project.owner_id) throw new Error("That recording is not yours.");
    const pieces: string[] = [];
    for (let i = 0; i < segments.length; i += 1) {
      const segment = segments[i];
      const source = safeMediaFile(segment.output_key || "");
      if (!source || !segment.output_key?.startsWith("ready/")) throw new Error("A source clip is missing.");
      if (segment.end_ms > segment.duration_ms + 50) throw new Error("A trim goes past the end of a source clip.");
      const out = path.join(dir, `part-${i}.mp4`);
      await renderPiece(source, segment, out);
      pieces.push(out);
    }
    const joined = path.join(dir, "joined.mp4");
    await concatPieces(pieces, joined, path.join(dir, "list.txt"));
    const mixed = path.join(dir, "mixed.mp4");
    await mixAudio(joined, mixed, voice ? safeMediaFile(voice.storage_key) : null, Number(project.original_volume), Number(project.voice_volume));
    const font = captionFont();
    const burn = project.caption_mode === "burn_in" ? captions : [];
    if ((burn.length || overlays.length) && !font) {
      throw new Error("Burned-in words need a font on the server. Use a caption track instead. Automatic transcription is not connected.");
    }
    const pictured = path.join(dir, "picture.mp4");
    if (font && (burn.length || overlays.length)) await burnText(mixed, pictured, font, overlays, burn);
    else await runTool("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", mixed, "-c", "copy", pictured], timeout());
    const stat = await readFile(pictured);
    if (stat.length > VIDEO_MAX_BYTES) throw new Error("The rendered clip is over 40 MB. Shorten it. The limit was not raised.");
    const checked = await probeFile(pictured);
    if (checked.durationMs > VIDEO_MAX_DURATION_MS + 500 || checked.durationMs < VIDEO_MIN_DURATION_MS) {
      throw new Error(`The rendered clip is ${(checked.durationMs / 1000).toFixed(1)} seconds. The limit is 0.2 to 30 seconds, and it was not raised.`);
    }
    const current = await one<{ status: string; edit_version: number }>("select status, edit_version from studio_jobs where id = $1", [job.id]);
    const projectNow = await one<{ edit_version: number }>("select edit_version from studio_projects where id = $1", [job.project_id]);
    if (!current || current.status === "canceled" || projectNow?.edit_version !== job.edit_version) {
      await q("update studio_jobs set status = 'canceled', error = $2, finished_at = now(), locked_at = null where id = $1 and status = 'running'", [job.id, "The edit changed before the render finished. Nothing was published."]);
      return true;
    }
    const videoId = randomUUID();
    await ensureMediaDirs();
    const original = safeMediaFile(privateKey(videoId));
    const ready = safeMediaFile(outputKey(videoId));
    const poster = safeMediaFile(posterKey(videoId));
    if (!original || !ready || !poster) throw new Error("Refusing to write outside media storage.");
    await writeFile(original, stat, { mode: 0o600 });
    await writeFile(ready, stat, { mode: 0o644 });
    await coverFrame(pictured, poster, Math.min(Number(project.cover_time_ms) || 0, checked.durationMs), String(project.cover_headline || ""), font);
    await pool.query("begin");
    await pool.query(
      `insert into videos (id, owner_id, status, original_key, output_key, poster_key, container, video_codec, audio_codec, byte_size, duration_ms, width, height, attempts, purpose)
       values ($1,$2,'ready',$3,$4,$5,'mp4','h264',$6,$7,$8,$9,$10,1,'render')`,
      [videoId, project.owner_id, privateKey(videoId), outputKey(videoId), posterKey(videoId), checked.audioCodec, stat.length, checked.durationMs, checked.width, checked.height],
    );
    await pool.query(
      `update studio_projects set output_video_id = $2, rendered_version = $3, status = 'ready', updated_at = now() where id = $1`,
      [job.project_id, videoId, job.edit_version],
    );
    await pool.query(
      `insert into studio_revisions (project_id, version, snapshot)
       values ($1, $2, $3)
       on conflict (project_id, version) do update set snapshot = excluded.snapshot`,
      [job.project_id, job.edit_version, JSON.stringify({ plannedMs: planned, segments: segments.length, overlays: overlays.length, captions: captions.length })],
    );
    await pool.query("update studio_jobs set status = 'ready', finished_at = now(), locked_at = null, error = null where id = $1", [job.id]);
    await pool.query("delete from studio_revisions where project_id = $1 and version < $2", [job.project_id, Math.max(1, job.edit_version - 7)]);
    await pool.query("commit");
  } catch (err) {
    await pool.query("rollback").catch(() => undefined);
    const message = publicError(err);
    const failed = job.attempt >= 2 ? "failed" : "queued";
    await q("update studio_jobs set status = $2, error = $3, locked_at = null, finished_at = case when $2 = 'failed' then now() else null end where id = $1", [job.id, failed, message]);
    if (failed === "failed") await q("update studio_projects set status = 'failed', updated_at = now() where id = $1 and status = 'rendering'", [job.project_id]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return true;
}

async function claimJob() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `update studio_jobs set status = 'queued', locked_at = null
       where status = 'running' and locked_at < now() - interval '3 minutes' and attempt < 2`,
    );
    const found = await client.query<{ id: string; project_id: string; edit_version: number; attempt: number }>(
      `select id, project_id, edit_version, attempt from studio_jobs
       where kind = 'render' and status = 'queued'
       order by created_at
       for update skip locked
       limit 1`,
    );
    const row = found.rows[0];
    if (!row) {
      await client.query("commit");
      return null;
    }
    await client.query("update studio_jobs set status = 'running', attempt = attempt + 1, locked_at = now() where id = $1", [row.id]);
    await client.query("update studio_projects set status = 'rendering', updated_at = now() where id = $1", [row.project_id]);
    await client.query("commit");
    return { ...row, attempt: row.attempt + 1 };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

function timeout() {
  return Number(process.env.STUDIO_FFMPEG_TIMEOUT_MS || 90_000);
}

async function renderPiece(source: string, segment: SegmentRow, out: string) {
  const speed = Number(segment.speed) as Speed;
  const start = (segment.start_ms / 1000).toFixed(3);
  const end = (segment.end_ms / 1000).toFixed(3);
  const filter = segmentVideoFilter(speed);
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-ss", start, "-to", end, "-i", source];
  if (segment.audio_codec) {
    args.push("-filter_complex", `[0:v]${filter}[v];[0:a]atempo=${ATEMPO[speed]}[a]`, "-map", "[v]", "-map", "[a]");
  } else {
    const dur = ((segment.end_ms - segment.start_ms) / speed / 1000).toFixed(3);
    args.push("-f", "lavfi", "-t", dur, "-i", "anullsrc=channel_layout=stereo:sample_rate=48000", "-filter_complex", `[0:v]${filter}[v]`, "-map", "[v]", "-map", "1:a", "-shortest");
  }
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", out);
  await runTool("ffmpeg", args, timeout());
}

async function concatPieces(pieces: string[], out: string, list: string) {
  if (pieces.length === 1) {
    await runTool("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", pieces[0], "-c", "copy", out], timeout());
    return;
  }
  await writeFile(list, pieces.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"));
  await runTool("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out], timeout());
}

async function mixAudio(input: string, out: string, voice: string | null, originalVolume: number, voiceVolume: number) {
  const original = volumeArg(originalVolume);
  if (!voice) {
    await runTool("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-filter:a", `volume=${original}`, "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", out], timeout());
    return;
  }
  const spoken = volumeArg(voiceVolume);
  await runTool("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", input, "-i", voice,
    "-filter_complex", `[0:a]volume=${original}[a0];[1:a]volume=${spoken},apad[a1];[a0][a1]amix=inputs=2:duration=first:normalize=0[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", "-shortest", out,
  ], timeout());
}

function volumeArg(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error("Volume must be between 0 and 1.");
  return value.toFixed(2);
}

async function burnText(input: string, out: string, font: string, overlays: OverlayRow[], captions: CaptionRow[]) {
  const filters = [
    ...overlays.map((item) => draw(font, item.text, item.start_ms, item.end_ms, item.x_pct, item.y_pct, item.size === "large" ? 36 : item.size === "small" ? 18 : 26)),
    ...captions.map((item) => draw(font, item.text, item.start_ms, item.end_ms, 50, 88, 22)),
  ];
  await runTool("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-vf", filters.join(","), "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "copy", out], timeout());
}

function draw(font: string, text: string, start: number, end: number, x: number, y: number, size: number) {
  const safe = escapeDrawtext(assertPlainText(text, 120));
  return `drawtext=fontfile='${font}':text='${safe}':fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.45:x=(w-text_w)*${(x / 100).toFixed(2)}:y=(h-text_h)*${(y / 100).toFixed(2)}:enable='between(t,${(start / 1000).toFixed(3)},${(end / 1000).toFixed(3)})'`;
}

async function coverFrame(input: string, poster: string, timeMs: number, headline: string, font: string | null) {
  const frame = `${poster}.frame.jpg`;
  await runTool("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", (timeMs / 1000).toFixed(3), "-i", input, "-frames:v", "1", "-q:v", "3", frame], videoLimits().probeTimeoutMs);
  if (headline && font) {
    const safe = escapeDrawtext(assertPlainText(headline, 80));
    await runTool("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", frame, "-vf", `drawtext=fontfile='${font}':text='${safe}':fontsize=28:fontcolor=white:box=1:boxcolor=black@0.5:x=(w-text_w)/2:y=h-th-16`, poster], videoLimits().probeTimeoutMs);
    await rm(frame, { force: true });
    return;
  }
  const { rename } = await import("node:fs/promises");
  await rename(frame, poster);
}

export async function probeAudio(file: string) {
  const limits = videoLimits();
  const { stdout } = await runTool("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], limits.probeTimeoutMs);
  const parsed = JSON.parse(stdout) as { format?: { format_name?: string; duration?: string }; streams?: Array<{ codec_type?: string; codec_name?: string }> };
  const audios = (parsed.streams || []).filter((stream) => stream.codec_type === "audio");
  const videos = (parsed.streams || []).filter((stream) => stream.codec_type === "video");
  if (videos.length || audios.length !== 1) throw new Error("Use one audio recording and no picture.");
  const codec = audios[0].codec_name || "";
  if (!["aac", "opus", "vorbis", "mp3", "pcm_s16le"].includes(codec)) throw new Error("Use AAC, Opus, Vorbis, MP3, or WAV audio.");
  const durationMs = Math.round(Number(parsed.format?.duration) * 1000);
  if (!Number.isFinite(durationMs) || durationMs < 200 || durationMs > VIDEO_MAX_DURATION_MS) {
    throw new Error("A recording must be between 0.2 and 30 seconds.");
  }
  return { durationMs, codec, mime: parsed.format?.format_name || codec };
}
