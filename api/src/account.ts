import { createHash, randomBytes, randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { one, q } from "./db.js";
import { HttpError } from "./errors.js";
import { mailConfigured, sendMail } from "./mail.js";
import { mediaPath, removeMediaFile } from "./media.js";
import { verifyPassword, hashPassword } from "./password.js";
import { safeMediaFile } from "./video.js";

type SessionUser = { id: string };
type Ctx = {
  get: (key: "session") => SessionUser | null;
  json: (body: unknown, status?: number) => Response;
  req: { text: () => Promise<string>; query: (name: string) => string | undefined };
};

function requireUser(c: Ctx) {
  const session = c.get("session");
  if (!session) throw new HttpError(401, "unauthorized", "Log in to continue.");
  return session;
}

function publicBase() {
  return (process.env.PUBLIC_BASE_URL || process.env.SITE_URL || "http://127.0.0.1:4185").replace(/\/$/, "");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function issueToken(userId: string, purpose: "reset" | "verify", hours: number) {
  const token = randomBytes(32).toString("base64url");
  await q(
    "insert into account_tokens (id, user_id, purpose, token_hash, expires_at) values ($1,$2,$3,$4, now() + ($5 || ' hours')::interval)",
    [randomUUID(), userId, purpose, hashToken(token), String(hours)],
  );
  return token;
}

export function registerAccount(app: { get: Function; post: Function }) {
  app.get("/api/auth/recovery", (c: Ctx) => c.json({
    available: mailConfigured(),
    message: mailConfigured()
      ? "Password reset and email verification send a message from this server."
      : "Password reset and email verification are not available yet. No mail is configured.",
  }));

  app.post("/api/auth/forgot", async (c: Ctx) => {
    if (!mailConfigured()) {
      return c.json({ available: false, message: "Password reset isn't available yet. No mail is configured." });
    }
    const body = JSON.parse(await c.req.text() || "{}") as { email?: string };
    const email = String(body.email || "").trim().toLowerCase();
    const user = email ? await one<{ id: string }>("select id from users where email = $1", [email]) : null;
    if (user) {
      const token = await issueToken(user.id, "reset", 1);
      await sendMail(email, "Reset your Spekup password", `Open this link within one hour to choose a new password:\n${publicBase()}/reset?token=${token}\n\nIf you did not ask for this, ignore it.`);
    }
    return c.json({ available: true, sent: true, message: "If that email has an account, a reset link was sent." });
  });

  app.post("/api/auth/reset", async (c: Ctx) => {
    if (!mailConfigured()) throw new HttpError(404, "not_available", "Password reset isn't available yet. No mail is configured.");
    const body = JSON.parse(await c.req.text() || "{}") as { token?: string; password?: string };
    if (!body.token || !body.password || body.password.length < 8) throw new HttpError(400, "validation", "Use the link from the email and a password of at least 8 characters.", { password: "Use at least 8 characters." });
    const row = await one<{ id: string; user_id: string }>(
      "select id, user_id from account_tokens where token_hash = $1 and purpose = 'reset' and used_at is null and expires_at > now()",
      [hashToken(body.token)],
    );
    if (!row) throw new HttpError(400, "validation", "That reset link is invalid or expired.", { token: "Ask for a new link." });
    await q("update users set password_hash = $2 where id = $1", [row.user_id, await hashPassword(body.password)]);
    await q("update account_tokens set used_at = now() where id = $1", [row.id]);
    await q("delete from sessions where user_id = $1", [row.user_id]);
    return c.json({ reset: true });
  });

  app.post("/api/auth/verify", async (c: Ctx) => {
    const body = JSON.parse(await c.req.text() || "{}") as { token?: string };
    const row = await one<{ id: string; user_id: string }>(
      "select id, user_id from account_tokens where token_hash = $1 and purpose = 'verify' and used_at is null and expires_at > now()",
      [hashToken(String(body.token || ""))],
    );
    if (!row) throw new HttpError(400, "validation", "That verification link is invalid or expired.", { token: "Ask for a new link." });
    await q("update users set email_verified_at = now() where id = $1", [row.user_id]);
    await q("update account_tokens set used_at = now() where id = $1", [row.id]);
    return c.json({ verified: true });
  });

  app.post("/api/me/delete", async (c: Ctx) => {
    const session = requireUser(c);
    const body = JSON.parse(await c.req.text() || "{}") as { password?: string; confirm?: string };
    if (body.confirm !== "delete my account") throw new HttpError(400, "validation", "Type delete my account to confirm.", { confirm: "Type delete my account." });
    const user = await one<{ password_hash: string }>("select password_hash from users where id = $1", [session.id]);
    if (!user || !(await verifyPassword(String(body.password || ""), user.password_hash))) {
      throw new HttpError(401, "unauthorized", "The password does not match.");
    }
    const media = await q<{ storage_key: string }>("select storage_key from media where owner_id = $1", [session.id]);
    const videos = await q<{ original_key: string; output_key: string | null; poster_key: string | null }>("select original_key, output_key, poster_key from videos where owner_id = $1", [session.id]);
    const files = await q<{ storage_key: string }>("select f.storage_key from listing_files f join posts p on p.id = f.post_id where p.author_id = $1", [session.id]);
    await q("delete from users where id = $1", [session.id]);
    for (const row of media) await removeMediaFile(row.storage_key);
    for (const row of files) {
      const full = mediaPath(row.storage_key);
      if (full) await unlink(full).catch(() => undefined);
    }
    for (const row of videos) {
      for (const key of [row.original_key, row.output_key, row.poster_key]) {
        if (!key) continue;
        const full = safeMediaFile(key);
        if (full) await unlink(full).catch(() => undefined);
      }
    }
    return c.json({
      deleted: true,
      removed: "Your account, posts, listings, reports, and uploaded files were deleted. They are not kept as an anonymous record.",
    });
  });
}

export async function sendVerification(userId: string, email: string) {
  if (!mailConfigured()) return;
  const token = await issueToken(userId, "verify", 48);
  await sendMail(email, "Confirm your Spekup email", `Open this link within two days to confirm this email:\n${publicBase()}/verify?token=${token}\n\nYou can keep using Spekup if you do not confirm it.`);
}
