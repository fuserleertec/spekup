import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { one, pool, q } from "./db.js";
import { HttpError } from "./errors.js";
import { mediaDir, readUpload } from "./media.js";
import { assertSafePayload, scanBytes, scanLabel } from "./safety.js";
import { platformFeeCents } from "./money.js";
import { limitFromEnv, rateLimit } from "./rate.js";
import { cleanText, optionalUuid, requireTopic } from "./validate.js";
import { probeFile, publicError, safeMediaFile, writePrivateOriginal } from "./video.js";

type SessionUser = { id: string };
type Ctx = {
  get: (key: "session") => SessionUser | null;
  json: (body: unknown, status?: number) => Response;
  req: { param: (name: string) => string; text: () => Promise<string>; query: (name: string) => string | undefined; raw: Request };
};

const FORMS = ["guide", "ebook", "pdf", "template", "printable", "audio", "video", "course_bundle"] as const;
const FORMATS = ["pdf", "epub", "mp3", "m4a", "wav", "mp4", "webm", "zip", "mixed"] as const;
const SKILLS = ["beginner", "intermediate", "advanced"] as const;
const LICENSES = ["personal", "commercial"] as const;
const ORIGINS = ["made", "designed", "curated", "sourced"] as const;
const ROLES = ["creator", "licensed_reseller"] as const;
const FILE_CAP = 25 * 1024 * 1024;
const LISTING_CAP = 80 * 1024 * 1024;

function requireUser(c: Ctx) {
  const session = c.get("session");
  if (!session) throw new HttpError(401, "unauthorized", "Log in to continue.");
  return session;
}

function parseId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new HttpError(404, "not_found", "Not found.");
  return id;
}

async function bodyObject(c: Ctx) {
  const text = await c.req.text();
  if (!text) return {};
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "validation", "Request body must be a JSON object.");
  return value as Record<string, unknown>;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string, label: string) {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new HttpError(400, "validation", `Choose a ${label}.`, { [field]: `Choose a ${label}.` });
  return value as T;
}

function tag(value: string) {
  const text = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (!/^[a-z0-9][a-z0-9-]{1,23}$/.test(text)) throw new HttpError(400, "validation", "Tags are 2 to 24 letters, numbers, or hyphens.", { tags: "Shorten the tag." });
  return text;
}

async function ownListing(id: string, userId: string) {
  const row = await one<Record<string, unknown>>("select * from posts where id = $1 and deleted_at is null and kind = 'offer' and listing_kind = 'digital_guide'", [id]);
  if (!row || row.author_id !== userId) throw new HttpError(404, "not_found", "Digital listing not found.");
  return row;
}

function publicListing(row: Record<string, unknown>, viewerId: string | null) {
  const owner = viewerId === row.author_id;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    topic: row.topic,
    listingStatus: row.listing_status,
    availability: row.availability,
    digitalForm: row.digital_form,
    contentFormat: row.content_format,
    language: row.content_language,
    versionLabel: row.content_version,
    compatibility: row.compatibility,
    skillLevel: row.skill_level,
    accessibility: row.accessibility_note,
    learningPurpose: row.learning_purpose,
    license: row.license_kind,
    licenseTerms: row.license_terms,
    allowsResale: Boolean(row.license_allows_resale),
    origin: row.origin_kind,
    sellerRole: row.seller_role,
    productionCredit: row.production_credit,
    collaboratorCredit: row.collaborator_credit,
    rightsDeclared: Boolean(row.distribution_rights),
    healthPromotion: Boolean(row.health_promotion),
    personalizationPrompt: row.personalization_prompt,
    sellerCostCents: owner ? row.seller_cost_cents : null,
    expiresAt: row.expires_at ? new Date(row.expires_at as string).toISOString() : null,
    featured: Boolean(row.featured),
    editVersion: row.edit_version,
    payments: "not_available" as const,
    accessNote: "A download check is not copy protection. Screen recording is still possible.",
    scan: scanLabel(),
  };
}

