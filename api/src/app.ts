import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { getConnInfo } from "@hono/node-server/conninfo";
import { one, q } from "./db.js";
import { HttpError } from "./errors.js";
import { mediaPath, readUpload, reencode, removeMediaFile, writeMediaFile } from "./media.js";
import { hashPassword, verifyPassword } from "./password.js";
import { limitFromEnv, rateLimit } from "./rate.js";
import { listFeedCauses, registerCauses } from "./causes.js";
import { registerCommunity } from "./community.js";
import { attachCards, registerStudio } from "./studio.js";
import { attachDigital, registerDigital } from "./digital.js";
import { prepareSocialFeed, registerSocial } from "./social.js";
import { registerAccount, sendVerification } from "./account.js";
import { registerMoney } from "./money.js";
import { createPoll, registerPolls, updatePoll } from "./polls.js";
import { registerReports } from "./reports.js";
import { appendThreadMessage, registerThreads } from "./threads.js";
import { registerTranslate } from "./translate.js";
import { POST_FROM, POST_SELECT, mapPost, priceLabel, publicUser } from "./serialize.js";
import {
  KINDS,
  LISTING_KINDS,
  PRICE_MODES,
  TOPICS,
  cleanText,
  optionalEnum,
  optionalUuid,
  priceFields,
  requireEmail,
  requireHandle,
  requirePassword,
  requireRole,
  requireTopic,
  type Kind,
  type ListingKind,
  type PriceMode,
  type Topic,
} from "./validate.js";

const SESSION_SECONDS = 60 * 60 * 24 * 14;

type SessionUser = {
  session_id: string;
  csrf_token: string;
  id: string;
  email: string;
  handle: string;
  display_name: string;
  bio: string;
  neighborhood: string;
  role: "resident" | "organizer" | "civic_professional" | "community_business";
  avatar_media_id: string | null;
  created_at: Date;
  language?: string;
};

type Vars = { session: SessionUser | null };

export const app = new Hono<{ Variables: Vars }>();

