import type { Hono } from "hono";
import { one, q } from "./db.js";
import { HttpError } from "./errors.js";
import { rateLimit } from "./rate.js";
import { cleanText, optionalUuid } from "./validate.js";

type SessionUser = { id: string; handle: string };
type App = Hono<{ Variables: { session: SessionUser | null } }>;

const PUBLIC_STATUSES = ["published", "disputed", "resolved"] as const;
const CATEGORIES = ["public_funds", "public_safety", "environment", "housing", "workplace", "services", "civic_process", "other"] as const;
const SUBJECTS = ["politician", "corporation", "community"] as const;
type Subject = (typeof SUBJECTS)[number];
type Category = (typeof CATEGORIES)[number];
type Status = "pending" | "published" | "disputed" | "resolved" | "withdrawn";

function requireUser(c: { get: (key: "session") => SessionUser | null }) {
  const session = c.get("session");
  if (!session) throw new HttpError(401, "unauthorized", "Log in to continue.");
  return session;
}

function parseId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new HttpError(404, "not_found", "Not found.");
  }
  return id;
}

async function bodyObject(c: { req: { text: () => Promise<string> } }) {
  const text = await c.req.text();
  if (text.length > 65_536) throw new HttpError(413, "too_large", "Request is too large.");
  if (!text) return {};
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "validation", "Request body must be a JSON object.");
    return value as Record<string, unknown>;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "validation", "Request body must be JSON.");
  }
}

async function isModerator(userId: string | null) {
  if (!userId) return false;
  const row = await one<{ is_moderator: boolean }>("select is_moderator from users where id = $1", [userId]);
  return Boolean(row?.is_moderator);
}

function httpUrl(value: unknown, field: string) {
  const text = cleanText(value, 500, field, "Source link");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new HttpError(400, "validation", "Source links must start with http:// or https://.", { [field]: "Use an http or https link." });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(400, "validation", "Source links must start with http:// or https://.", { [field]: "Use an http or https link." });
  }
  if (url.username || url.password) throw new HttpError(400, "validation", "Remove the username from that link.", { [field]: "Remove the username from that link." });
  return url.toString();
}

function areaLabel(value: unknown, field: string, label: string, required: boolean) {
  const text = cleanText(value ?? "", 120, field, label, { required });
  if (!text) return "";
  if (/^\s*\d+\s+\S+/.test(text) || /\b(apt|apartment|unit|suite|#)\s*\w+/i.test(text)) {
    throw new HttpError(400, "validation", "Use a neighborhood, city, or region. Do not enter a street address or home.", { [field]: "Use a neighborhood, city, or region." });
  }
  return text;
}

function roundCoord(value: unknown, field: string, min: number, max: number) {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new HttpError(400, "validation", "That map pin is out of range.", { [field]: "Choose a pin on the map." });
  }
  return Math.round(number * 100) / 100;
}

function readSources(value: unknown) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 8) throw new HttpError(400, "validation", "Add up to 8 source links.", { sources: "Add up to 8 source links." });
  return value.map((item, index) => {
    const row = item as { url?: unknown; label?: unknown };
    return { url: httpUrl(row?.url, `sources.${index}`), label: cleanText(row?.label ?? "", 140, "sourceLabel", "Source label", { required: false }) };
  });
}