async function bundle(id: string, viewerId: string | null, owner: boolean) {
  const images = await q<{ media_id: string; focal_x: number; focal_y: number; position: number }>("select media_id, focal_x, focal_y, position from post_images where post_id = $1 order by position", [id]);
  const tags = await q<{ tag: string }>("select tag from post_tags where post_id = $1 order by position", [id]);
  const variants = await q("select id, axis_a, axis_b, is_free, price_cents, sku, available, position from listing_variants where post_id = $1 order by position", [id]);
  const files = await q<{ id: string; variant_id: string | null; version: number; original_name: string; mime: string; byte_size: number; is_current: boolean; note: string }>(
    "select id, variant_id, version, original_name, mime, byte_size, is_current, note from listing_files where post_id = $1 order by version",
    [id],
  );
  const grants = viewerId ? await q<{ variant_id: string }>("select variant_id from library_grants where user_id = $1 and post_id = $2", [viewerId, id]) : [];
  const held = new Set(grants.map((grant) => grant.variant_id));
  return {
    previews: images.map((image) => ({ id: image.media_id, url: `/api/media/${image.media_id}`, focalX: image.focal_x, focalY: image.focal_y })),
    tags: tags.map((item) => item.tag),
    variants: variants.map((variant) => ({
      id: variant.id,
      axisA: variant.axis_a,
      axisB: variant.axis_b,
      isFree: variant.is_free,
      priceCents: variant.price_cents,
      sku: variant.sku,
      available: variant.available,
      claimed: held.has(variant.id),
      downloadable: owner || (variant.is_free && held.has(variant.id)),
    })),
    files: files.filter((file) => owner || file.is_current).map((file) => ({
      id: owner ? file.id : undefined,
      variantId: file.variant_id,
      version: file.version,
      name: file.original_name.replace(/[^\w.\- ]+/g, ""),
      mime: file.mime,
      bytes: file.byte_size,
      current: file.is_current,
      note: file.note,
    })),
  };
}

export async function attachDigital(posts: Array<{ id: string; listingKind?: string | null; digital?: unknown }>, viewerId: string | null) {
  const ids = posts.filter((post) => post.listingKind === "digital_guide").map((post) => post.id);
  if (!ids.length) return;
  const rows = await q<Record<string, unknown>>("select * from posts where id = any($1::uuid[])", [ids]);
  for (const post of posts) {
    const row = rows.find((item) => item.id === post.id);
    if (!row) continue;
    const extra = await bundle(post.id, viewerId, viewerId === row.author_id);
    post.digital = { ...publicListing(row, viewerId), ...extra };
  }
}

function visibleSql() {
  return `p.deleted_at is null and p.kind = 'offer' and p.listing_kind = 'digital_guide' and p.listing_status = 'published'
    and p.held_for_review = false and p.availability <> 'archived' and (p.expires_at is null or p.expires_at > now())
    and (p.group_id is null or exists (select 1 from groups g where g.id = p.group_id and g.visibility = 'public')
      or exists (select 1 from group_members m where m.group_id = p.group_id and m.user_id = $1))`;
}