let dummyHash = "";
export async function warmAuth() {
  dummyHash = await hashPassword(randomBytes(24).toString("hex"));
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function clientIp(c: { req: { header: (name: string) => string | undefined } }) {
  const ip = (c.req.header("x-real-ip") || "").trim();
  const sig = (c.req.header("x-real-ip-sign") || "").trim();
  const secret = process.env.PROXY_SHARED_SECRET || "";
  if (ip && sig && secret && ip.length < 80 && /^[0-9a-fA-F:.]+$/.test(ip)) {
    const expected = createHmac("sha256", secret).update(ip).digest("hex");
    if (safeEqual(sig, expected)) return ip;
  }
  try {
    return getConnInfo(c as never).remote.address || "unknown";
  } catch {
    return "unknown";
  }
}

function cookieBase() {
  return {
    path: "/",
    sameSite: "Lax" as const,
    secure: process.env.COOKIE_SECURE === "1",
    maxAge: SESSION_SECONDS,
  };
}

async function readSession(cookie: string | undefined) {
  if (!cookie) return null;
  const tokenHash = createHash("sha256").update(cookie).digest("hex");
  return one<SessionUser>(
    `select s.id as session_id, s.csrf_token, u.id, u.email, u.handle, u.display_name, u.bio,
            u.neighborhood, u.role, u.avatar_media_id, u.created_at, u.language
     from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [tokenHash],
  );
}

function assertCsrf(header: string, cookie: string, session: SessionUser | null) {
  if (!header || !cookie || !safeEqual(header, cookie) || (session && !safeEqual(header, session.csrf_token))) {
    throw new HttpError(403, "csrf", "Refresh the page and try again.");
  }
}

async function createSession(c: Parameters<typeof setCookie>[0], userId: string) {
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await q(
    `insert into sessions (user_id, token_hash, csrf_token, expires_at) values ($1, $2, $3, now() + interval '14 days')`,
    [userId, tokenHash, csrf],
  );
  await q(
    `delete from sessions where id in (
       select id from sessions where user_id = $1 order by created_at desc offset 10
     )`,
    [userId],
  );
  setCookie(c, "cv_session", token, { ...cookieBase(), httpOnly: true });
  setCookie(c, "cv_csrf", csrf, { ...cookieBase(), httpOnly: false });
  return csrf;
}

function requireUser(c: { get: (key: "session") => SessionUser | null }) {
  const session = c.get("session");
  if (!session) throw new HttpError(401, "unauthorized", "Log in to continue.");
  return session;
}

async function bodyObject(c: { req: { text: () => Promise<string> } }) {
  const text = await c.req.text();
  if (text.length > 65_536) throw new HttpError(413, "too_large", "Request is too large.");
  if (!text) return {};
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new HttpError(400, "validation", "Request body must be a JSON object.");
    }
    return value as Record<string, unknown>;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "validation", "Request body must be JSON.");
  }
}

function rethrowPg(err: unknown): never {
  const e = err as { code?: string; constraint?: string };
  if (e.code === "23505") {
    if (e.constraint?.includes("email")) throw new HttpError(409, "conflict", "That email is already registered.", { email: "Already registered." });
    if (e.constraint?.includes("handle")) throw new HttpError(409, "conflict", "That handle is taken.", { handle: "That handle is taken." });
  }
  throw err;
}

function parseId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new HttpError(404, "not_found", "Not found.");
  }
  return id;
}

async function countsFor(userId: string) {
  const row = await one<{ posts: number; listings: number; asks: number }>(
    `select
       (select count(*)::int from posts where author_id = $1 and deleted_at is null) as posts,
       (select count(*)::int from posts where author_id = $1 and deleted_at is null and kind = 'offer') as listings,
       (select count(*)::int from posts where author_id = $1 and deleted_at is null and kind = 'ask') as asks`,
    [userId],
  );
  return row ?? { posts: 0, listings: 0, asks: 0 };
}

function mePayload(session: SessionUser, counts: { posts: number; listings: number; asks: number }) {
  return { ...publicUser(session), email: session.email, counts, language: session.language || "en" };
}

type PostFilter = {
  lens?: string;
  kind?: Kind;
  topic?: Topic;
  priceMode?: PriceMode;
  listingKind?: ListingKind;
  digitalForm?: string;
  license?: string;
  language?: string;
  authorId?: string;
  offersOnly?: boolean;
  asksOnly?: boolean;
  savedOnly?: boolean;
  q?: string;
  groupId?: string | null;
  hasVideo?: boolean;
  pollSubject?: string;
  pollStatus?: string;
  pollFollowing?: boolean;
  limit?: number;
};

const POST_VISIBLE = `(p.group_id is null or p.author_id = $1
  or exists (select 1 from groups gv where gv.id = p.group_id and gv.visibility = 'public')
  or exists (select 1 from group_members gm where gm.group_id = p.group_id and gm.user_id = $1))
  and (p.held_for_review = false or p.author_id = $1)`;

async function listPosts(viewerId: string | null, filter: PostFilter) {
  const params: unknown[] = [viewerId];
  const where = [
    "p.deleted_at is null",
    POST_VISIBLE,
    "(p.availability = 'available' or p.availability = 'unavailable' or p.availability = 'sold' or p.author_id = $1)",
    "p.listing_status = 'published'",
    "(p.expires_at is null or p.expires_at > now())",
  ];
  if (filter.kind) {
    params.push(filter.kind);
    where.push(`p.kind = $${params.length}`);
  }
  if (filter.topic) {
    params.push(filter.topic);
    where.push(`p.topic = $${params.length}`);
  }
  if (filter.priceMode) {
    params.push(filter.priceMode);
    where.push(`p.price_mode = $${params.length}`);
  }
  if (filter.listingKind) {
    params.push(filter.listingKind);
    where.push(`p.listing_kind = $${params.length}`);
  }
  if (filter.authorId) {
    params.push(filter.authorId);
    where.push(`p.author_id = $${params.length}`);
  }
  if (filter.digitalForm) {
    params.push(filter.digitalForm);
    where.push(`p.digital_form = $${params.length}`);
  }
  if (filter.license) {
    params.push(filter.license);
    where.push(`p.license_kind = $${params.length}`);
  }
  if (filter.language) {
    params.push(filter.language);
    where.push(`p.content_language = $${params.length}`);
  }
  if (filter.offersOnly) {
    where.push("p.kind = 'offer'");
    if (filter.authorId !== viewerId) where.push("p.availability <> 'archived'");
  }
  if (filter.asksOnly) where.push("p.kind = 'ask'");
  if (filter.lens === "groups") where.push("p.group_id is not null");
  if (filter.hasVideo) where.push("p.video_id is not null");
  if (filter.groupId) {
    params.push(filter.groupId);
    where.push(`p.group_id = $${params.length}`);
  }
  if (filter.lens === "following") {
    where.push(`(
      exists (select 1 from follows f where f.followee_id = p.author_id and f.follower_id = $1)
      or exists (select 1 from poll_follows pf where pf.post_id = p.id and pf.user_id = $1)
    )`);
  }
  if (filter.lens === "creators") {
    where.push("exists (select 1 from follows f where f.followee_id = p.author_id and f.follower_id = $1)");
  }
  if (filter.lens === "polls") where.push("p.kind = 'poll'");
  if (filter.lens === "help" && !filter.kind) where.push("p.kind in ('ask', 'offer')");
  if (filter.lens === "help" && filter.kind && filter.kind !== "ask" && filter.kind !== "offer") where.push("false");
  if (filter.pollFollowing) where.push("exists (select 1 from poll_follows pf where pf.post_id = p.id and pf.user_id = $1)");
  if (filter.pollSubject) {
    params.push(filter.pollSubject);
    where.push(`exists (select 1 from polls plf where plf.post_id = p.id and plf.subject_type = $${params.length})`);
  }
  if (filter.pollStatus === "open") where.push("exists (select 1 from polls plf where plf.post_id = p.id and plf.status = 'open' and (plf.closes_at is null or plf.closes_at > now()))");
  if (filter.pollStatus === "closed") where.push("exists (select 1 from polls plf where plf.post_id = p.id and plf.status = 'closed')");
  if (filter.pollStatus === "expired") where.push("exists (select 1 from polls plf where plf.post_id = p.id and plf.status = 'open' and plf.closes_at <= now())");
  if (filter.pollStatus === "canceled") where.push("exists (select 1 from polls plf where plf.post_id = p.id and plf.status = 'canceled')");
  if (filter.lens === "professionals") where.push("u.role = 'civic_professional'");
  if (filter.savedOnly) {
    where.push("exists (select 1 from saves sv where sv.post_id = p.id and sv.user_id = $1)");
  }
  if (filter.q) {
    const pattern = `%${filter.q.slice(0, 80).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    params.push(pattern);
    const n = `$${params.length}`;
    where.push(`(p.title ilike ${n} escape '\\' or p.body ilike ${n} escape '\\' or u.display_name ilike ${n} escape '\\' or u.handle ilike ${n} escape '\\'
      or exists (select 1 from polls pls where pls.post_id = p.id and pls.subject_label ilike ${n} escape '\\')
      or exists (select 1 from poll_options pos where pos.post_id = p.id and pos.label ilike ${n} escape '\\')
      or exists (select 1 from post_tags tg where tg.post_id = p.id and tg.tag ilike ${n} escape '\\'))`);
  }
  const rows = await q(
    `select ${POST_SELECT} ${POST_FROM} where ${where.join(" and ")} order by p.created_at desc limit ${Math.min(Math.max(filter.limit ?? 50, 1), 80)}`,
    params,
  );
  const posts = rows.map((row) => mapPost(row as never, viewerId));
  await attachCards(posts, viewerId);
  await attachDigital(posts, viewerId);
  return posts;
}

async function postOr404(id: string, viewerId: string | null) {
  const row = await one(`select ${POST_SELECT} ${POST_FROM} where p.id = $2 and p.deleted_at is null and ${POST_VISIBLE}`, [viewerId, id]);
  if (!row) throw new HttpError(404, "not_found", "Post not found.");
  const post = mapPost(row as never, viewerId);
  await attachCards([post], viewerId);
  await attachDigital([post], viewerId);
  return post;
}

async function discardUnusedAttachments(userId: string, mediaIds: Array<string | null | undefined>, videoId: string | null) {
  for (const mediaId of mediaIds) {
    if (!mediaId) continue;
    const used = await one(
      `select 1 from posts where media_id = $1 and deleted_at is null
       union all select 1 from post_images where media_id = $1
       union all select 1 from users where avatar_media_id = $1`,
      [mediaId],
    );
    if (used) continue;
    const row = await one<{ storage_key: string }>("select storage_key from media where id = $1 and owner_id = $2", [mediaId, userId]);
    if (!row) continue;
    await q("delete from media where id = $1 and owner_id = $2", [mediaId, userId]);
    await removeMediaFile(row.storage_key);
  }
  if (!videoId) return;
  const usedVideo = await one("select 1 from posts where video_id = $1 and deleted_at is null", [videoId]);
  if (usedVideo) return;
  const video = await one<{ original_key: string; output_key: string | null; poster_key: string | null }>(
    "select original_key, output_key, poster_key from videos where id = $1 and owner_id = $2",
    [videoId, userId],
  );
  if (!video) return;
  await q("delete from videos where id = $1 and owner_id = $2", [videoId, userId]);
  const { unlink } = await import("node:fs/promises");
  const { safeMediaFile } = await import("./video.js");
  for (const key of [video.original_key, video.output_key, video.poster_key]) {
    if (!key) continue;
    const full = safeMediaFile(key);
    if (full) await unlink(full).catch(() => undefined);
  }
}

async function assertOwnMedia(userId: string, mediaId: string | null) {
  if (!mediaId) return;
  const media = await one<{ owner_id: string }>("select owner_id from media where id = $1", [mediaId]);
  if (!media || media.owner_id !== userId) throw new HttpError(400, "validation", "That photo isn't yours.", { mediaId: "Upload a photo first." });
}

async function assertOwnVideo(userId: string, videoId: string | null, postId?: string) {
  if (!videoId) return;
  const video = await one<{ owner_id: string }>("select owner_id from videos where id = $1", [videoId]);
  if (!video || video.owner_id !== userId) throw new HttpError(400, "validation", "That clip isn't yours.", { videoId: "Upload a clip first." });
  const taken = await one<{ id: string }>("select id from posts where video_id = $1 and deleted_at is null and id <> $2", [videoId, postId ?? "00000000-0000-0000-0000-000000000000"]);
  if (taken) throw new HttpError(400, "validation", "That clip is already attached to a post.", { videoId: "Choose a different clip." });
}

async function assertGroupMember(userId: string, groupId: string | null) {
  if (!groupId) return;
  const member = await one("select 1 from group_members where group_id = $1 and user_id = $2", [groupId, userId]);
  if (!member) throw new HttpError(403, "forbidden", "Join the group before posting in it.");
}

async function assertOwnPlaybook(userId: string, playbookId: string | null) {
  if (!playbookId) return;
  const row = await one<{ author_id: string }>("select author_id from playbooks where id = $1 and deleted_at is null", [playbookId]);
  if (!row || row.author_id !== userId) throw new HttpError(400, "validation", "That playbook isn't yours.", { playbookId: "Choose one of your playbooks." });
}

async function assertOwnOffer(userId: string, postId: string | null) {
  if (!postId) return;
  const post = await one<{ author_id: string; kind: string }>(
    "select author_id, kind from posts where id = $1 and deleted_at is null",
    [postId],
  );
  if (!post || post.kind !== "offer" || post.author_id !== userId) {
    throw new HttpError(400, "validation", "Link one of your own listings.", { linkedPostId: "Choose your own listing." });
  }
}

function readPostInput(body: Record<string, unknown>, kind: Kind) {
  const title = kind === "share"
    ? cleanText(body.title ?? "", 140, "title", "Title", { required: false })
    : cleanText(body.title, 140, "title", "Title");
  const text = cleanText(body.body, 4000, "body", "Post", { multiline: true });
  const topic = requireTopic(body.topic);
  const price = priceFields(kind, body);
  const mediaId = optionalUuid(body.mediaId, "mediaId");
  const playbookId = optionalUuid(body.playbookId, "playbookId");
  const videoId = optionalUuid(body.videoId, "videoId");
  const groupId = optionalUuid(body.groupId, "groupId");
  return { title, text, topic, ...price, mediaId, playbookId, videoId, groupId };
}

function readOfferDetails(body: Record<string, unknown>, listingKind: string | null, prior?: { item_condition: string | null; quantity: number | null; availability: string; handoff: string | null } | null) {
  const availability = body.availability == null || body.availability === "" ? (prior?.availability || "available") : body.availability;
  if (typeof availability !== "string" || !["available", "unavailable", "sold", "archived"].includes(availability)) {
    throw new HttpError(400, "validation", "Choose whether the listing is available.", { availability: "Choose available, unavailable, sold, or archived." });
  }
  if (listingKind !== "local_good") return { condition: null, quantity: null, handoff: null, availability };
  const condition = body.condition == null ? (prior?.item_condition || "good") : body.condition;
  const quantity = body.quantity == null ? (prior?.quantity ?? 1) : body.quantity;
  const handoff = body.handoff == null ? (prior?.handoff || "pickup") : body.handoff;
  if (typeof condition !== "string" || !["new", "good", "fair", "worn"].includes(condition)) {
    throw new HttpError(400, "validation", "Choose the condition of this good.", { condition: "Choose new, good, fair, or worn." });
  }
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 0 || quantity > 10000) {
    throw new HttpError(400, "validation", "Quantity is a whole number from 0 to 10000.", { quantity: "Use a whole number from 0 to 10000." });
  }
  if (typeof handoff !== "string" || !["pickup", "delivery", "either"].includes(handoff)) {
    throw new HttpError(400, "validation", "Choose pickup, delivery, or either. This is not a shipping checkout.", { handoff: "Choose how a neighbor can receive it." });
  }
  return { condition, quantity, handoff, availability };
}

function readImageIds(body: Record<string, unknown>) {
  if (body.imageIds == null) return null;
  if (!Array.isArray(body.imageIds) || body.imageIds.length > 6) {
    throw new HttpError(400, "validation", "Use up to 6 photos.", { imageIds: "Use up to 6 photos." });
  }
  const ids = body.imageIds.map((id) => optionalUuid(id, "imageIds")).filter((id): id is string => Boolean(id));
  if (new Set(ids).size !== ids.length) throw new HttpError(400, "validation", "Each photo can appear once.", { imageIds: "Remove the duplicate photo." });
  return ids;
}

async function replaceImages(postId: string, imageIds: string[]) {
  await q("delete from post_images where post_id = $1", [postId]);
  for (let i = 0; i < imageIds.length; i += 1) {
    await q("insert into post_images (post_id, media_id, position) values ($1, $2, $3)", [postId, imageIds[i], i]);
  }
}

app.use("*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Frame-Options", "DENY");
  if (!c.req.path.startsWith("/api/media/")) c.header("Cache-Control", "no-store");
  const session = await readSession(getCookie(c, "cv_session"));
  c.set("session", session);
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const digitalFile = c.req.method === "POST" && c.req.path.startsWith("/api/digital/listings/") && (c.req.path.endsWith("/files") || c.req.path.endsWith("/demo"));
    const upload = c.req.method === "POST" && (c.req.path === "/api/media" || c.req.path === "/api/videos" || c.req.path === "/api/studio/audio" || digitalFile);
    if (!upload) {
      const len = Number(c.req.header("content-length") || 0);
      if (len > 65_536) throw new HttpError(413, "too_large", "Request is too large.");
    } else if (c.req.path === "/api/videos" || c.req.path === "/api/studio/audio" || digitalFile) {
      const len = Number(c.req.header("content-length") || 0);
      const fileUpload = digitalFile && c.req.path.endsWith("/files");
      const max = fileUpload ? 25 : c.req.path === "/api/studio/audio" ? 8 : 40;
      if (len > max * 1024 * 1024 + 65_536) {
        throw new HttpError(413, "too_large", fileUpload ? "Each file must be 25 MB or smaller." : c.req.path === "/api/studio/audio" ? "Audio must be 8 MB or smaller." : "Clips must be 40 MB or smaller.");
      }
    } else {
      const len = Number(c.req.header("content-length") || 0);
      if (len > 8 * 1024 * 1024 + 65_536) throw new HttpError(413, "too_large", "Images must be 8 MB or smaller.");
    }
    assertCsrf(c.req.header("x-csrf-token") || "", getCookie(c, "cv_csrf") || "", session);
  }
  await next();
});

