import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [814185]);
    await client.query(`create table if not exists schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )`);
    const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const filename of files) {
      const seen = await client.query("select 1 from schema_migrations where filename = $1", [filename]);
      if (seen.rowCount) continue;
      const sql = await readFile(path.join(dir, filename), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (filename) values ($1)", [filename]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [814185]).catch(() => undefined);
    client.release();
  }
}