export function registerDigital(app: { get: Function; post: Function; patch: Function; put: Function }) {
  app.post("/api/digital/listings", async (c: Ctx) => {
    const session = requireUser(c);
    await rateLimit(`digital:${session.id}`, 30, 3600);
    const body = await bodyObject(c);
    const title = cleanText(body.title ?? "Untitled draft", 140, "title", "Title");
    const text = cleanText(body.body ?? "Draft description.", 4000, "body", "Description", { multiline: true });
    const topic = body.topic ? requireTopic(body.topic) : "neighborhood";
    const row = await one<{ id: string }>(
      `insert into posts (author_id, kind, title, body, topic, listing_kind, price_mode, listing_status, availability)
       values ($1, 'offer', $2, $3, $4, 'digital_guide', 'free_advice', 'draft', 'unavailable') returning id`,
      [session.id, title, text, topic],
    );
    return c.json({ listing: await present(row!.id, session.id) }, 201);
  });

  app.patch("/api/digital/listings/:id", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const current = await ownListing(id, session.id);
    const body = await bodyObject(c);
    if (body.editVersion != null && Number(body.editVersion) !== Number(current.edit_version)) {
      throw new HttpError(409, "conflict", "This listing was saved somewhere else. Reload it before saving again.");
    }
    if (Array.isArray(body.tags) && body.tags.length > 13) throw new HttpError(400, "validation", "Use at most 13 tags.", { tags: "Use at most 13 tags." });
    if (Array.isArray(body.previews) && body.previews.length > 20) throw new HttpError(400, "validation", "Use at most 20 preview images.", { previews: "Use at most 20 previews." });
    if (Array.isArray(body.variants) && (body.variants.length < 1 || body.variants.length > 8)) throw new HttpError(400, "validation", "Use 1 to 8 versions.", { variants: "Use 1 to 8 versions." });
    const title = body.title == null ? String(current.title) : cleanText(body.title, 140, "title", "Title");
    if (title.length > 140) throw new HttpError(400, "validation", "Titles are limited to 140 characters.", { title: "Use 140 characters or fewer." });
    const text = body.body == null ? String(current.body) : cleanText(body.body, 4000, "body", "Description", { multiline: true });
    const topic = body.topic == null ? current.topic : requireTopic(body.topic);
    const form = body.digitalForm == null ? current.digital_form : oneOf(body.digitalForm, FORMS, "digitalForm", "product type");
    const format = body.contentFormat == null ? current.content_format : oneOf(body.contentFormat, FORMATS, "contentFormat", "format");
    const language = body.language == null ? current.content_language : cleanText(body.language, 16, "language", "Language", { required: false });
    const skill = body.skillLevel == null ? current.skill_level : body.skillLevel === "" ? null : oneOf(body.skillLevel, SKILLS, "skillLevel", "skill level");
    const license = body.license == null ? current.license_kind : oneOf(body.license, LICENSES, "license", "license");
    const origin = body.origin == null ? current.origin_kind : oneOf(body.origin, ORIGINS, "origin", "origin");
    const role = body.sellerRole == null ? current.seller_role : oneOf(body.sellerRole, ROLES, "sellerRole", "seller role");
    const cost = body.sellerCostCents == null ? current.seller_cost_cents : body.sellerCostCents === null ? null : whole(body.sellerCostCents, 0, 100_000_000, "sellerCostCents");
    let expires: Date | null = current.expires_at ? new Date(current.expires_at as string) : null;
    if (body.expiresAt === null) expires = null;
    if (typeof body.expiresAt === "string" && body.expiresAt) {
      expires = new Date(body.expiresAt);
      if (Number.isNaN(expires.getTime())) throw new HttpError(400, "validation", "That date is not valid.", { expiresAt: "Use a date." });
    }
    const availability = body.availability == null ? current.availability : body.availability;
    if (!["available", "unavailable", "archived"].includes(String(availability))) throw new HttpError(400, "validation", "Choose available, unavailable, or archived.", { availability: "Choose a status." });
    await q(
      `update posts set title=$2, body=$3, topic=$4, digital_form=$5, content_format=$6, content_language=$7, content_version=$8,
         compatibility=$9, skill_level=$10, accessibility_note=$11, learning_purpose=$12, license_kind=$13, license_terms=$14,
         license_allows_resale=$15, origin_kind=$16, seller_role=$17, production_credit=$18, collaborator_credit=$19,
         distribution_rights=$20, health_promotion=$21, personalization_prompt=$22, seller_cost_cents=$23, expires_at=$24,
         availability=$25, disclosure_ai=$26, disclosure_sponsor=$27, shop_section_id=$28, edit_version=edit_version+1, updated_at=now()
       where id=$1 and author_id=$29`,
      [id, title, text, topic, form, format, language || null, clean(body.contentVersion, current.content_version, 40),
        clean(body.compatibility, current.compatibility, 200), skill, clean(body.accessibility, current.accessibility_note, 300),
        clean(body.learningPurpose, current.learning_purpose, 300), license, clean(body.licenseTerms, current.license_terms, 500),
        body.allowsResale === true, origin, role, clean(body.productionCredit, current.production_credit, 200),
        clean(body.collaboratorCredit, current.collaborator_credit, 200), body.rightsDeclared === true || (body.rightsDeclared == null && current.distribution_rights),
        body.healthPromotion === true, clean(body.personalizationPrompt, current.personalization_prompt, 300), cost, expires,
        availability, body.disclosureAi === true, body.disclosureSponsor === true,
        body.shopSectionId === undefined ? current.shop_section_id : optionalUuid(body.shopSectionId, "shopSectionId"), session.id],
    );
    if (Array.isArray(body.tags)) await saveTags(id, body.tags);
    if (Array.isArray(body.previews)) await savePreviews(id, session.id, body.previews);
    if (Array.isArray(body.variants)) await saveVariants(id, body.variants);
    if (body.featured === true) await pin(id, session.id, true);
    if (body.featured === false) await q("update posts set featured = false where id = $1", [id]);
    return c.json({ listing: await present(id, session.id) });
  });

  app.post("/api/digital/listings/:id/publish", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const row = await ownListing(id, session.id);
    const body = await bodyObject(c);
    if (body.editVersion != null && Number(body.editVersion) !== Number(row.edit_version)) throw new HttpError(409, "conflict", "Reload this listing before publishing.");
    const missing = await publishProblems(id, row);
    if (missing) throw new HttpError(400, "validation", missing, { publish: missing });
    const held = Boolean(row.health_promotion);
    await q("update posts set listing_status = 'published', availability = case when availability = 'unavailable' then 'available' else availability end, held_for_review = $2, updated_at = now() where id = $1", [id, held]);
    return c.json({ listing: await present(id, session.id), heldForReview: held, payments: "not_available" });
  });

  app.post("/api/digital/listings/:id/files", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    await ownListing(id, session.id);
    const variantId = c.req.query("variantId") ? parseId(c.req.query("variantId") || "") : null;
    if (variantId) {
      const variant = await one("select 1 from listing_variants where id = $1 and post_id = $2", [variantId, id]);
      if (!variant) throw new HttpError(400, "validation", "That variant is not on this listing.", { variantId: "Choose a variant." });
    }
    const count = await one<{ n: number; bytes: number }>("select count(*)::int as n, coalesce(sum(byte_size),0)::int as bytes from listing_files where post_id = $1 and is_current = true", [id]);
    if ((count?.n ?? 0) >= 8) throw new HttpError(400, "validation", "A listing can have 8 current files.", { file: "Remove a file first." });
    const data = await readUpload(c.req.raw, FILE_CAP, "Each file must be 25 MB or smaller.");
    await scanBytes(data);
    if ((count?.bytes ?? 0) + data.length > LISTING_CAP) throw new HttpError(400, "validation", "This listing is over 80 MB of files.", { file: "Remove a file first." });
    const sniffed = sniffDeliverable(data);
    const fileId = randomUUID();
    const key = path.posix.join("deliverables", `${fileId}.bin`);
    await mkdir(path.join(mediaDir(), "deliverables"), { recursive: true });
    const full = safeMediaFile(key);
    if (!full) throw new HttpError(400, "validation", "Couldn't store that file.");
    await writeFile(full, data, { mode: 0o600 });
    const versionRow = await one<{ n: number }>("select coalesce(max(version),0)::int as n from listing_files where post_id = $1 and variant_id is not distinct from $2", [id, variantId]);
    const version = (versionRow?.n ?? 0) + 1;
    await q("update listing_files set is_current = false where post_id = $1 and variant_id is not distinct from $2", [id, variantId]);
    const name = safeName(c.req.query("name") || `${sniffed.kind}.${sniffed.kind === "jpeg" ? "jpg" : sniffed.kind}`);
    await q(
      `insert into listing_files (id, post_id, variant_id, version, storage_key, original_name, mime, byte_size, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [fileId, id, variantId, version, key, name, sniffed.mime, data.length, (c.req.query("note") || "").slice(0, 200)],
    );
    return c.json({ file: { id: fileId, version, mime: sniffed.mime, bytes: data.length, scanned: false }, listing: await present(id, session.id) }, 201);
  });

  app.post("/api/digital/listings/:id/demo", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    await ownListing(id, session.id);
    const data = await readUpload(c.req.raw, 40 * 1024 * 1024, "Demo clips must be 40 MB or smaller.");
    const videoId = randomUUID();
    const stored = await writePrivateOriginal(videoId, data);
    try {
      const probe = await probeFile(stored.full);
      if (probe.durationMs > 15_000) throw new HttpError(400, "validation", "A listing demo must be 15 seconds or shorter. The limit was not raised.", { file: "Trim the demo to 15 seconds." });
      await q(
        `insert into videos (id, owner_id, original_key, container, video_codec, audio_codec, byte_size, duration_ms, width, height, purpose)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'listing_demo')`,
        [videoId, session.id, stored.key, probe.container, probe.videoCodec, probe.audioCodec, data.length, probe.durationMs, probe.width, probe.height],
      );
      await q("update posts set demo_video_id = $2, updated_at = now() where id = $1", [id, videoId]);
      return c.json({ video: { id: videoId, status: "queued", muted: true, maxSeconds: 15 } }, 201);
    } catch (err) {
      const full = safeMediaFile(stored.key);
      if (full) await unlink(full).catch(() => undefined);
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, "validation", publicError(err), { file: "That demo could not be checked." });
    }
  });

  app.get("/api/digital/listings/:id/demo", async (c: Ctx) => {
    const session = c.get("session");
    const id = parseId(c.req.param("id"));
    const row = await one<{ demo_video_id: string | null; author_id: string; listing_status: string; held_for_review: boolean; availability: string }>(
      "select demo_video_id, author_id, listing_status, held_for_review, availability from posts where id = $1 and deleted_at is null",
      [id],
    );
    if (!row?.demo_video_id) throw new HttpError(404, "not_found", "No demo.");
    const owner = session?.id === row.author_id;
    if (!owner && (row.listing_status !== "published" || row.held_for_review || row.availability === "archived")) throw new HttpError(404, "not_found", "No demo.");
    const video = await one<{ status: string; output_key: string | null; purpose: string }>("select status, output_key, purpose from videos where id = $1", [row.demo_video_id]);
    if (!video || video.purpose !== "listing_demo" || video.status !== "ready" || !video.output_key?.startsWith("ready/")) throw new HttpError(404, "not_found", "The demo is not ready.");
    const full = safeMediaFile(video.output_key);
    if (!full) throw new HttpError(404, "not_found", "The demo is not ready.");
    const bytes = await readFile(full);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "video/mp4", "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
  });

  app.get("/api/digital/listings/:id/variants/:variantId/file", async (c: Ctx) => serveFile(c));

  app.post("/api/digital/listings/:id/variants/:variantId/claim", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const variantId = parseId(c.req.param("variantId"));
    const visible = await one(`select 1 from posts p where p.id = $2 and ${visibleSql()}`, [session.id, id]);
    if (!visible) throw new HttpError(404, "not_found", "That listing is not public.");
    const variant = await one<{ is_free: boolean; available: boolean; price_cents: number | null }>("select is_free, available, price_cents from listing_variants where id = $1 and post_id = $2", [variantId, id]);
    if (!variant || !variant.available) throw new HttpError(404, "not_found", "That version is not available.");
    if (!variant.is_free || variant.price_cents != null) throw new HttpError(403, "forbidden", "Payments are not available. A paid file cannot be claimed or downloaded.");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `insert into library_grants (user_id, variant_id, post_id) values ($1,$2,$3) on conflict do nothing`,
        [session.id, variantId, id],
      );
      await client.query("insert into library_events (user_id, variant_id, action) values ($1,$2,'claim')", [session.id, variantId]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    return c.json({ claimed: true, transaction: false, payments: "not_available" });
  });

  app.get("/api/library", async (c: Ctx) => {
    const session = requireUser(c);
    const rows = await q(
      `select g.variant_id, g.post_id, p.title, v.axis_a, v.axis_b, v.is_free, p.listing_status, p.availability, p.held_for_review
       from library_grants g join posts p on p.id = g.post_id join listing_variants v on v.id = g.variant_id
       where g.user_id = $1 order by g.created_at desc limit 50`,
      [session.id],
    );
    return c.json({
      grants: rows.map((row) => ({ variantId: row.variant_id, postId: row.post_id, title: row.title, axisA: row.axis_a, axisB: row.axis_b, isFree: row.is_free, listingStatus: row.listing_status, availability: row.availability, held: row.held_for_review })),
      payments: "not_available",
    });
  });

  app.get("/api/shop/mine", async (c: Ctx) => {
    const session = requireUser(c);
    const rows = await q("select id, title, listing_status, availability, held_for_review, digital_form, updated_at from posts where author_id = $1 and kind = 'offer' and listing_kind = 'digital_guide' and deleted_at is null order by updated_at desc limit 50", [session.id]);
    return c.json({ listings: rows });
  });

  app.get("/api/shop/:handle", async (c: Ctx) => {
    const session = c.get("session");
    const handle = c.req.param("handle").toLowerCase();
    const user = await one<{ id: string; handle: string; display_name: string }>("select id, handle, display_name from users where handle = $1", [handle]);
    if (!user) throw new HttpError(404, "not_found", "Shop not found.");
    const sections = await q("select id, name, position from shop_sections where owner_id = $1 order by position", [user.id]);
    const listings = await q(
      `select p.id, p.title, p.digital_form, p.license_kind, p.content_language, p.featured, p.shop_section_id, p.price_mode, p.price_cents
       from posts p where p.author_id = $2 and ${visibleSql()} order by p.featured desc, p.created_at desc limit 50`,
      [session?.id ?? null, user.id],
    );
    return c.json({ shop: { handle: user.handle, name: user.display_name }, sections, listings });
  });

  app.post("/api/shop/sections", async (c: Ctx) => {
    const session = requireUser(c);
    const body = await bodyObject(c);
    const name = cleanText(body.name, 40, "name", "Section");
    const count = await one<{ n: number }>("select count(*)::int as n from shop_sections where owner_id = $1", [session.id]);
    if ((count?.n ?? 0) >= 12) throw new HttpError(400, "validation", "A shop can have 12 sections.", { name: "Remove a section first." });
    const row = await one<{ id: string }>("insert into shop_sections (owner_id, name, position) values ($1,$2,$3) returning id", [session.id, name, count?.n ?? 0]);
    return c.json({ section: { id: row!.id, name, position: count?.n ?? 0 } }, 201);
  });

  app.put("/api/shop/sections", async (c: Ctx) => {
    const session = requireUser(c);
    const body = await bodyObject(c);
    if (!Array.isArray(body.ids) || body.ids.length > 12) throw new HttpError(400, "validation", "Reorder your own sections.", { ids: "Choose your sections." });
    for (let i = 0; i < body.ids.length; i += 1) {
      const id = parseId(String(body.ids[i]));
      const updated = await q("update shop_sections set position = $3 where id = $1 and owner_id = $2", [id, session.id, i + 20]);
      if (!updated.length && false) throw new HttpError(403, "forbidden", "Those are not your sections.");
    }
    for (let i = 0; i < body.ids.length; i += 1) await q("update shop_sections set position = $3 where id = $1 and owner_id = $2", [parseId(String(body.ids[i])), session.id, i]);
    const rows = await q("select id, name, position from shop_sections where owner_id = $1 order by position", [session.id]);
    if (rows.length !== body.ids.length) throw new HttpError(403, "forbidden", "Those are not your sections.");
    return c.json({ sections: rows });
  });

  app.post("/api/digital/estimate", async (c: Ctx) => {
    const session = requireUser(c);
    const body = await bodyObject(c);
    const price = whole(body.priceCents, 0, 100_000_000, "priceCents");
    const cost = whole(body.sellerCostCents ?? 0, 0, 100_000_000, "sellerCostCents");
    const schedule = await one<{ platform_fee_bps: number; version: number }>("select platform_fee_bps, version from fee_schedules where status = 'proposed_preview' order by version desc limit 1");
    const bps = schedule?.platform_fee_bps ?? 500;
    const fee = price === 0 ? 0 : platformFeeCents(price, bps);
    return c.json({
      provisional: true,
      scheduleVersion: schedule?.version ?? 1,
      priceCents: price,
      sellerCostCents: cost,
      platformFeeCents: fee,
      sellerNetCents: price - fee - cost,
      processorFeeCents: null,
      taxCents: null,
      label: "Provisional estimate. Not a guaranteed profit. The processor fee and tax are unknown because no payment provider is connected.",
      charged: false,
      viewer: session.id,
    });
  });
}

async function serveFile(c: Ctx) {
  const session = requireUser(c);
  const id = parseId(c.req.param("id"));
  const variantId = parseId(c.req.param("variantId"));
  const listing = await one<Record<string, unknown>>("select * from posts where id = $1 and deleted_at is null and kind = 'offer'", [id]);
  if (!listing) throw new HttpError(404, "not_found", "File not found.");
  const variant = await one<{ is_free: boolean; price_cents: number | null; available: boolean }>("select is_free, price_cents, available from listing_variants where id = $1 and post_id = $2", [variantId, id]);
  if (!variant) throw new HttpError(404, "not_found", "File not found.");
  const owner = listing.author_id === session.id;
  const paid = !variant.is_free || variant.price_cents != null;
  if (!owner && paid) throw new HttpError(403, "forbidden", "Payments are not available. The full file stays private.");
  if (!owner) {
    const visible = await one(`select 1 from posts p where p.id = $2 and ${visibleSql()}`, [session.id, id]);
    const grant = await one("select 1 from library_grants where user_id = $1 and variant_id = $2", [session.id, variantId]);
    if (!visible || !grant || !variant.available) throw new HttpError(403, "forbidden", "This file is not available to your account. Archived, private, and removed files stay private.");
  }
  const file = await one<{ storage_key: string; mime: string; original_name: string }>(
    "select storage_key, mime, original_name from listing_files where post_id = $1 and is_current = true and (variant_id = $2 or variant_id is null) order by variant_id nulls last, version desc limit 1",
    [id, variantId],
  );
  if (!file || !file.storage_key.startsWith("deliverables/")) throw new HttpError(404, "not_found", "File not found.");
  const full = safeMediaFile(file.storage_key);
  if (!full) throw new HttpError(404, "not_found", "File not found.");
  if (!owner) await q("insert into library_events (user_id, variant_id, action) values ($1,$2,'download')", [session.id, variantId]);
  const bytes = await readFile(full);
  const name = safeName(file.original_name);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mime,
      "Content-Disposition": `attachment; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      "Content-Length": String(bytes.length),
    },
  });
}