app.onError((err, c) => {
  if (err instanceof HttpError) {
    if (err.code === "rate_limited" && err.fields?.retryAfter) c.header("Retry-After", err.fields.retryAfter);
    return c.json({ error: { code: err.code, message: err.message, fields: err.fields ?? null } }, err.status as 400);
  }
  console.error(err);
  return c.json({ error: { code: "server", message: "Something went wrong.", fields: null } }, 500);
});

app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found.", fields: null } }, 404));

app.get("/api/health", async (c) => {
  await q("select 1 as ok");
  return c.json({ ok: true, service: "common-voice" });
});

app.get("/api/csrf", (c) => {
  const session = c.get("session");
  if (session) {
    setCookie(c, "cv_csrf", session.csrf_token, { ...cookieBase(), httpOnly: false });
    return c.json({ csrfToken: session.csrf_token });
  }
  const token = randomBytes(32).toString("base64url");
  setCookie(c, "cv_csrf", token, { ...cookieBase(), httpOnly: false });
  return c.json({ csrfToken: token });
});

app.post("/api/auth/signup", async (c) => {
  await rateLimit(`signup:${clientIp(c)}`, limitFromEnv("SIGNUP_LIMIT", 30), 3600);
  const body = await bodyObject(c);
  const email = requireEmail(body.email);
  const password = requirePassword(body.password);
  const displayName = cleanText(body.displayName, 80, "displayName", "Name");
  const handle = requireHandle(body.handle);
  const neighborhood = cleanText(body.neighborhood ?? "", 80, "neighborhood", "Neighborhood", { required: false });
  const role = body.role == null || body.role === "" ? "resident" : requireRole(body.role);
  const passwordHash = await hashPassword(password);
  let user;
  try {
    user = await one(
      `insert into users (email, handle, password_hash, display_name, neighborhood, role)
       values ($1, $2, $3, $4, $5, $6)
       returning id, email, handle, display_name, bio, neighborhood, role, avatar_media_id, created_at, language`,
      [email, handle, passwordHash, displayName, neighborhood, role],
    );
  } catch (err) {
    rethrowPg(err);
  }
  if (!user) throw new HttpError(500, "server", "Could not create the account.");
  const csrfToken = await createSession(c, user.id);
  await sendVerification(user.id, email).catch(() => undefined);
  return c.json({ user: mePayload(user as SessionUser, { posts: 0, listings: 0, asks: 0 }), csrfToken }, 201);
});