function readReport(body: Record<string, unknown>) {
  const subjectType = body.subjectType;
  if (typeof subjectType !== "string" || !SUBJECTS.includes(subjectType as Subject)) {
    throw new HttpError(400, "validation", "Choose politician, corporation, or community.", { subjectType: "Choose a subject type." });
  }
  const category = body.category;
  if (typeof category !== "string" || !CATEGORIES.includes(category as Category)) {
    throw new HttpError(400, "validation", "Choose a category.", { category: "Choose a category." });
  }
  const subjectLabel = cleanText(body.subjectLabel, 120, "subjectLabel", "Subject");
  if (subjectLabel.length < 2) throw new HttpError(400, "validation", "Name the subject in your own words.", { subjectLabel: "Enter a name." });
  const subjectArea = areaLabel(body.subjectArea, "subjectArea", "Where the subject is based", false);
  const title = cleanText(body.title, 140, "title", "Title");
  const detail = cleanText(body.detail, 8000, "detail", "What you are alleging", { multiline: true });
  const locationLabel = areaLabel(body.locationLabel, "locationLabel", "Where this is said to have happened", true);
  let incidentDate: string | null = null;
  if (body.incidentDate) {
    const day = cleanText(body.incidentDate, 10, "incidentDate", "Date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) {
      throw new HttpError(400, "validation", "Use a real date.", { incidentDate: "Use YYYY-MM-DD." });
    }
    if (day > new Date().toISOString().slice(0, 10)) throw new HttpError(400, "validation", "The incident date cannot be in the future.", { incidentDate: "Choose today or earlier." });
    incidentDate = day;
  }
  const latitude = roundCoord(body.latitude, "latitude", -90, 90);
  const longitude = roundCoord(body.longitude, "longitude", -180, 180);
  if ((latitude == null) !== (longitude == null)) throw new HttpError(400, "validation", "Set both map coordinates, or neither.", { latitude: "Set both coordinates or clear the pin." });
  return {
    subjectType: subjectType as Subject,
    category: category as Category,
    subjectLabel,
    subjectArea,
    title,
    detail,
    locationLabel,
    incidentDate,
    latitude,
    longitude,
    sources: readSources(body.sources),
  };
}

const REPORT_FIELDS = `
  r.id, r.author_id, r.subject_type, r.subject_label, r.subject_area, r.category, r.title, r.detail,
  r.incident_date, r.location_label, r.latitude, r.longitude, r.status, r.public_note, r.created_at, r.updated_at,
  u.handle as author_handle, u.display_name as author_name,
  exists(select 1 from report_follows f where f.report_id = r.id and f.user_id = $1) as viewer_following
`;

function mapReport(row: Record<string, unknown>, includeDetail: boolean) {
  const status = String(row.status) as Status;
  const pub = PUBLIC_STATUSES.includes(status as typeof PUBLIC_STATUSES[number]);
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectLabel: row.subject_label,
    subjectArea: row.subject_area,
    category: row.category,
    title: row.title,
    detail: includeDetail ? row.detail : undefined,
    incidentDate: row.incident_date,
    locationLabel: row.location_label,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    status,
    framing: "allegation",
    verdict: null,
    publicNote: pub ? row.public_note : "",
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    author: { handle: row.author_handle, displayName: row.author_name },
    viewerFollowing: Boolean(row.viewer_following),
  };
}

function publicWhere(alias = "r") {
  return `${alias}.status in ('published', 'disputed', 'resolved')`;
}

async function loadReport(id: string, viewerId: string | null) {
  return one(`${`select ${REPORT_FIELDS} from reports r join users u on u.id = r.author_id where r.id = $2`}`, [viewerId, id]);
}

async function assertVisible(row: { author_id: string; status: string } | null, viewerId: string | null) {
  if (!row) throw new HttpError(404, "not_found", "Report not found.");
  if (PUBLIC_STATUSES.includes(row.status as typeof PUBLIC_STATUSES[number])) return;
  if (viewerId && viewerId === row.author_id) return;
  if (await isModerator(viewerId)) return;
  throw new HttpError(404, "not_found", "Report not found.");
}