async function present(id: string, userId: string) {
  const row = await ownListing(id, userId);
  return { ...publicListing(row, userId), ...(await bundle(id, userId, true)) };
}

async function publishProblems(id: string, row: Record<string, unknown>) {
  if (!row.digital_form || !row.content_format || !row.license_kind || !row.origin_kind || !row.seller_role) return "Choose the type, format, license, origin, and whether you made this or resell it.";
  if (!row.distribution_rights) return "Confirm you have the right to distribute these files. Resale is not allowed unless you say so.";
  if (!String(row.learning_purpose || "").trim()) return "Add a learning purpose. This is not a clinical claim.";
  const images = await one<{ n: number }>("select count(*)::int as n from post_images where post_id = $1", [id]);
  if ((images?.n ?? 0) < 1) return "Add a preview image. The full file is not the preview.";
  const variants = await one<{ n: number }>("select count(*)::int as n from listing_variants where post_id = $1", [id]);
  if ((variants?.n ?? 0) < 1) return "Add at least one version, free or paid.";
  const files = await one<{ n: number }>("select count(*)::int as n from listing_files where post_id = $1 and is_current = true", [id]);
  if ((files?.n ?? 0) < 1) return "Upload the file people will receive. Previews are not the full file.";
  return "";
}

async function saveTags(id: string, value: unknown[]) {
  if (value.length > 13) throw new HttpError(400, "validation", "Use at most 13 tags.", { tags: "Use at most 13 tags." });
  const tags = value.map((item) => tag(String(item)));
  if (new Set(tags).size !== tags.length) throw new HttpError(400, "validation", "Each tag can appear once.", { tags: "Remove the duplicate tag." });
  await q("delete from post_tags where post_id = $1", [id]);
  for (let i = 0; i < tags.length; i += 1) await q("insert into post_tags (post_id, position, tag) values ($1,$2,$3)", [id, i, tags[i]]);
}