app.post("/api/auth/login", async (c) => {
  await rateLimit(`login:${clientIp(c)}`, limitFromEnv("LOGIN_LIMIT", 20), 900);
  const body = await bodyObject(c);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const generic = new HttpError(401, "unauthorized", "Email or password is incorrect.");
  if (!email || !password || password.length > 200 || email.length > 254) throw generic;
  const user = await one<SessionUser & { password_hash: string }>(
    `select id, email, handle, display_name, bio, neighborhood, role, avatar_media_id, created_at, language, password_hash
     from users where email = $1`,
    [email],
  );
  const ok = await verifyPassword(password, user?.password_hash || dummyHash);
  if (!user || !ok) throw generic;
  const csrfToken = await createSession(c, user.id);
  const counts = await countsFor(user.id);
  return c.json({ user: mePayload(user, counts), csrfToken });
});

app.post("/api/auth/logout", async (c) => {
  const raw = getCookie(c, "cv_session");
  if (raw) await q("delete from sessions where token_hash = $1", [createHash("sha256").update(raw).digest("hex")]);
  deleteCookie(c, "cv_session", { path: "/" });
  const csrfToken = randomBytes(32).toString("base64url");
  setCookie(c, "cv_csrf", csrfToken, { ...cookieBase(), httpOnly: false });
  return c.json({ ok: true, csrfToken });
});

app.get("/api/auth/me", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ user: null });
  const flag = await one<{ is_moderator: boolean }>("select is_moderator from users where id = $1", [session.id]);
  return c.json({ user: { ...mePayload(session, await countsFor(session.id)), moderator: Boolean(flag?.is_moderator) } });
});

app.patch("/api/me", async (c) => {
  const session = requireUser(c);
  const body = await bodyObject(c);
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (column: string, value: unknown) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };
  if ("displayName" in body) set("display_name", cleanText(body.displayName, 80, "displayName", "Name"));
  if ("bio" in body) set("bio", cleanText(body.bio ?? "", 500, "bio", "Bio", { required: false, multiline: true }));
  if ("neighborhood" in body) set("neighborhood", cleanText(body.neighborhood ?? "", 80, "neighborhood", "Neighborhood", { required: false }));
  if ("role" in body) set("role", requireRole(body.role));
  if ("handle" in body) set("handle", requireHandle(body.handle));
  if ("avatarMediaId" in body) {
    if (body.avatarMediaId == null || body.avatarMediaId === "") set("avatar_media_id", null);
    else {
      const mediaId = optionalUuid(body.avatarMediaId, "avatarMediaId");
      await assertOwnMedia(session.id, mediaId);
      set("avatar_media_id", mediaId);
    }
  }
  if (!sets.length) {
    return c.json({ user: mePayload(session, await countsFor(session.id)) });
  }
  params.push(session.id);
  let user;
  try {
    user = await one(
      `update users set ${sets.join(", ")}, updated_at = now() where id = $${params.length}
       returning id, email, handle, display_name, bio, neighborhood, role, avatar_media_id, created_at`,
      params,
    );
  } catch (err) {
    rethrowPg(err);
  }
  if (!user) throw new HttpError(404, "not_found", "Account not found.");
  return c.json({ user: mePayload(user as SessionUser, await countsFor(session.id)) });
});

app.get("/api/me/account", (c) => {
  const session = requireUser(c);
  return c.json({
    email: session.email,
    payments: {
      enabled: false,
      balance: null,
      provider: null,
      message: "Payments, tips, and checkout are not enabled. No balance is stored.",
    },
    verification: {
      status: "not_available",
      submittedAt: null,
      badge: null,
      message: "Professional verification is not available. No badge is shown.",
    },
    notifications: { enabled: false, items: [] },
    video: {
      enabled: true,
      maxSeconds: 30,
      maxBytes: 40 * 1024 * 1024,
      message: "Clips can be up to 30 seconds and 40 MB, in MP4 or WebM. Spekup checks the container, codec, and duration. It does not review what the clip shows.",
    },
  });
});

app.get("/api/me/saved", async (c) => {
  const session = requireUser(c);
  return c.json({ posts: await listPosts(session.id, { savedOnly: true }) });
});

app.get("/api/me/help", async (c) => {
  const session = requireUser(c);
  const sent = await q<{ id: string; body: string; created_at: Date; post_id: string; title: string; kind: Kind; handle: string; display_name: string }>(
    `select i.id, i.body, i.created_at, p.id as post_id, p.title, p.kind, u.handle, u.display_name
     from inquiries i
     join posts p on p.id = i.post_id
     join users u on u.id = p.author_id
     where i.author_id = $1 and i.deleted_at is null
     order by i.created_at desc limit 50`,
    [session.id],
  );
  const received = await q<{ id: string; body: string; created_at: Date; post_id: string; title: string; kind: Kind; handle: string; display_name: string; avatar_media_id: string | null }>(
    `select i.id, i.body, i.created_at, p.id as post_id, p.title, p.kind, u.handle, u.display_name, u.avatar_media_id
     from inquiries i
     join posts p on p.id = i.post_id
     join users u on u.id = i.author_id
     where p.author_id = $1 and i.deleted_at is null and p.deleted_at is null
     order by i.created_at desc limit 50`,
    [session.id],
  );
  return c.json({
    sent: sent.map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: new Date(row.created_at).toISOString(),
      post: { id: row.post_id, title: row.title, kind: row.kind, authorHandle: row.handle, authorName: row.display_name },
    })),
    received: received.map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: new Date(row.created_at).toISOString(),
      post: { id: row.post_id, title: row.title, kind: row.kind },
      from: { handle: row.handle, displayName: row.display_name, avatarUrl: row.avatar_media_id ? `/api/media/${row.avatar_media_id}` : null },
    })),
  });
});


function feedFilter(c: { req: { query: (name: string) => string | undefined } }, extras: PostFilter = {}): PostFilter {
  const kind = optionalEnum(c.req.query("kind"), KINDS, "kind");
  const topic = optionalEnum(c.req.query("topic"), TOPICS, "topic");
  const priceMode = optionalEnum(c.req.query("priceMode"), PRICE_MODES, "priceMode");
  const listingKind = optionalEnum(c.req.query("listingKind"), LISTING_KINDS, "listingKind");
  const digitalForm = optionalEnum(c.req.query("digitalForm"), ["guide", "ebook", "pdf", "template", "printable", "audio", "video", "course_bundle"], "digitalForm");
  const license = optionalEnum(c.req.query("license"), ["personal", "commercial"], "license");
  const language = (c.req.query("language") || "").trim();
  if (language && !/^[a-z]{2,8}$/.test(language)) throw new HttpError(400, "validation", "Use a short language code.", { language: "Use a short code such as en." });
  const qtext = (c.req.query("q") || "").trim();
  if (qtext.length > 80) throw new HttpError(400, "validation", "Search is limited to 80 characters.", { q: "Shorten the search." });
  return { kind, topic, priceMode, listingKind, digitalForm, license, language: language || undefined, q: qtext || undefined, ...extras };
}

