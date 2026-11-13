import { pathToFileURL } from "node:url";
import { pool } from "./db.js";

async function main() {
  const handle = (process.argv[2] || "").trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(handle)) {
    console.error("Usage: node dist/grant-moderator.js <handle>");
    process.exit(1);
  }
  const updated = await pool.query(
    "update users set is_moderator = true where handle = $1 returning handle",
    [handle],
  );
  if (!updated.rowCount) {
    console.error("No account uses that handle.");
    process.exit(1);
  }
  console.log(`Moderator role granted to ${updated.rows[0].handle}.`);
  await pool.end();
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invoked === import.meta.url) {
  main().catch(() => {
    console.error("Could not update the moderator role.");
    process.exit(1);
  });
}