async function savePreviews(id: string, userId: string, value: unknown[]) {
  if (value.length > 20) throw new HttpError(400, "validation", "Use at most 20 preview images.", { previews: "Use at most 20 previews." });
  const rows = [];
  for (const item of value) {
    const row = item as Record<string, unknown>;
    const mediaId = optionalUuid(row.mediaId, "mediaId");
    if (!mediaId) throw new HttpError(400, "validation", "Upload a preview first.", { previews: "Upload a preview." });
    const owned = await one("select 1 from media where id = $1 and owner_id = $2", [mediaId, userId]);
    if (!owned) throw new HttpError(400, "validation", "That preview is not yours.", { previews: "Upload your own photo." });
    const focalX = whole(row.focalX ?? 50, 0, 100, "focalX");
    const focalY = whole(row.focalY ?? 50, 0, 100, "focalY");
    rows.push({ mediaId, focalX, focalY });
  }
  if (new Set(rows.map((row) => row.mediaId)).size !== rows.length) throw new HttpError(400, "validation", "Each preview can appear once.", { previews: "Remove the duplicate." });
  await q("delete from post_images where post_id = $1", [id]);
  for (let i = 0; i < rows.length; i += 1) {
    await q("insert into post_images (post_id, media_id, position, focal_x, focal_y) values ($1,$2,$3,$4,$5)", [id, rows[i].mediaId, i, rows[i].focalX, rows[i].focalY]);
  }
  await q("update posts set media_id = $2 where id = $1", [id, rows[0]?.mediaId ?? null]);
}