app.get("/api/feed", async (c) => {
  const lens = c.req.query("lens") || "for_you";
  if (!["for_you", "following", "creators", "groups", "professionals", "polls", "causes", "help"].includes(lens)) {
    throw new HttpError(400, "validation", "Unknown feed lens.");
  }
  const session = c.get("session");
  const pollStatus = c.req.query("pollStatus") || "";
  if (pollStatus && !["open", "closed", "expired", "canceled"].includes(pollStatus)) {
    throw new HttpError(400, "validation", "Choose an open, closed, expired, or canceled poll.", { pollStatus: "Choose a poll status." });
  }
  const pollSubject = c.req.query("subjectType") || "";
  if (pollSubject && !["politician", "corporation", "community"].includes(pollSubject)) {
    throw new HttpError(400, "validation", "Choose a subject.", { subjectType: "Choose a subject." });
  }
  const pollFollowing = lens === "polls" && c.req.query("following") === "1";
  const causeFollowing = c.req.query("following") === "1";
  if ((lens === "following" || lens === "creators" || pollFollowing || (lens === "causes" && causeFollowing)) && !session) {
    return c.json({ posts: [], causes: [], notice: "login_required" });
  }
  const groupId = c.req.query("groupId");
  const ranked = c.req.query("ranking") === "baseline";
  if (ranked && lens !== "for_you") throw new HttpError(400, "validation", "The ranking baseline applies to For You.", { ranking: "Use For You." });
  const offset = Math.max(0, Math.min(Number(c.req.query("offset") || 0), 60));
  let posts: Array<Record<string, unknown>> = lens === "causes" ? [] : await listPosts(session?.id ?? null, feedFilter(c, {
    lens,
    hasVideo: c.req.query("video") === "1",
    groupId: groupId ? parseId(groupId) : undefined,
    pollSubject: pollSubject || undefined,
    pollStatus: pollStatus || undefined,
    pollFollowing,
    limit: ranked || lens === "creators" ? 80 : 50,
  }));
  let social: { version: string; mode: string; caughtUp: boolean } | null = null;
  if (lens === "creators" && session) {
    const follows = await one<{ n: number }>("select count(*)::int as n from follows where follower_id = $1", [session.id]);
    if ((follows?.n ?? 0) === 0) return c.json({ posts: [], causes: [], notice: "choose_creators", ranking: { version: "social-baseline-1", mode: "following-chronological" } });
    const prepared = await prepareSocialFeed(posts as never[], session.id, "creators", offset);
    posts = prepared.posts;
    social = prepared;
  } else if (ranked) {
    const prepared = await prepareSocialFeed(posts as never[], session?.id ?? null, "ranked", offset);
    posts = prepared.posts;
    social = prepared;
  }
  const kind = c.req.query("kind") || "";
  const narrowed = Boolean(kind || c.req.query("video") === "1" || c.req.query("priceMode") || c.req.query("listingKind") || c.req.query("topic"));
  const wantCauses = lens === "causes" || ((lens === "for_you" || lens === "following") && !narrowed);
  const causes = wantCauses ? await listFeedCauses(session?.id ?? null, {
    followingOnly: lens === "following" || (lens === "causes" && causeFollowing),
    category: c.req.query("category") || "",
    status: c.req.query("status") || "",
    locality: c.req.query("locality") || "",
    q: (c.req.query("q") || "").trim(),
  }) : [];
  return c.json({ posts, causes: lens === "creators" ? [] : causes, notice: null, ranking: social ? { version: social.version, mode: social.mode } : { version: null, mode: "chronological" }, page: social ? { offset, limit: 20, caughtUp: social.caughtUp } : null });
});

app.get("/api/listings", async (c) => {
  const session = c.get("session");
  const posts = await listPosts(session?.id ?? null, feedFilter(c, { offersOnly: true }));
  return c.json({ listings: posts });
});