export function registerReports(app: App) {
  app.get("/api/reports/map", async (c) => {
    const session = c.get("session");
    const { where, params } = await filters(c, session?.id ?? null, true);
    where.push("r.latitude is not null");
    const rows = await q(
      `select r.id, r.title, r.subject_type, r.subject_label, r.category, r.status, r.latitude, r.longitude, r.location_label, r.updated_at
       from reports r where ($1::uuid is null or true) and ${where.join(" and ")} order by r.updated_at desc limit 200`,
      params,
    );
    return c.json({
      reports: rows.map((row) => ({
        id: row.id,
        title: row.title,
        subjectType: row.subject_type,
        subjectLabel: row.subject_label,
        category: row.category,
        status: row.status,
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        locationLabel: row.location_label,
        updatedAt: new Date(row.updated_at as string).toISOString(),
      })),
    });
  });

  app.get("/api/reports", async (c) => {
    const session = c.get("session");
    const mine = c.req.query("mine") === "1";
    if (mine && !session) throw new HttpError(401, "unauthorized", "Log in to see your reports.");
    const { where, params } = await filters(c, session?.id ?? null, !mine);
    if (mine) {
      params.push(session!.id);
      where.push(`r.author_id = $${params.length}`);
    }
    const sort = c.req.query("sort") === "updated" ? "r.updated_at desc" : "r.created_at desc";
    const rows = await q(
      `select ${REPORT_FIELDS} from reports r join users u on u.id = r.author_id where ${where.join(" and ")} order by ${sort} limit 50`,
      params,
    );
    return c.json({ reports: rows.map((row) => mapReport(row as never, false)) });
  });

  app.get("/api/users/:handle/reports", async (c) => {
    const session = c.get("session");
    const handle = c.req.param("handle").toLowerCase();
    const user = await one<{ id: string }>("select id from users where handle = $1", [handle]);
    if (!user) throw new HttpError(404, "not_found", "Person not found.");
    const own = session?.id === user.id;
    const rows = await q(
      `select ${REPORT_FIELDS} from reports r join users u on u.id = r.author_id
       where r.author_id = $2 and (${own ? "true" : publicWhere("r")})
       order by r.updated_at desc limit 50`,
      [session?.id ?? null, user.id],
    );
    return c.json({ reports: rows.map((row) => mapReport(row as never, false)) });
  });

  app.post("/api/reports", async (c) => {
    const session = requireUser(c);
    await rateLimit(`report:${session.id}`, 10, 3600);
    const body = await bodyObject(c);
    const input = readReport(body);
    const row = await one<{ id: string }>(
      `insert into reports (author_id, subject_type, subject_label, subject_area, category, title, detail, incident_date, location_label, latitude, longitude)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [session.id, input.subjectType, input.subjectLabel, input.subjectArea, input.category, input.title, input.detail, input.incidentDate, input.locationLabel, input.latitude, input.longitude],
    );
    for (const source of input.sources) {
      await q("insert into report_sources (report_id, url, label) values ($1,$2,$3)", [row?.id, source.url, source.label]);
    }
    await q("insert into report_events (report_id, actor_id, action, note) values ($1,$2,'submitted','Report submitted for moderation.')", [row?.id, session.id]);
    const full = await loadReport(row!.id, session.id);
    return c.json({ report: await present(full as never, true) }, 201);
  });

  app.get("/api/reports/moderation-status", async (c) => {
    const row = await one<{ configured: boolean }>("select exists(select 1 from users where is_moderator) as configured");
    return c.json({ configured: Boolean(row?.configured) });
  });

  app.get("/api/reports/:id", async (c) => {
    const session = c.get("session");
    const id = parseId(c.req.param("id"));
    const row = await loadReport(id, session?.id ?? null);
    await assertVisible(row as { author_id: string; status: string } | null, session?.id ?? null);
    const report = await present(row as never, true);
    if (session && session.id === (row as { author_id: string }).author_id) {
      const files = await q<{ media_id: string }>("select media_id from report_attachments where report_id = $1", [id]);
      (report as { attachments?: Array<{ id: string; url: string }> }).attachments = files.map((file) => ({ id: file.media_id, url: `/api/reports/${id}/attachments/${file.media_id}` }));
    }
    return c.json({ report });
  });

  app.patch("/api/reports/:id", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const existing = await one<Record<string, string>>("select * from reports where id = $1", [id]);
    if (!existing) throw new HttpError(404, "not_found", "Report not found.");
    if (existing.author_id !== session.id) throw new HttpError(403, "forbidden", "You can only edit your own report.");
    if (existing.status === "withdrawn") throw new HttpError(400, "validation", "A withdrawn report cannot be edited.");
    const input = readReport(await bodyObject(c));
    const wasPublic = PUBLIC_STATUSES.includes(existing.status as typeof PUBLIC_STATUSES[number]);
    await q(
      `insert into report_revisions (report_id, editor_id, title, detail, subject_label, category, location_label, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, session.id, existing.title, existing.detail, existing.subject_label, existing.category, existing.location_label, existing.status],
    );
    await q(
      `update reports set subject_type=$1, subject_label=$2, subject_area=$3, category=$4, title=$5, detail=$6, incident_date=$7,
         location_label=$8, latitude=$9, longitude=$10, status='pending', updated_at=now() where id=$11 and author_id=$12`,
      [input.subjectType, input.subjectLabel, input.subjectArea, input.category, input.title, input.detail, input.incidentDate, input.locationLabel, input.latitude, input.longitude, id, session.id],
    );
    await q("delete from report_sources where report_id = $1", [id]);
    for (const source of input.sources) await q("insert into report_sources (report_id, url, label) values ($1,$2,$3)", [id, source.url, source.label]);
    await q(
      "insert into report_events (report_id, actor_id, action, note) values ($1,$2,$3,$4)",
      [id, session.id, wasPublic ? "returned_for_review" : "edited", wasPublic ? "An edit removed this allegation from public view until a moderator reviews it again." : "The author edited the pending report."],
    );
    const full = await loadReport(id, session.id);
    return c.json({ report: await present(full as never, true) });
  });

  app.post("/api/reports/:id/withdraw", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const existing = await one<{ author_id: string }>("select author_id from reports where id = $1", [id]);
    if (!existing) throw new HttpError(404, "not_found", "Report not found.");
    if (existing.author_id !== session.id) throw new HttpError(403, "forbidden", "You can only withdraw your own report.");
    await q("update reports set status = 'withdrawn', updated_at = now() where id = $1", [id]);
    await q("insert into report_events (report_id, actor_id, action, note) values ($1,$2,'withdrawn','The author withdrew this report. It is no longer public.')", [id, session.id]);
    return c.json({ ok: true, status: "withdrawn" });
  });

  app.post("/api/reports/:id/follow", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const row = await one<{ status: string }>("select status from reports where id = $1", [id]);
    if (!row || !PUBLIC_STATUSES.includes(row.status as typeof PUBLIC_STATUSES[number])) throw new HttpError(404, "not_found", "Report not found.");
    await q("insert into report_follows (user_id, report_id) values ($1,$2) on conflict do nothing", [session.id, id]);
    return c.json({ following: true });
  });

  app.delete("/api/reports/:id/follow", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    await q("delete from report_follows where user_id = $1 and report_id = $2", [session.id, id]);
    return c.json({ following: false });
  });

  app.post("/api/reports/watches", async (c) => {
    const session = requireUser(c);
    const body = await bodyObject(c);
    const kind = body.kind;
    if (kind !== "category" && kind !== "subject" && kind !== "area") throw new HttpError(400, "validation", "Choose a category, subject, or area to follow.");
    const category = kind === "category" ? body.category : null;
    if (kind === "category" && (typeof category !== "string" || !CATEGORIES.includes(category as Category))) throw new HttpError(400, "validation", "Choose a category.");
    const subjectType = kind === "subject" ? body.subjectType : null;
    const subjectLabel = kind === "subject" ? cleanText(body.subjectLabel, 120, "subjectLabel", "Subject") : null;
    if (kind === "subject" && (typeof subjectType !== "string" || !SUBJECTS.includes(subjectType as Subject))) throw new HttpError(400, "validation", "Choose a subject type.");
    const area = kind === "area" ? areaLabel(body.area, "area", "Area", true) : null;
    await q(
      `insert into report_watches (user_id, kind, category, subject_type, subject_label, area) values ($1,$2,$3,$4,$5,$6)
       on conflict do nothing`,
      [session.id, kind, category, subjectType, subjectLabel, area],
    );
    return c.json({ ok: true });
  });

  app.get("/api/reports/watches", async (c) => {
    const session = requireUser(c);
    const rows = await q("select id, kind, category, subject_type, subject_label, area from report_watches where user_id = $1 order by created_at desc", [session.id]);
    return c.json({ watches: rows });
  });

  app.delete("/api/reports/watches/:id", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    await q("delete from report_watches where id = $1 and user_id = $2", [id, session.id]);
    return c.json({ ok: true });
  });

  app.post("/api/reports/:id/flags", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const row = await one<{ status: string }>("select status from reports where id = $1", [id]);
    if (!row || !PUBLIC_STATUSES.includes(row.status as typeof PUBLIC_STATUSES[number])) throw new HttpError(404, "not_found", "Report not found.");
    const reason = cleanText((await bodyObject(c)).reason, 1000, "reason", "Reason", { multiline: true });
    await q("insert into report_flags (report_id, user_id, reason) values ($1,$2,$3)", [id, session.id, reason]);
    await q("insert into report_events (report_id, actor_id, action, note) values ($1,$2,'flagged','A reader flagged this report for a moderator. The reason is not published.')", [id, session.id]);
    return c.json({ ok: true });
  });

  app.post("/api/reports/:id/disputes", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const row = await one<{ status: string }>("select status from reports where id = $1", [id]);
    if (!row || !PUBLIC_STATUSES.includes(row.status as typeof PUBLIC_STATUSES[number])) throw new HttpError(404, "not_found", "Report not found.");
    const statement = cleanText((await bodyObject(c)).statement, 4000, "statement", "Statement", { multiline: true });
    await q("insert into report_disputes (report_id, user_id, statement) values ($1,$2,$3)", [id, session.id, statement]);
    await q("insert into report_events (report_id, actor_id, action, note) values ($1,$2,'reply_requested','A right-of-reply was requested. Spekup does not contact anyone about it.')", [id, session.id]);
    return c.json({ ok: true, delivery: "internal_only" });
  });

  app.post("/api/reports/:id/attachments", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const report = await one<{ author_id: string }>("select author_id from reports where id = $1", [id]);
    if (!report || report.author_id !== session.id) throw new HttpError(404, "not_found", "Report not found.");
    const mediaId = optionalUuid((await bodyObject(c)).mediaId, "mediaId");
    if (!mediaId) throw new HttpError(400, "validation", "Upload a file first.", { mediaId: "Upload a file first." });
    const media = await one<{ owner_id: string }>("select owner_id from media where id = $1", [mediaId]);
    if (!media || media.owner_id !== session.id) throw new HttpError(400, "validation", "That file isn't yours.", { mediaId: "Upload your own file." });
    await q("insert into report_attachments (report_id, media_id) values ($1,$2) on conflict do nothing", [id, mediaId]);
    return c.json({ ok: true, public: false });
  });

  app.get("/api/reports/:id/attachments/:mediaId", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const mediaId = parseId(c.req.param("mediaId"));
    const report = await one<{ author_id: string }>("select author_id from reports where id = $1", [id]);
    if (!report) throw new HttpError(404, "not_found", "Report not found.");
    const mod = await isModerator(session.id);
    if (report.author_id !== session.id && !mod) throw new HttpError(404, "not_found", "File not found.");
    const link = await one<{ storage_key: string }>(
      `select m.storage_key from report_attachments a join media m on m.id = a.media_id where a.report_id = $1 and a.media_id = $2`,
      [id, mediaId],
    );
    if (!link) throw new HttpError(404, "not_found", "File not found.");
    const { readFile } = await import("node:fs/promises");
    const { mediaPath } = await import("./media.js");
    const full = mediaPath(link.storage_key);
    if (!full) throw new HttpError(404, "not_found", "File not found.");
    const data = await readFile(full);
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Disposition": "inline" },
    });
  });

  app.get("/api/moderation/reports", async (c) => {
    const session = await requireMod(c);
    const rows = await q(
      `select ${REPORT_FIELDS} from reports r join users u on u.id = r.author_id
       where r.status = 'pending' order by r.created_at asc limit 50`,
      [session.id],
    );
    return c.json({ reports: rows.map((row) => mapReport(row as never, true)) });
  });

  app.post("/api/moderation/reports/:id/publish", async (c) => {
    const session = await requireMod(c);
    const id = parseId(c.req.param("id"));
    const report = await one<{ status: string }>("select status from reports where id = $1", [id]);
    if (!report) throw new HttpError(404, "not_found", "Report not found.");
    const sources = await one<{ n: number }>("select count(*)::int as n from report_sources where report_id = $1", [id]);
    if (!sources || sources.n < 1) throw new HttpError(400, "validation", "A public allegation needs at least one http or https source.", { sources: "Add a source before publishing." });
    await q("update reports set status = 'published', updated_at = now() where id = $1", [id]);
    await q("insert into report_events (report_id, actor_id, action, note) values ($1,$2,'published','A moderator published this allegation. Publication is not a finding of guilt.')", [id, session.id]);
    return c.json({ ok: true, status: "published" });
  });

  app.post("/api/moderation/reports/:id/dispute", async (c) => {
    const session = await requireMod(c);
    const id = parseId(c.req.param("id"));
    const note = cleanText((await bodyObject(c)).publicNote ?? "", 2000, "publicNote", "Public note", { required: false, multiline: true });
    const report = await one("select 1 from reports where id = $1", [id]);
    if (!report) throw new HttpError(404, "not_found", "Report not found.");
    await q("update reports set status = 'disputed', public_note = $2, updated_at = now() where id = $1", [id, note]);
    await q("insert into report_events (report_id, actor_id, action, note) values ($1,$2,'disputed','A moderator marked this allegation disputed. No one was contacted.')", [id, session.id]);
    return c.json({ ok: true, status: "disputed" });
  });

  app.post("/api/moderation/reports/:id/resolve", async (c) => {
    const session = await requireMod(c);
    const id = parseId(c.req.param("id"));
    const note = cleanText((await bodyObject(c)).publicNote ?? "", 2000, "publicNote", "Public note", { required: false, multiline: true });
    const report = await one("select 1 from reports where id = $1", [id]);
    if (!report) throw new HttpError(404, "not_found", "Report not found.");
    await q("update reports set status = 'resolved', public_note = $2, updated_at = now() where id = $1", [id, note]);
    await q("insert into report_events (report_id, actor_id, action, note) values ($1,$2,'resolved','A moderator marked this record resolved. That is not a court finding.')", [id, session.id]);
    return c.json({ ok: true, status: "resolved" });
  });

  app.post("/api/moderation/reports/:id/takedown", async (c) => {
    const session = await requireMod(c);
    const id = parseId(c.req.param("id"));
    const report = await one("select 1 from reports where id = $1", [id]);
    if (!report) throw new HttpError(404, "not_found", "Report not found.");
    await q("update reports set status = 'withdrawn', updated_at = now() where id = $1", [id]);
    await q("insert into report_events (report_id, actor_id, action, note) values ($1,$2,'takedown','A moderator removed this report from public view.')", [id, session.id]);
    return c.json({ ok: true, status: "withdrawn" });
  });

  app.post("/api/flags", async (c) => {
    const session = requireUser(c);
    await rateLimit(`flag:${session.id}`, 20, 3600);
    const body = await bodyObject(c);
    const targetType = body.targetType === "comment" ? "comment" : body.targetType === "post" ? "post" : "";
    if (!targetType) throw new HttpError(400, "validation", "Choose a post or a comment.", { targetType: "Choose a post or a comment." });
    const targetId = parseId(String(body.targetId || ""));
    const reasons = ["spam", "harassment", "scam", "unsafe", "misinformation", "other"] as const;
    const reason = reasons.find((item) => item === body.reason);
    if (!reason) throw new HttpError(400, "validation", "Choose a reason.", { reason: "Choose a reason." });
    const note = cleanText(body.note ?? "", 500, "note", "Note", { required: false, multiline: true });
    if (targetType === "post") {
      const post = await one<{ author_id: string; deleted_at: Date | null }>("select author_id, deleted_at from posts where id = $1", [targetId]);
      if (!post || post.deleted_at) throw new HttpError(404, "not_found", "Post not found.");
      if (post.author_id === session.id) throw new HttpError(400, "validation", "You can't report your own post.");
    } else {
      const comment = await one<{ author_id: string; deleted_at: Date | null }>("select author_id, deleted_at from comments where id = $1", [targetId]);
      if (!comment || comment.deleted_at) throw new HttpError(404, "not_found", "Comment not found.");
      if (comment.author_id === session.id) throw new HttpError(400, "validation", "You can't report your own comment.");
    }
    const existing = await one<{ id: string }>(
      "select id from content_flags where reporter_id = $1 and target_type = $2 and target_id = $3 and status = 'open'",
      [session.id, targetType, targetId],
    );
    if (existing) return c.json({ ok: true, already: true, hidden: false, message: "Thanks. Saved for review. No moderator is assigned yet." });
    try {
      await q(
        "insert into content_flags (reporter_id, target_type, target_id, reason, note) values ($1,$2,$3,$4,$5)",
        [session.id, targetType, targetId, reason, note],
      );
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "23505") return c.json({ ok: true, already: true, hidden: false, message: "Thanks. Saved for review. No moderator is assigned yet." });
      throw err;
    }
    return c.json({ ok: true, already: false, hidden: false, message: "Thanks. Saved for review. No moderator is assigned yet." }, 201);
  });

  app.get("/api/moderation/flags", async (c) => {
    const session = await requireMod(c);
    const rows = await q<{ id: string; reason: string; note: string; target_type: string; target_id: string; created_at: Date; handle: string }>(
      `select f.id, f.reason, f.note, f.target_type, f.target_id, f.created_at, u.handle
       from content_flags f join users u on u.id = f.reporter_id
       where f.status = 'open' order by f.created_at desc limit 50`,
    );
    return c.json({
      flags: rows.map((row) => ({
        id: row.id, reason: row.reason, note: row.note, targetType: row.target_type, targetId: row.target_id,
        createdAt: new Date(row.created_at).toISOString(), reporterHandle: row.handle,
      })),
    });
  });
}