async function saveVariants(id: string, value: unknown[]) {
  if (value.length < 1 || value.length > 8) throw new HttpError(400, "validation", "Use 1 to 8 versions from at most two choices.", { variants: "Use 1 to 8 versions." });
  const rows = value.map((item) => {
    const row = item as Record<string, unknown>;
    const axisA = cleanText(row.axisA ?? "", 40, "axisA", "Choice", { required: false });
    const axisB = cleanText(row.axisB ?? "", 40, "axisB", "Choice", { required: false });
    const isFree = row.isFree === true;
    const price = isFree ? null : whole(row.priceCents, 1, 100_000_000, "priceCents");
    const sku = cleanText(row.sku ?? "", 32, "sku", "SKU", { required: false }).toUpperCase();
    if (sku && !/^[A-Z0-9-]{1,32}$/.test(sku)) throw new HttpError(400, "validation", "A SKU is letters, numbers, and hyphens.", { sku: "Check the SKU." });
    return { axisA, axisB, isFree, price, sku, available: row.available !== false };
  });
  const axes = new Set(rows.flatMap((row) => [row.axisA && "a", row.axisB && "b"]).filter(Boolean));
  if (axes.size > 2) throw new HttpError(400, "validation", "Use at most two choices, such as format and license.", { variants: "Use at most two choices." });
  const existing = await q<{ id: string }>("select id from listing_variants where post_id = $1 order by position", [id]);
  for (let i = 0; i < rows.length; i += 1) {
    if (existing[i]) {
      await q("update listing_variants set position=$2, axis_a=$3, axis_b=$4, is_free=$5, price_cents=$6, sku=$7, available=$8 where id=$1", [existing[i].id, i, rows[i].axisA, rows[i].axisB, rows[i].isFree, rows[i].price, rows[i].sku, rows[i].available]);
    } else {
      await q("insert into listing_variants (post_id, position, axis_a, axis_b, is_free, price_cents, sku, available) values ($1,$2,$3,$4,$5,$6,$7,$8)", [id, i, rows[i].axisA, rows[i].axisB, rows[i].isFree, rows[i].price, rows[i].sku, rows[i].available]);
    }
  }
  if (existing.length > rows.length) await q("delete from listing_variants where post_id = $1 and position >= $2", [id, rows.length]);
  const paid = rows.filter((row) => !row.isFree).map((row) => row.price || 0);
  if (paid.length) await q("update posts set price_mode = 'fixed', price_cents = $2 where id = $1", [id, Math.min(...paid)]);
  else await q("update posts set price_mode = 'free_advice', price_cents = null where id = $1", [id]);
}