app.post("/api/posts", async (c) => {
  const session = requireUser(c);
  await rateLimit(`post:${session.id}`, limitFromEnv("POST_LIMIT", 30), 3600);
  const body = await bodyObject(c);
  const kind = body.kind;
  if (typeof kind !== "string" || !KINDS.includes(kind as Kind)) throw new HttpError(400, "validation", "Choose share, ask, offer, or poll.", { kind: "Choose share, ask, offer, or poll." });
  const input = readPostInput(body, kind as Kind);
  if (kind === "poll" && (input.mediaId || input.videoId || input.playbookId)) {
    throw new HttpError(400, "validation", "A poll is the question and the options.", { file: "Remove the attachment." });
  }
  await assertOwnMedia(session.id, input.mediaId);
  await assertOwnPlaybook(session.id, input.playbookId);
  await assertOwnVideo(session.id, input.videoId);
  await assertGroupMember(session.id, input.groupId);
  const imageIds = readImageIds(body);
  if (imageIds) {
    for (const imageId of imageIds) await assertOwnMedia(session.id, imageId);
    input.mediaId = imageIds[0] || null;
  }
  if (kind === "offer" && input.listingKind === "local_good" && (!imageIds || imageIds.length === 0)) {
    throw new HttpError(400, "validation", "Add at least one photo you own.", { imageIds: "Add at least one photo you own." });
  }
  const details = kind === "offer" ? readOfferDetails(body, input.listingKind) : { condition: null, quantity: null, handoff: null, availability: "available" };
  if (kind === "poll") {
    const id = await createPoll(session.id, input, body);
    return c.json({ post: await postOr404(id, session.id) }, 201);
  }
  let row: { id: string } | null = null;
  try {
    row = await one<{ id: string }>(
      `insert into posts (author_id, kind, title, body, topic, price_mode, price_cents, listing_kind, media_id, playbook_id, video_id, group_id, item_condition, quantity, availability, handoff)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
      [session.id, kind, input.title, input.text, input.topic, input.priceMode, input.priceCents, input.listingKind, input.mediaId, input.playbookId, input.videoId, input.groupId, details.condition, details.quantity, details.availability, details.handoff],
    );
    if (row && imageIds) await replaceImages(row.id, imageIds);
  } catch (err) {
    if (!row) await discardUnusedAttachments(session.id, [input.mediaId, ...(imageIds || [])], input.videoId);
    if (err instanceof HttpError) throw err;
    throw new HttpError(500, "server", "Could not save the post.");
  }
  if (!row) throw new HttpError(500, "server", "Could not save the post.");
  return c.json({ post: await postOr404(row.id, session.id) }, 201);
});

app.get("/api/posts/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  const session = c.get("session");
  const post = await postOr404(id, session?.id ?? null);
  const comments = await q<{ id: string; body: string; created_at: Date; author_id: string; handle: string; display_name: string; role: SessionUser["role"]; neighborhood: string; avatar_media_id: string | null; user_created: Date }>(
    `select c.id, c.body, c.created_at, c.author_id, u.handle, u.display_name, u.role, u.neighborhood, u.avatar_media_id, u.created_at as user_created
     from comments c join users u on u.id = c.author_id
     where c.post_id = $1 and c.deleted_at is null
     order by c.created_at asc limit 100`,
    [id],
  );
  return c.json({
    post,
    comments: comments.map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: new Date(row.created_at).toISOString(),
      viewerIsAuthor: session?.id === row.author_id,
      author: publicUser({
        id: row.author_id,
        handle: row.handle,
        display_name: row.display_name,
        bio: "",
        neighborhood: row.neighborhood,
        role: row.role,
        avatar_media_id: row.avatar_media_id,
        created_at: row.user_created,
      }),
    })),
  });
});

app.patch("/api/posts/:id", async (c) => {
  const session = requireUser(c);
  const id = parseId(c.req.param("id"));
  const existing = await one<{ author_id: string; kind: Kind; deleted_at: Date | null; item_condition: string | null; quantity: number | null; availability: string; handoff: string | null }>(
    "select author_id, kind, deleted_at, item_condition, quantity, availability, handoff from posts where id = $1",
    [id],
  );
  if (!existing || existing.deleted_at) throw new HttpError(404, "not_found", "Post not found.");
  if (existing.author_id !== session.id) throw new HttpError(403, "forbidden", "You can only change your own posts.");
  const body = await bodyObject(c);
  if (body.kind != null && body.kind !== existing.kind) {
    throw new HttpError(400, "validation", "The post type can't be changed.", { kind: "Delete it and create a new one." });
  }
  const input = readPostInput({ ...body, kind: existing.kind }, existing.kind);
  await assertOwnMedia(session.id, input.mediaId);
  await assertOwnPlaybook(session.id, input.playbookId);
  await assertOwnVideo(session.id, input.videoId, id);
  await assertGroupMember(session.id, input.groupId);
  const imageIds = readImageIds(body);
  if (imageIds) {
    for (const imageId of imageIds) await assertOwnMedia(session.id, imageId);
    input.mediaId = imageIds[0] || null;
  }
  if (existing.kind === "offer" && input.listingKind === "local_good" && imageIds && imageIds.length === 0) {
    throw new HttpError(400, "validation", "Add at least one photo you own.", { imageIds: "Add at least one photo you own." });
  }
  const details = existing.kind === "offer" ? readOfferDetails(body, input.listingKind, existing) : { condition: null, quantity: null, handoff: null, availability: "available" };
  if (existing.kind === "poll") {
    if (input.mediaId || input.videoId || input.playbookId) {
      throw new HttpError(400, "validation", "A poll is the question and the options.", { file: "Remove the attachment." });
    }
    await updatePoll(session.id, id, input, body);
    return c.json({ post: await postOr404(id, session.id) });
  }
  await q(
    `update posts set title = $1, body = $2, topic = $3, price_mode = $4, price_cents = $5, listing_kind = $6,
       media_id = $7, playbook_id = $8, video_id = $9, group_id = $10, item_condition = $11, quantity = $12,
       availability = $13, handoff = $14, updated_at = now()
     where id = $15 and author_id = $16 and deleted_at is null`,
    [input.title, input.text, input.topic, input.priceMode, input.priceCents, input.listingKind, input.mediaId, input.playbookId, input.videoId, input.groupId, details.condition, details.quantity, details.availability, details.handoff, id, session.id],
  );
  if (imageIds) await replaceImages(id, imageIds);
  return c.json({ post: await postOr404(id, session.id) });
});

app.delete("/api/posts/:id", async (c) => {
  const session = requireUser(c);
  const id = parseId(c.req.param("id"));
  const existing = await one<{ author_id: string; deleted_at: Date | null }>("select author_id, deleted_at from posts where id = $1", [id]);
  if (!existing || existing.deleted_at) throw new HttpError(404, "not_found", "Post not found.");
  if (existing.author_id !== session.id) throw new HttpError(403, "forbidden", "You can only delete your own posts.");
  await q("update posts set deleted_at = now() where id = $1 and author_id = $2", [id, session.id]);
  return c.json({ ok: true });
});

async function toggle(table: "likes" | "saves", on: boolean, userId: string, postId: string) {
  await postOr404(postId, userId);
  if (on) await q(`insert into ${table} (user_id, post_id) values ($1, $2) on conflict do nothing`, [userId, postId]);
  else await q(`delete from ${table} where user_id = $1 and post_id = $2`, [userId, postId]);
}

app.post("/api/posts/:id/like", async (c) => {
  const session = requireUser(c);
  await toggle("likes", true, session.id, parseId(c.req.param("id")));
  return c.json({ liked: true });
});
app.delete("/api/posts/:id/like", async (c) => {
  const session = requireUser(c);
  await toggle("likes", false, session.id, parseId(c.req.param("id")));
  return c.json({ liked: false });
});
app.post("/api/posts/:id/save", async (c) => {
  const session = requireUser(c);
  await toggle("saves", true, session.id, parseId(c.req.param("id")));
  return c.json({ saved: true });
});
app.delete("/api/posts/:id/save", async (c) => {
  const session = requireUser(c);
  await toggle("saves", false, session.id, parseId(c.req.param("id")));
  return c.json({ saved: false });
});

app.post("/api/posts/:id/comments", async (c) => {
  const session = requireUser(c);
  await rateLimit(`comment:${session.id}`, 60, 3600);
  const id = parseId(c.req.param("id"));
  const visible = await postOr404(id, session.id);
  if (visible.commentsEnabled === false) throw new HttpError(403, "forbidden", "The creator turned comments off for this post.");
  const text = cleanText((await bodyObject(c)).body, 1000, "body", "Comment", { multiline: true });
  const row = await one<{ id: string }>(
    "insert into comments (post_id, author_id, body) values ($1, $2, $3) returning id",
    [id, session.id, text],
  );
  return c.json({ comment: { id: row?.id, body: text } }, 201);
});

app.delete("/api/comments/:id", async (c) => {
  const session = requireUser(c);
  const id = parseId(c.req.param("id"));
  const row = await one<{ author_id: string; deleted_at: Date | null }>("select author_id, deleted_at from comments where id = $1", [id]);
  if (!row || row.deleted_at) throw new HttpError(404, "not_found", "Comment not found.");
  if (row.author_id !== session.id) throw new HttpError(403, "forbidden", "You can only delete your own comments.");
  await q("update comments set deleted_at = now() where id = $1 and author_id = $2", [id, session.id]);
  return c.json({ ok: true });
});

app.post("/api/posts/:id/inquiries", async (c) => {
  const session = requireUser(c);
  await rateLimit(`inquiry:${session.id}`, 40, 3600);
  const id = parseId(c.req.param("id"));
  const post = await one<{ author_id: string; kind: Kind; deleted_at: Date | null }>("select author_id, kind, deleted_at from posts where id = $1", [id]);
  if (!post || post.deleted_at) throw new HttpError(404, "not_found", "Post not found.");
  if (post.kind === "share") throw new HttpError(400, "validation", "Comment on a share. A response is for an ask or a listing.");
  if (post.author_id === session.id) throw new HttpError(400, "validation", "You can't respond to your own post.");
  const body = await bodyObject(c);
  const text = cleanText(body.body, 2000, "body", "Message", { multiline: true });
  const purpose = body.purpose == null || body.purpose === "message" ? "message" : body.purpose === "booking_request" ? "booking_request" : "";
  if (!purpose) throw new HttpError(400, "validation", "Choose a message or a booking request.", { purpose: "Choose a message or a booking request." });
  const availability = await one<{ availability: string }>("select availability from posts where id = $1", [id]);
  if (availability && availability.availability !== "available") {
    throw new HttpError(409, "conflict", "This listing is not available. Nothing was reserved or charged.");
  }
  if (purpose === "booking_request") {
    const listing = await one<{ listing_kind: string | null }>("select listing_kind from posts where id = $1", [id]);
    if (listing?.listing_kind !== "service") throw new HttpError(400, "validation", "A booking request is for a service listing.", { purpose: "Use a service listing." });
  }
  const personalization = cleanText(body.personalization ?? "", 500, "personalization", "Personalization", { required: false, multiline: true });
  const row = await one<{ id: string; created_at: Date }>(
    "insert into inquiries (post_id, author_id, body, purpose, personalization) values ($1, $2, $3, $4, $5) returning id, created_at",
    [id, session.id, text, purpose, personalization],
  );
  const thread = await appendThreadMessage({
    postId: id, buyerId: session.id, sellerId: post.author_id, authorId: session.id, body: text, inquiryId: row?.id,
  });
  return c.json({
    inquiry: { id: row?.id, body: text, purpose, createdAt: row ? new Date(row.created_at).toISOString() : null, postId: id },
    threadId: thread.threadId,
    delivery: "internal_only",
    appointment: null,
    paid: false,
  }, 201);
});

app.get("/api/posts/:id/inquiries", async (c) => {
  const session = requireUser(c);
  const id = parseId(c.req.param("id"));
  const post = await one<{ author_id: string; deleted_at: Date | null }>("select author_id, deleted_at from posts where id = $1", [id]);
  if (!post || post.deleted_at) throw new HttpError(404, "not_found", "Post not found.");
  const onlyAuthor = post.author_id === session.id ? null : session.id;
  const rows = await q<{ id: string; body: string; created_at: Date; handle: string; display_name: string; avatar_media_id: string | null }>(
    `select i.id, i.body, i.created_at, u.handle, u.display_name, u.avatar_media_id
     from inquiries i join users u on u.id = i.author_id
     where i.post_id = $1 and i.deleted_at is null and ($2::uuid is null or i.author_id = $2)
     order by i.created_at asc`,
    [id, onlyAuthor],
  );
  return c.json({
    inquiries: rows.map((row) => ({
      id: row.id,
      body: row.body,
      createdAt: new Date(row.created_at).toISOString(),
      from: { handle: row.handle, displayName: row.display_name, avatarUrl: row.avatar_media_id ? `/api/media/${row.avatar_media_id}` : null },
    })),
  });
});

app.delete("/api/inquiries/:id", async (c) => {
  const session = requireUser(c);
  const id = parseId(c.req.param("id"));
  const row = await one<{ author_id: string }>("select author_id from inquiries where id = $1 and deleted_at is null", [id]);
  if (!row) throw new HttpError(404, "not_found", "Response not found.");
  if (row.author_id !== session.id) throw new HttpError(403, "forbidden", "You can only delete your own response.");
  await q("update inquiries set deleted_at = now() where id = $1 and author_id = $2", [id, session.id]);
  return c.json({ ok: true });
});

app.post("/api/media", async (c) => {
  const session = requireUser(c);
  await rateLimit(`media:${session.id}`, limitFromEnv("MEDIA_RATE_LIMIT", 20), 3600);
  const count = await one<{ n: number }>(
    "select count(*)::int as n from media where owner_id = $1 and created_at > now() - interval '1 day'",
    [session.id],
  );
  if ((count?.n ?? 0) >= limitFromEnv("MEDIA_DAILY_LIMIT", 30)) {
    throw new HttpError(429, "rate_limited", "You've reached today's photo limit.");
  }
  const image = await reencode(await readUpload(c.req.raw));
  const id = randomUUID();
  const stored = await writeMediaFile(id, image.data);
  try {
    await q(
      `insert into media (id, owner_id, storage_key, mime, byte_size, width, height) values ($1,$2,$3,'image/jpeg',$4,$5,$6)`,
      [id, session.id, stored.storageKey, image.data.length, image.width, image.height],
    );
  } catch (err) {
    await removeMediaFile(stored.storageKey);
    throw err;
  }
  return c.json({ media: { id, url: `/api/media/${id}`, width: image.width, height: image.height, mime: "image/jpeg" } }, 201);
});

app.get("/api/media/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  const media = await one<{ owner_id: string; storage_key: string }>("select owner_id, storage_key from media where id = $1", [id]);
  if (!media) throw new HttpError(404, "not_found", "Photo not found.");
  const session = c.get("session");
  if (session?.id !== media.owner_id) {
    const visible = await one(
      `select 1 from posts p where p.media_id = $1 and p.deleted_at is null and (
         p.group_id is null
         or exists (select 1 from groups g where g.id = p.group_id and g.visibility = 'public')
         or exists (select 1 from group_members m where m.group_id = p.group_id and m.user_id = $2)
         or p.author_id = $2
       )
       union all
       select 1 from post_images i join posts p on p.id = i.post_id
       where i.media_id = $1 and p.deleted_at is null and (
         p.group_id is null
         or exists (select 1 from groups g where g.id = p.group_id and g.visibility = 'public')
         or exists (select 1 from group_members m where m.group_id = p.group_id and m.user_id = $2)
         or p.author_id = $2
       )
       union all
       select 1 from users where avatar_media_id = $1
       union all
       select 1 from causes c
       left join groups g on g.id = c.group_id
       where c.cover_media_id = $1 and c.status <> 'draft' and (
         c.group_id is null or g.visibility = 'public' or c.organizer_id = $2
         or exists (select 1 from group_members gm where gm.group_id = c.group_id and gm.user_id = $2)
       )
       limit 1`,
      [id, session?.id ?? null],
    );
    if (!visible) throw new HttpError(404, "not_found", "Photo not found.");
  }
  const full = mediaPath(media.storage_key);
  if (!full) throw new HttpError(404, "not_found", "Photo not found.");
  const data = await readFile(full);
  return new Response(data, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(data.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=86400",
    },
  });
});

app.delete("/api/media/:id", async (c) => {
  const session = requireUser(c);
  const id = parseId(c.req.param("id"));
  const media = await one<{ owner_id: string; storage_key: string }>("select owner_id, storage_key from media where id = $1", [id]);
  if (!media || media.owner_id !== session.id) throw new HttpError(404, "not_found", "Photo not found.");
  await q("delete from media where id = $1 and owner_id = $2", [id, session.id]);
  await removeMediaFile(media.storage_key);
  return c.json({ ok: true });
});

app.get("/api/users/:handle", async (c) => {
  const handle = c.req.param("handle").toLowerCase();
  const user = await one<SessionUser>("select id, email, handle, display_name, bio, neighborhood, role, avatar_media_id, created_at from users where handle = $1", [handle]);
  if (!user) throw new HttpError(404, "not_found", "Person not found.");
  const session = c.get("session");
  const following = session
    ? Boolean(await one("select 1 from follows where follower_id = $1 and followee_id = $2", [session.id, user.id]))
    : false;
  return c.json({
    user: publicUser(user),
    counts: await countsFor(user.id),
    viewer: { isSelf: session?.id === user.id, following },
  });
});

app.get("/api/users/:handle/posts", async (c) => {
  const handle = c.req.param("handle").toLowerCase();
  const user = await one<{ id: string }>("select id from users where handle = $1", [handle]);
  if (!user) throw new HttpError(404, "not_found", "Person not found.");
  const session = c.get("session");
  return c.json({ posts: await listPosts(session?.id ?? null, { authorId: user.id }) });
});

app.get("/api/users/:handle/listings", async (c) => {
  const handle = c.req.param("handle").toLowerCase();
  const user = await one<{ id: string }>("select id from users where handle = $1", [handle]);
  if (!user) throw new HttpError(404, "not_found", "Person not found.");
  const session = c.get("session");
  return c.json({ listings: await listPosts(session?.id ?? null, { authorId: user.id, offersOnly: true }) });
});

app.post("/api/users/:handle/follow", async (c) => {
  const session = requireUser(c);
  const handle = c.req.param("handle").toLowerCase();
  const user = await one<{ id: string }>("select id from users where handle = $1", [handle]);
  if (!user) throw new HttpError(404, "not_found", "Person not found.");
  if (user.id === session.id) throw new HttpError(400, "validation", "You can't follow yourself.");
  await q("insert into follows (follower_id, followee_id) values ($1, $2) on conflict do nothing", [session.id, user.id]);
  return c.json({ following: true });
});

app.delete("/api/users/:handle/follow", async (c) => {
  const session = requireUser(c);
  const handle = c.req.param("handle").toLowerCase();
  const user = await one<{ id: string }>("select id from users where handle = $1", [handle]);
  if (!user) throw new HttpError(404, "not_found", "Person not found.");
  await q("delete from follows where follower_id = $1 and followee_id = $2", [session.id, user.id]);
  return c.json({ following: false });
});

app.get("/api/professionals", async (c) => {
  const qtext = (c.req.query("q") || "").trim();
  if (qtext.length > 80) throw new HttpError(400, "validation", "Search is limited to 80 characters.");
  const session = c.get("session");
  const params: unknown[] = [session?.id ?? null];
  let search = "";
  if (qtext) {
    params.push(`%${qtext.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    search = `and (u.display_name ilike $2 escape '\\' or u.handle ilike $2 escape '\\' or u.neighborhood ilike $2 escape '\\' or u.bio ilike $2 escape '\\')`;
  }
  const rows = await q(
    `select u.id, u.handle, u.display_name, u.bio, u.neighborhood, u.role, u.avatar_media_id, u.created_at,
            exists(select 1 from follows f where f.followee_id = u.id and f.follower_id = $1) as following
     from users u
     where u.role in ('civic_professional', 'community_business')
     ${search}
     order by u.created_at desc limit 50`,
    params,
  );
  return c.json({
    people: rows.map((row) => ({
      ...publicUser(row as never),
      viewerFollowing: Boolean((row as { following: boolean }).following),
    })),
  });
});

function mapPlaybook(row: {
  id: string;
  title: string;
  objective: string;
  weeks: number;
  steps: string;
  created_at: Date;
  updated_at: Date;
  saves: number;
  saved: boolean;
  author_id: string;
  handle: string;
  display_name: string;
  role: SessionUser["role"];
  neighborhood: string;
  avatar_media_id: string | null;
  user_created: Date;
  linked_id: string | null;
  linked_title: string | null;
  linked_price_mode: PriceMode | null;
  linked_price_cents: number | null;
  linked_listing_kind: ListingKind | null;
}, viewerId: string | null) {
  return {
    id: row.id,
    title: row.title,
    objective: row.objective,
    weeks: row.weeks,
    steps: row.steps,
    reviewStatus: "not_reviewed" as const,
    saves: row.saves,
    viewerSaved: row.saved,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    viewerIsAuthor: viewerId === row.author_id,
    author: publicUser({
      id: row.author_id,
      handle: row.handle,
      display_name: row.display_name,
      bio: "",
      neighborhood: row.neighborhood,
      role: row.role,
      avatar_media_id: row.avatar_media_id,
      created_at: row.user_created,
    }),
    linkedListing: row.linked_id
      ? {
          id: row.linked_id,
          title: row.linked_title,
          priceMode: row.linked_price_mode,
          priceCents: row.linked_price_cents,
          priceLabel: priceLabel("offer", row.linked_price_mode, row.linked_price_cents),
          listingKind: row.linked_listing_kind,
        }
      : null,
  };
}

const PLAYBOOK_SQL = `
  select b.id, b.title, b.objective, b.weeks, b.steps, b.created_at, b.updated_at, b.author_id,
         u.handle, u.display_name, u.role, u.neighborhood, u.avatar_media_id, u.created_at as user_created,
         (select count(*)::int from playbook_saves ps where ps.playbook_id = b.id) as saves,
         exists(select 1 from playbook_saves ps where ps.playbook_id = b.id and ps.user_id = $1) as saved,
         lp.id as linked_id, lp.title as linked_title, lp.price_mode as linked_price_mode,
         lp.price_cents as linked_price_cents, lp.listing_kind as linked_listing_kind
  from playbooks b
  join users u on u.id = b.author_id
  left join posts lp on lp.id = b.linked_post_id and lp.deleted_at is null
`;

app.get("/api/playbooks", async (c) => {
  const session = c.get("session");
  const qtext = (c.req.query("q") || "").trim();
  const params: unknown[] = [session?.id ?? null];
  let search = "";
  if (qtext) {
    params.push(`%${qtext.slice(0, 80).replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    search = `and (b.title ilike $2 escape '\\' or b.objective ilike $2 escape '\\')`;
  }
  const rows = await q(`${PLAYBOOK_SQL} where b.deleted_at is null ${search} order by b.created_at desc limit 50`, params);
  return c.json({ playbooks: rows.map((row) => mapPlaybook(row as never, session?.id ?? null)) });
});

app.get("/api/playbooks/:id", async (c) => {
  const session = c.get("session");
  const id = parseId(c.req.param("id"));
  const row = await one(`${PLAYBOOK_SQL} where b.id = $2 and b.deleted_at is null`, [session?.id ?? null, id]);
  if (!row) throw new HttpError(404, "not_found", "Playbook not found.");
  return c.json({ playbook: mapPlaybook(row as never, session?.id ?? null) });
});

app.post("/api/playbooks", async (c) => {
  const session = requireUser(c);
  await rateLimit(`playbook:${session.id}`, 20, 3600);
  const body = await bodyObject(c);
  const title = cleanText(body.title, 140, "title", "Title");
  const objective = cleanText(body.objective, 300, "objective", "Objective", { multiline: true });
  const steps = cleanText(body.steps, 8000, "steps", "Steps", { multiline: true });
  const weeks = body.weeks;
  if (typeof weeks !== "number" || !Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
    throw new HttpError(400, "validation", "Suggested span is 1–52 weeks.", { weeks: "Enter a whole number of weeks from 1 to 52." });
  }
  const linkedPostId = optionalUuid(body.linkedPostId, "linkedPostId");
  await assertOwnOffer(session.id, linkedPostId);
  const row = await one<{ id: string }>(
    `insert into playbooks (author_id, title, objective, weeks, steps, linked_post_id)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [session.id, title, objective, weeks, steps, linkedPostId],
  );
  const full = await one(`${PLAYBOOK_SQL} where b.id = $2`, [session.id, row?.id]);
  return c.json({ playbook: mapPlaybook(full as never, session.id) }, 201);
});

app.patch("/api/playbooks/:id", async (c) => {
  const session = requireUser(c);
  const id = parseId(c.req.param("id"));
  const existing = await one<{ author_id: string }>("select author_id from playbooks where id = $1 and deleted_at is null", [id]);
  if (!existing) throw new HttpError(404, "not_found", "Playbook not found.");
  if (existing.author_id !== session.id) throw new HttpError(403, "forbidden", "You can only change your own playbooks.");
  const body = await bodyObject(c);
  const title = cleanText(body.title, 140, "title", "Title");
  const objective = cleanText(body.objective, 300, "objective", "Objective", { multiline: true });
  const steps = cleanText(body.steps, 8000, "steps", "Steps", { multiline: true });
  const weeks = body.weeks;
  if (typeof weeks !== "number" || !Number.isInteger(weeks) || weeks < 1 || weeks > 52) {
    throw new HttpError(400, "validation", "Suggested span is 1–52 weeks.", { weeks: "Enter a whole number of weeks from 1 to 52." });
  }
  const linkedPostId = optionalUuid(body.linkedPostId, "linkedPostId");
  await assertOwnOffer(session.id, linkedPostId);
  await q(
    `update playbooks set title = $1, objective = $2, weeks = $3, steps = $4, linked_post_id = $5, updated_at = now()
     where id = $6 and author_id = $7 and deleted_at is null`,
    [title, objective, weeks, steps, linkedPostId, id, session.id],
  );
  const full = await one(`${PLAYBOOK_SQL} where b.id = $2`, [session.id, id]);
  return c.json({ playbook: mapPlaybook(full as never, session.id) });
});

app.delete("/api/playbooks/:id", async (c) => {
  const session = requireUser(c);
  const id = parseId(c.req.param("id"));
  const existing = await one<{ author_id: string }>("select author_id from playbooks where id = $1 and deleted_at is null", [id]);
  if (!existing) throw new HttpError(404, "not_found", "Playbook not found.");
  if (existing.author_id !== session.id) throw new HttpError(403, "forbidden", "You can only delete your own playbooks.");
  await q("update playbooks set deleted_at = now() where id = $1 and author_id = $2", [id, session.id]);
  return c.json({ ok: true });
});

app.post("/api/playbooks/:id/save", async (c) => {
  const session = requireUser(c);
  const id = parseId(c.req.param("id"));
  const existing = await one("select 1 from playbooks where id = $1 and deleted_at is null", [id]);
  if (!existing) throw new HttpError(404, "not_found", "Playbook not found.");
  await q("insert into playbook_saves (user_id, playbook_id) values ($1, $2) on conflict do nothing", [session.id, id]);
  return c.json({ saved: true });
});

app.delete("/api/playbooks/:id/save", async (c) => {
  const session = requireUser(c);
  const id = parseId(c.req.param("id"));
  await q("delete from playbook_saves where user_id = $1 and playbook_id = $2", [session.id, id]);
  return c.json({ saved: false });
});

registerCommunity(app as never);
registerReports(app as never);
registerThreads(app as never);
registerPolls(app as never);
registerMoney(app as never);
registerCauses(app as never);
registerStudio(app as never);
registerDigital(app as never);
registerSocial(app as never);
registerAccount(app as never);
registerTranslate(app as never);