async function requireMod(c: { get: (key: "session") => SessionUser | null }) {
  const session = requireUser(c);
  if (!(await isModerator(session.id))) throw new HttpError(403, "forbidden", "A moderator role is required. It is not granted by editing a profile.");
  return session;
}

async function filters(c: { req: { query: (name: string) => string | undefined } }, viewerId: string | null, publicOnly: boolean) {
  const params: unknown[] = [viewerId];
  const where = [publicOnly ? publicWhere("r") : "true"];
  const subjectType = c.req.query("subjectType");
  if (subjectType) {
    if (!SUBJECTS.includes(subjectType as Subject)) throw new HttpError(400, "validation", "Unknown subject type.");
    params.push(subjectType);
    where.push(`r.subject_type = $${params.length}`);
  }
  const category = c.req.query("category");
  if (category) {
    if (!CATEGORIES.includes(category as Category)) throw new HttpError(400, "validation", "Unknown category.");
    params.push(category);
    where.push(`r.category = $${params.length}`);
  }
  const status = c.req.query("status");
  if (status) {
    if (!PUBLIC_STATUSES.includes(status as typeof PUBLIC_STATUSES[number]) && publicOnly) {
      where.push("false");
    } else if (PUBLIC_STATUSES.includes(status as typeof PUBLIC_STATUSES[number]) || !publicOnly) {
      params.push(status);
      where.push(`r.status = $${params.length}`);
    }
  }
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    params.push(from);
    where.push(`r.incident_date >= $${params.length}`);
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    params.push(to);
    where.push(`r.incident_date <= $${params.length}`);
  }
  const area = (c.req.query("area") || "").trim();
  if (area) {
    params.push(`%${area.slice(0, 80).replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    where.push(`r.location_label ilike $${params.length} escape '\\'`);
  }
  const text = (c.req.query("q") || "").trim();
  if (text) {
    params.push(`%${text.slice(0, 80).replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    const n = `$${params.length}`;
    where.push(`(r.title ilike ${n} escape '\\' or r.detail ilike ${n} escape '\\' or r.subject_label ilike ${n} escape '\\')`);
  }
  const bbox = c.req.query("bbox");
  if (bbox) {
    const parts = bbox.split(",").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new HttpError(400, "validation", "Map bounds must be west,south,east,north.");
    const [west, south, east, north] = parts;
    params.push(west, south, east, north);
    const base = params.length - 3;
    where.push(`r.longitude between $${base} and $${base + 2} and r.latitude between $${base + 1} and $${base + 3}`);
  }
  if (c.req.query("following") === "1") {
    if (!viewerId) throw new HttpError(401, "unauthorized", "Log in to use Following.");
    where.push(`(
      exists (select 1 from report_follows f where f.report_id = r.id and f.user_id = $1)
      or exists (select 1 from report_watches w where w.user_id = $1 and w.kind = 'category' and w.category = r.category)
      or exists (select 1 from report_watches w where w.user_id = $1 and w.kind = 'subject' and w.subject_type = r.subject_type and lower(w.subject_label) = lower(r.subject_label))
      or exists (select 1 from report_watches w where w.user_id = $1 and w.kind = 'area' and lower(w.area) = lower(r.location_label))
    )`);
  }
  return { where, params };
}

async function present(row: Record<string, unknown>, withSources: boolean) {
  const report = mapReport(row, true);
  const sources = withSources
    ? await q("select url, label, created_at from report_sources where report_id = $1 order by created_at", [row.id])
    : [];
  const events = await q(
    "select action, note, created_at from report_events where report_id = $1 and action <> 'flagged' order by created_at",
    [row.id],
  );
  return {
    ...report,
    sources: sources.map((source) => ({ url: source.url, label: source.label, createdAt: new Date(source.created_at as string).toISOString() })),
    history: events.map((event) => ({ action: event.action, note: event.note, createdAt: new Date(event.created_at as string).toISOString() })),
  };
}