async function pin(id: string, userId: string, on: boolean) {
  const count = await one<{ n: number }>("select count(*)::int as n from posts where author_id = $1 and featured = true and deleted_at is null and id <> $2", [userId, id]);
  if (on && (count?.n ?? 0) >= 4) throw new HttpError(400, "validation", "You can feature 4 listings.", { featured: "Unpin one first." });
  await q("update posts set featured = $2 where id = $1", [id, on]);
}

function whole(value: unknown, min: number, max: number, field: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new HttpError(400, "validation", "Use a whole number in range.", { [field]: "Check the number." });
  return value;
}

function clean(value: unknown, prior: unknown, max: number) {
  if (value == null) return String(prior || "");
  return cleanText(value, max, "text", "Text", { required: false, multiline: true });
}

function safeName(name: string) {
  const base = path.basename(name).replace(/["\r\n]/g, "").replace(/[^\w.\- ]+/g, "").slice(0, 80);
  return base || "download";
}

export function sniffDeliverable(data: Buffer) {
  assertSafePayload(data);
  const head = data.subarray(0, 16).toString("utf8");
  if (/^\s*</.test(head) || head.includes("<html") || head.includes("<svg") || head.startsWith("#!") || data[0] === 0x4d && data[1] === 0x5a) {
    throw new HttpError(400, "validation", "HTML, SVG, scripts, and programs are not accepted.", { file: "Choose a document, audio, or video file." });
  }
  if (data.subarray(0, 5).toString("ascii") === "%PDF-") return { kind: "pdf", mime: "application/pdf" };
  if (data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04) {
    const label = data.subarray(0, 120).toString("latin1").includes("mimetype") ? "epub" : "zip";
    return { kind: label, mime: label === "epub" ? "application/epub+zip" : "application/zip" };
  }
  if (data.subarray(0, 3).toString("ascii") === "ID3" || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)) return { kind: "mp3", mime: "audio/mpeg" };
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WAVE") return { kind: "wav", mime: "audio/wav" };
  if (data.subarray(4, 8).toString("ascii") === "ftyp") return { kind: "mp4", mime: "video/mp4" };
  if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) return { kind: "webm", mime: "video/webm" };
  throw new HttpError(400, "validation", "Use a PDF, EPUB, ZIP, MP3, WAV, MP4, or WebM file. ZIP files are stored as-is and are not opened or scanned.", { file: "That file type is not accepted." });
}

void limitFromEnv;
