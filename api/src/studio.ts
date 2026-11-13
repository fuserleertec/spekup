import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { one, pool, q } from "./db.js";
import { HttpError } from "./errors.js";
import { readUpload, mediaDir } from "./media.js";
import { limitFromEnv, rateLimit } from "./rate.js";
import { assertPlainText, isSpeed, parseCaptionFile, probeAudio, renderedDurationMs } from "./studio-render.js";
import { localToUtc, requireTimezone } from "./time.js";
import { cleanText, optionalUuid, requireTopic } from "./validate.js";
import { safeMediaFile } from "./video.js";

type SessionUser = { id: string; handle: string; display_name: string };
type App = { get: Function; post: Function; patch: Function; put: Function; delete: Function };

type Ctx = {
  get: (key: "session") => SessionUser | null;
  json: (body: unknown, status?: number) => Response;
  req: { param: (name: string) => string; text: () => Promise<string>; query: (name: string) => string | undefined; raw: Request };
};


const TEMPLATES = ["none", "grow", "harvest", "prep", "sourcing", "volunteer", "community_lesson"] as const;
const CARD_KINDS = ["offer", "ask", "cause", "group", "event", "playbook"] as const;

function requireUser(c: Ctx) {
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
  const value = JSON.parse(text) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "validation", "Request body must be a JSON object.");
  return value as Record<string, unknown>;
}

async function ownProject(id: string, userId: string) {
  const row = await one<Record<string, unknown>>("select * from studio_projects where id = $1 and deleted_at is null", [id]);
  if (!row || row.owner_id !== userId) throw new HttpError(404, "not_found", "Studio project not found.");
  return row;
}

async function event(projectId: string, actorId: string | null, action: string, note = "") {
  await q("insert into studio_events (project_id, actor_id, action, note) values ($1,$2,$3,$4)", [projectId, actorId, action, note.slice(0, 400)]);
}

function volume(value: unknown, field: string) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new HttpError(400, "validation", "Volume must be between 0 and 1.", { [field]: "Use 0 to 1." });
  }
  return Math.round(number * 100) / 100;
}

async function markVisual(id: string) {
  await q(
    `update studio_projects
     set edit_version = edit_version + 1, status = 'draft', scheduled_at = null, updated_at = now()
     where id = $1`,
    [id],
  );
  await q("update studio_jobs set status = 'canceled', finished_at = now() where project_id = $1 and status = 'queued'", [id]);
}

async function holdIfReviewed(project: Record<string, unknown>) {
  if (!project.health_claim || project.review_status !== "approved") return;
  await q("update studio_projects set review_status = 'pending', scheduled_at = null, status = 'pending_review', updated_at = now() where id = $1", [project.id]);
  await q("update posts set held_for_review = true, updated_at = now() where studio_project_id = $1 and deleted_at is null", [project.id]);
  await event(String(project.id), String(project.owner_id), "review_invalidated", "A material edit needs review again. The old schedule was canceled.");
}

export async function publishDue() {
  await q(
    `update studio_projects set status = 'scheduled', updated_at = now()
     where status = 'publishing' and published_post_id is null and updated_at < now() - interval '2 minutes'`,
  );
  const client = await pool.connect();
  try {
    await client.query("begin");
    const found = await client.query<{ id: string }>(
      `select id from studio_projects
       where status = 'scheduled' and scheduled_at <= now() and published_post_id is null and deleted_at is null
       order by scheduled_at
       for update skip locked
       limit 1`,
    );
    const row = found.rows[0];
    if (!row) {
      await client.query("commit");
      return false;
    }
    await client.query("update studio_projects set status = 'publishing', updated_at = now() where id = $1", [row.id]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
  const due = await one<{ id: string; owner_id: string }>(
    "select id, owner_id from studio_projects where status = 'publishing' and published_post_id is null order by updated_at limit 1",
  );
  if (!due) return false;
  try {
    await publishProject(due.id, due.owner_id, true);
  } catch (err) {
    await q("update studio_projects set status = 'scheduled', updated_at = now() where id = $1 and published_post_id is null", [due.id]);
    await event(due.id, null, "publish_retry", err instanceof Error ? err.message.slice(0, 240) : "Publish failed.");
  }
  return true;
}

async function publishProject(id: string, userId: string, fromSchedule: boolean) {
  const project = await ownProject(id, userId);
  if (project.rendered_version !== project.edit_version || !project.output_video_id) {
    throw new HttpError(409, "conflict", "Render the current edit before publishing. A post is not created from an unfinished render.");
  }
  const output = await one<{ status: string }>("select status from videos where id = $1 and owner_id = $2 and purpose = 'render'", [project.output_video_id, userId]);
  if (!output || output.status !== "ready") throw new HttpError(409, "conflict", "The rendered clip is not ready.");
  if (!project.rights_declared) throw new HttpError(400, "validation", "Confirm you have the right to share this recording.", { rights: "Confirm recording rights." });
  if (!String(project.body || "").trim()) throw new HttpError(400, "validation", "Add a description before publishing.", { body: "Add a description." });
  if (project.health_claim && project.review_status !== "approved") {
    const reviewers = await one<{ n: number }>("select count(*)::int as n from users where is_moderator = true");
    const reason = (reviewers?.n ?? 0) > 0
      ? "A health or clinical promotion stays private until a reviewer approves it. This app does not decide whether the claim is true."
      : "A health or clinical promotion stays private because no reviewer is configured. Nothing was published.";
    throw new HttpError(409, "conflict", reason);
  }
  if (!fromSchedule && project.status === "scheduled") {
    throw new HttpError(409, "conflict", "Cancel the schedule before publishing now.");
  }
  const cards = await q<{ kind: string; target_id: string; position: number }>("select kind, target_id, position from studio_cards where project_id = $1 order by position", [id]);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const locked = await client.query("select published_post_id, rendered_version, edit_version from studio_projects where id = $1 for update", [id]);
    const current = locked.rows[0] as { published_post_id: string | null; rendered_version: number; edit_version: number };
    if (current.rendered_version !== current.edit_version) throw new HttpError(409, "conflict", "Render the current edit before publishing.");
    let postId = current.published_post_id;
    if (!postId) {
      const inserted = await client.query(
        `insert into posts (author_id, kind, title, body, topic, video_id, group_id, studio_project_id, disclosure_sponsor, disclosure_paid, disclosure_ai, comments_enabled, download_allowed, held_for_review, caption_mode, cover_headline)
         values ($1,'share',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13,$14) returning id`,
        [userId, project.title, project.body, project.topic, project.output_video_id, project.group_id, id, project.disclosure_sponsor, project.disclosure_paid, project.disclosure_ai, project.comments_enabled, project.download_allowed, project.caption_mode, project.cover_headline],
      );
      postId = inserted.rows[0].id as string;
    } else {
      await client.query(
        `update posts set title = $2, body = $3, topic = $4, video_id = $5, group_id = $6, disclosure_sponsor = $7, disclosure_paid = $8, disclosure_ai = $9,
           comments_enabled = $10, download_allowed = $11, held_for_review = false, caption_mode = $12, cover_headline = $13, deleted_at = null, updated_at = now()
         where id = $1 and author_id = $14`,
        [postId, project.title, project.body, project.topic, project.output_video_id, project.group_id, project.disclosure_sponsor, project.disclosure_paid, project.disclosure_ai, project.comments_enabled, project.download_allowed, project.caption_mode, project.cover_headline, userId],
      );
    }
    await client.query("delete from post_cards where post_id = $1", [postId]);
    for (const card of cards) {
      await client.query("insert into post_cards (post_id, position, kind, target_id) values ($1,$2,$3,$4)", [postId, card.position, card.kind, card.target_id]);
    }
    const updated = await client.query(
      "update studio_projects set published_post_id = $2, status = 'published', scheduled_at = null, updated_at = now() where id = $1 and published_post_id is not distinct from $3 returning id",
      [id, postId, current.published_post_id],
    );
    if (!updated.rowCount) throw new HttpError(409, "conflict", "This project was already published.");
    await client.query("commit");
    await event(id, userId, fromSchedule ? "published_schedule" : "published", "One post.");
    return postId;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

async function cardVisible(kind: string, targetId: string, viewerId: string | null) {
  if (kind === "offer" || kind === "ask") {
    const row = await one<{ title: string; availability: string; author_id: string }>(
      `select p.title, p.availability, p.author_id from posts p
       where p.id = $2 and p.kind = $3 and p.deleted_at is null and p.held_for_review = false
         and p.availability <> 'archived' and p.listing_status = 'published' and (p.expires_at is null or p.expires_at > now())
         and (p.group_id is null or p.author_id = $1
           or exists (select 1 from groups g where g.id = p.group_id and g.visibility = 'public')
           or exists (select 1 from group_members m where m.group_id = p.group_id and m.user_id = $1))`,
      [viewerId, targetId, kind],
    );
    if (!row) return { title: null as string | null, note: "" };
    return { title: row.title, note: kind === "offer" ? `Listing · ${row.availability}. Payments are not available.` : "Help request" };
  }
  if (kind === "cause") {
    const row = await one<{ title: string }>(
      `select c.title from causes c
       where c.id = $2 and c.status <> 'draft'
         and (c.organizer_id = $1 or c.group_id is null or exists (select 1 from groups g where g.id = c.group_id and g.visibility = 'public')
           or exists (select 1 from group_members m where m.group_id = c.group_id and m.user_id = $1))`,
      [viewerId, targetId],
    );
    return row ? { title: row.title, note: "Cause · pledged, not collected." } : { title: null, note: "" };
  }
  if (kind === "group") {
    const row = await one<{ name: string }>(
      `select name from groups g where g.id = $2 and (g.visibility = 'public' or exists (select 1 from group_members m where m.group_id = g.id and m.user_id = $1))`,
      [viewerId, targetId],
    );
    return row ? { title: row.name, note: "Group" } : { title: null, note: "" };
  }
  if (kind === "event") {
    const row = await one<{ title: string }>(
      `select e.title from events e
       where e.id = $2 and e.status = 'scheduled'
         and (e.group_id is null or e.organizer_id = $1
           or exists (select 1 from groups g where g.id = e.group_id and g.visibility = 'public')
           or exists (select 1 from group_members m where m.group_id = e.group_id and m.user_id = $1))`,
      [viewerId, targetId],
    );
    return row ? { title: row.title, note: "Gathering" } : { title: null, note: "" };
  }
  const playbook = await one<{ title: string }>("select title from playbooks where id = $1 and deleted_at is null", [targetId]);
  return playbook ? { title: playbook.title, note: "Community guide · not reviewed" } : { title: null, note: "" };
}

export async function attachCards(posts: Array<{ id: string; cards?: unknown }>, viewerId: string | null) {
  if (!posts.length) return;
  const rows = await q<{ post_id: string; kind: string; target_id: string; position: number }>(
    "select post_id, kind, target_id, position from post_cards where post_id = any($1::uuid[]) order by position",
    [posts.map((post) => post.id)],
  );
  const byPost = new Map<string, Array<{ kind: string; targetId: string; title: string | null; note: string; unavailable: boolean }>>();
  for (const row of rows) {
    const visible = await cardVisible(row.kind, row.target_id, viewerId);
    const list = byPost.get(row.post_id) || [];
    list.push({ kind: row.kind, targetId: visible.title ? row.target_id : "", title: visible.title, note: visible.title ? visible.note : "", unavailable: !visible.title });
    byPost.set(row.post_id, list);
  }
  for (const post of posts) post.cards = byPost.get(post.id) || [];
}

async function present(id: string, userId: string) {
  const project = await ownProject(id, userId);
  const segments = await q("select video_id, start_ms, end_ms, speed, position from studio_segments where project_id = $1 order by position", [id]);
  const overlays = await q("select start_ms, end_ms, text, x_pct, y_pct, size, position from studio_overlays where project_id = $1 order by position", [id]);
  const captions = await q("select start_ms, end_ms, text, position from studio_captions where project_id = $1 order by position", [id]);
  const cards = await q<{ kind: string; target_id: string; position: number }>("select kind, target_id, position from studio_cards where project_id = $1 order by position", [id]);
  const job = await one("select status, error, edit_version from studio_jobs where project_id = $1 and kind = 'render' order by created_at desc limit 1", [id]);
  const resolved = [];
  for (const card of cards) {
    const visible = await cardVisible(card.kind, card.target_id, userId);
    resolved.push({ kind: card.kind, targetId: card.target_id, title: visible.title, note: visible.note, unavailable: !visible.title });
  }
  const reviewers = await one<{ n: number }>("select count(*)::int as n from users where is_moderator = true");
  return {
    project: {
      ...publicProject(project),
      segments: segments.map((segment) => ({ videoId: segment.video_id, startMs: segment.start_ms, endMs: segment.end_ms, speed: Number(segment.speed) })),
      overlays: overlays.map((item) => ({ startMs: item.start_ms, endMs: item.end_ms, text: item.text, x: item.x_pct, y: item.y_pct, size: item.size })),
      captions: captions.map((item) => ({ startMs: item.start_ms, endMs: item.end_ms, text: item.text })),
      cards: resolved,
      render: job ? { phase: job.status, message: job.error, percent: null, version: job.edit_version } : { phase: "draft", message: null, percent: null, version: null },
      reviewersConfigured: (reviewers?.n ?? 0) > 0,
      transcription: { connected: false, message: "Automatic transcription is not connected." },
    },
  };
}

function publicProject(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    topic: row.topic,
    template: row.template,
    groupId: row.group_id,
    status: row.status,
    editVersion: row.edit_version,
    originalVolume: Number(row.original_volume),
    voiceVolume: Number(row.voice_volume),
    voiceoverId: row.voiceover_id,
    captionMode: row.caption_mode,
    commentsEnabled: row.comments_enabled,
    downloadAllowed: row.download_allowed,
    remixPermission: row.remix_permission,
    disclosureSponsor: row.disclosure_sponsor,
    disclosurePaid: row.disclosure_paid,
    disclosureAi: row.disclosure_ai,
    rightsDeclared: row.rights_declared,
    healthClaim: row.health_claim,
    reviewStatus: row.review_status,
    coverHeadline: row.cover_headline,
    coverTimeMs: row.cover_time_ms,
    timezone: row.timezone,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at as string).toISOString() : null,
    publishedPostId: row.published_post_id,
    outputVideoId: row.output_video_id,
    renderedVersion: row.rendered_version,
    limits: { maxSeconds: 30, maxBytes: 40 * 1024 * 1024, speeds: [0.5, 1, 1.5, 2], preview: "approximate" },
  };
}

export function registerStudio(app: App) {
  app.get("/api/studio/transcription", (c: Ctx) => {
    requireUser(c);
    return c.json({ connected: false, message: "Automatic transcription is not connected." });
  });

  app.post("/api/studio/transcription", () => {
    throw new HttpError(501, "not_enabled", "Automatic transcription is not connected. Add captions yourself or import an SRT or VTT file.");
  });

  app.get("/api/studio/projects", async (c: Ctx) => {
    const session = requireUser(c);
    const rows = await q("select * from studio_projects where owner_id = $1 and deleted_at is null order by updated_at desc limit 30", [session.id]);
    return c.json({ projects: rows.map((row) => publicProject(row as Record<string, unknown>)) });
  });

  app.post("/api/studio/projects", async (c: Ctx) => {
    const session = requireUser(c);
    await rateLimit(`studio:${session.id}`, 30, 3600);
    const body = await bodyObject(c);
    const title = cleanText(body.title, 140, "title", "Title");
    const template = TEMPLATES.includes(body.template as typeof TEMPLATES[number]) ? body.template : "none";
    const row = await one<{ id: string }>(
      "insert into studio_projects (owner_id, title, template) values ($1,$2,$3) returning id",
      [session.id, title, template],
    );
    await event(row!.id, session.id, "created", "");
    return c.json(await present(row!.id, session.id), 201);
  });

  app.get("/api/studio/projects/:id", async (c: Ctx) => {
    const session = requireUser(c);
    return c.json(await present(parseId(c.req.param("id")), session.id));
  });

  app.patch("/api/studio/projects/:id", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const project = await ownProject(id, session.id);
    const body = await bodyObject(c);
    const title = body.title == null ? project.title : cleanText(body.title, 140, "title", "Title");
    const text = body.body == null ? project.body : cleanText(body.body, 4000, "body", "Description", { required: false, multiline: true });
    const topic = body.topic == null ? project.topic : requireTopic(body.topic);
    const template = body.template == null ? project.template : TEMPLATES.includes(body.template as typeof TEMPLATES[number]) ? body.template : null;
    if (!template) throw new HttpError(400, "validation", "Choose a template.", { template: "Choose a template." });
    const groupId = body.groupId === undefined ? project.group_id : optionalUuid(body.groupId, "groupId");
    if (groupId) {
      const member = await one("select 1 from group_members where group_id = $1 and user_id = $2", [groupId, session.id]);
      if (!member) throw new HttpError(403, "forbidden", "Join the group before attaching it.");
    }
    const captionMode = body.captionMode == null ? project.caption_mode : body.captionMode;
    if (!["off", "sidecar", "burn_in"].includes(String(captionMode))) throw new HttpError(400, "validation", "Choose off, a caption track, or burned-in words.", { captionMode: "Choose a caption mode." });
    const remix = body.remixPermission == null ? project.remix_permission : body.remixPermission;
    if (!["none", "attributed_later"].includes(String(remix))) throw new HttpError(400, "validation", "Choose a remix preference. Remix tools are not available.", { remixPermission: "Choose none or later." });
    const headline = body.coverHeadline == null ? String(project.cover_headline || "") : body.coverHeadline === "" ? "" : assertPlain(body.coverHeadline, 80, "coverHeadline");
    const coverTime = body.coverTimeMs == null ? Number(project.cover_time_ms) : whole(body.coverTimeMs, 0, 30_000, "coverTimeMs");
    const health = body.healthClaim == null ? Boolean(project.health_claim) : body.healthClaim === true;
    const next = {
      original: body.originalVolume == null ? Number(project.original_volume) : volume(body.originalVolume, "originalVolume"),
      voice: body.voiceVolume == null ? Number(project.voice_volume) : volume(body.voiceVolume, "voiceVolume"),
    };
    const reviewStatus = health ? (project.health_claim && project.review_status === "approved" ? "approved" : "pending") : "not_required";
    await q(
      `update studio_projects set title=$2, body=$3, topic=$4, template=$5, group_id=$6, original_volume=$7, voice_volume=$8, caption_mode=$9,
         comments_enabled=$10, download_allowed=$11, remix_permission=$12, disclosure_sponsor=$13, disclosure_paid=$14, disclosure_ai=$15,
         rights_declared=$16, health_claim=$17, review_status=$18, cover_headline=$19, cover_time_ms=$20, updated_at=now()
       where id=$1`,
      [id, title, text, topic, template, groupId, next.original, next.voice, captionMode, body.commentsEnabled == null ? project.comments_enabled : body.commentsEnabled === true,
        body.downloadAllowed == null ? project.download_allowed : body.downloadAllowed !== false, remix,
        body.disclosureSponsor === true || (body.disclosureSponsor == null && project.disclosure_sponsor),
        body.disclosurePaid === true || (body.disclosurePaid == null && project.disclosure_paid),
        body.disclosureAi === true || (body.disclosureAi == null && project.disclosure_ai),
        body.rightsDeclared === true || (body.rightsDeclared == null && project.rights_declared),
        health, reviewStatus, headline, coverTime],
    );
    const visual = next.original !== Number(project.original_volume) || next.voice !== Number(project.voice_volume) || captionMode !== project.caption_mode || headline !== project.cover_headline || coverTime !== Number(project.cover_time_ms);
    if (visual) await markVisual(id);
    if (health && !project.health_claim) {
      await q("update posts set held_for_review = true, updated_at = now() where studio_project_id = $1 and deleted_at is null", [id]);
      await q("update studio_projects set scheduled_at = null, status = case when status in ('scheduled','published','ready') then 'pending_review' else status end where id = $1", [id]);
      await event(id, session.id, "health_declared", "Held for a person. No automatic decision.");
    }
    if (health && project.review_status === "approved" && visual) await holdIfReviewed({ ...project, health_claim: true, review_status: "approved" });
    return c.json(await present(id, session.id));
  });

  app.put("/api/studio/projects/:id/segments", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const project = await ownProject(id, session.id);
    const body = await bodyObject(c);
    if (!Array.isArray(body.segments) || body.segments.length < 1 || body.segments.length > 8) {
      throw new HttpError(400, "validation", "Use 1 to 8 clips on the single track.", { segments: "Use 1 to 8 clips." });
    }
    const rows = [];
    for (const segment of body.segments as Array<Record<string, unknown>>) {
      const videoId = optionalUuid(segment.videoId, "videoId");
      if (!videoId) throw new HttpError(400, "validation", "Choose one of your clips.", { videoId: "Choose a clip." });
      const video = await one<{ owner_id: string; purpose: string; duration_ms: number }>("select owner_id, purpose, duration_ms from videos where id = $1", [videoId]);
      if (!video || video.owner_id !== session.id || video.purpose !== "upload") throw new HttpError(400, "validation", "Choose one of your uploaded clips.", { videoId: "That clip is not yours." });
      const startMs = whole(segment.startMs, 0, 30_000, "startMs");
      const endMs = whole(segment.endMs, 1, 30_000, "endMs");
      const speed = Number(segment.speed);
      if (!isSpeed(speed)) throw new HttpError(400, "validation", "Speed must be 0.5, 1, 1.5, or 2.", { speed: "Choose 0.5, 1, 1.5, or 2." });
      if (endMs > video.duration_ms) throw new HttpError(400, "validation", "A trim goes past the end of a source clip.", { endMs: "Trim inside the clip." });
      rows.push({ videoId, startMs, endMs, speed });
    }
    try {
      renderedDurationMs(rows);
    } catch (err) {
      throw new HttpError(400, "validation", err instanceof Error ? err.message : "That edit is too long.", { segments: "Shorten the rendered clip." });
    }
    await q("delete from studio_segments where project_id = $1", [id]);
    for (let i = 0; i < rows.length; i += 1) {
      await q("insert into studio_segments (project_id, position, video_id, start_ms, end_ms, speed) values ($1,$2,$3,$4,$5,$6)", [id, i, rows[i].videoId, rows[i].startMs, rows[i].endMs, rows[i].speed]);
    }
    await markVisual(id);
    await holdIfReviewed(project);
    await event(id, session.id, "segments", `${rows.length} clips`);
    return c.json(await present(id, session.id));
  });

  app.put("/api/studio/projects/:id/overlays", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const project = await ownProject(id, session.id);
    const body = await bodyObject(c);
    const overlays = readTimed(body.overlays, 8, 80);
    await q("delete from studio_overlays where project_id = $1", [id]);
    for (let i = 0; i < overlays.length; i += 1) {
      const item = overlays[i];
      await q("insert into studio_overlays (project_id, position, start_ms, end_ms, text, x_pct, y_pct, size) values ($1,$2,$3,$4,$5,$6,$7,$8)", [id, i, item.startMs, item.endMs, item.text, item.x, item.y, item.size]);
    }
    await markVisual(id);
    await holdIfReviewed(project);
    return c.json(await present(id, session.id));
  });

  app.put("/api/studio/projects/:id/captions", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const project = await ownProject(id, session.id);
    const body = await bodyObject(c);
    const cues = readCues(body.cues);
    await saveCues(id, cues);
    if (project.caption_mode === "burn_in") await markVisual(id);
    await holdIfReviewed(project);
    return c.json(await present(id, session.id));
  });

  app.post("/api/studio/projects/:id/captions/import", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const project = await ownProject(id, session.id);
    const body = await bodyObject(c);
    const raw = cleanText(body.text, 20_000, "text", "Caption file", { multiline: true });
    let cues;
    try {
      cues = parseCaptionFile(raw);
    } catch (err) {
      throw new HttpError(400, "validation", err instanceof Error ? err.message : "That caption file was rejected.", { text: "Check the caption file." });
    }
    await saveCues(id, cues);
    if (project.caption_mode === "burn_in") await markVisual(id);
    return c.json(await present(id, session.id));
  });

  app.post("/api/studio/audio", async (c: Ctx) => {
    const session = requireUser(c);
    await rateLimit(`studio-audio:${session.id}`, 20, 3600);
    const kind = c.req.query("kind") === "music" ? "music" : "voiceover";
    const rights = c.req.query("rights") === "1";
    if (kind === "music" && !rights) throw new HttpError(400, "validation", "Music must be your own or licensed to you. This app has no music library.", { rights: "Confirm the rights." });
    const data = await readUpload(c.req.raw, 8 * 1024 * 1024, "Audio must be 8 MB or smaller.");
    const id = randomUUID();
    const key = path.posix.join("audio", `${id}.bin`);
    await mkdir(path.join(mediaDir(), "audio"), { recursive: true });
    const full = safeMediaFile(key);
    if (!full) throw new HttpError(400, "validation", "Couldn't store that recording.");
    await writeFile(full, data, { mode: 0o600 });
    try {
      const probe = await probeAudio(full);
      await q(
        "insert into studio_audio (id, owner_id, kind, storage_key, mime, byte_size, duration_ms, rights_declared) values ($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, session.id, kind, key, probe.mime, data.length, probe.durationMs, kind === "voiceover" ? true : rights],
      );
      return c.json({ audio: { id, kind, durationMs: probe.durationMs } }, 201);
    } catch (err) {
      await unlink(full).catch(() => undefined);
      throw new HttpError(400, "validation", err instanceof Error ? err.message : "That recording could not be checked.", { file: "Use an audio file up to 30 seconds." });
    }
  });

  app.delete("/api/studio/audio/:id", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const row = await one<{ owner_id: string; storage_key: string }>("select owner_id, storage_key from studio_audio where id = $1", [id]);
    if (!row || row.owner_id !== session.id) throw new HttpError(404, "not_found", "Recording not found.");
    await q("update studio_projects set voiceover_id = null, edit_version = edit_version + 1, status = 'draft' where voiceover_id = $1", [id]);
    await q("delete from studio_audio where id = $1 and owner_id = $2", [id, session.id]);
    const full = safeMediaFile(row.storage_key);
    if (full) await unlink(full).catch(() => undefined);
    return c.json({ ok: true });
  });

  app.post("/api/studio/projects/:id/voiceover", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const project = await ownProject(id, session.id);
    const body = await bodyObject(c);
    const audioId = body.audioId == null ? null : optionalUuid(body.audioId, "audioId");
    if (audioId) {
      const audio = await one("select 1 from studio_audio where id = $1 and owner_id = $2", [audioId, session.id]);
      if (!audio) throw new HttpError(400, "validation", "That recording is not yours.", { audioId: "Upload a recording first." });
    }
    await q("update studio_projects set voiceover_id = $2 where id = $1", [id, audioId]);
    await markVisual(id);
    await holdIfReviewed(project);
    return c.json(await present(id, session.id));
  });

  app.put("/api/studio/projects/:id/cards", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    await ownProject(id, session.id);
    const body = await bodyObject(c);
    if (!Array.isArray(body.cards) || body.cards.length > 4) throw new HttpError(400, "validation", "Attach up to 4 cards.", { cards: "Use up to 4 cards." });
    const rows = [];
    for (const card of body.cards as Array<Record<string, unknown>>) {
      if (!CARD_KINDS.includes(card.kind as typeof CARD_KINDS[number])) throw new HttpError(400, "validation", "That card type is not supported.", { cards: "Choose a product, ask, cause, group, gathering, or guide." });
      const targetId = optionalUuid(card.targetId, "targetId");
      if (!targetId) throw new HttpError(400, "validation", "Choose a card.", { cards: "Choose a card." });
      const visible = await cardVisible(String(card.kind), targetId, session.id);
      if (!visible.title) throw new HttpError(403, "forbidden", "That card is not available to you.");
      rows.push({ kind: String(card.kind), targetId });
    }
    await q("delete from studio_cards where project_id = $1", [id]);
    for (let i = 0; i < rows.length; i += 1) await q("insert into studio_cards (project_id, position, kind, target_id) values ($1,$2,$3,$4)", [id, i, rows[i].kind, rows[i].targetId]);
    return c.json(await present(id, session.id));
  });

  app.get("/api/studio/eligible", async (c: Ctx) => {
    const session = requireUser(c);
    const kind = c.req.query("kind") || "offer";
    const qtext = (c.req.query("q") || "").trim().slice(0, 80);
    const pattern = `%${qtext.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
    let rows: Array<{ id: string; title: string; note: string }> = [];
    if (kind === "offer" || kind === "ask") {
      const found = await q<{ id: string; title: string; availability: string }>(
        `select p.id, p.title, p.availability from posts p
         where p.kind = $2 and p.deleted_at is null and p.held_for_review = false and p.availability <> 'archived'
           and (p.group_id is null or p.author_id = $1 or exists (select 1 from groups g where g.id = p.group_id and g.visibility = 'public')
             or exists (select 1 from group_members m where m.group_id = p.group_id and m.user_id = $1))
           and ($3 = '%%' or p.title ilike $3 escape '\\')
         order by p.created_at desc limit 20`,
        [session.id, kind, pattern],
      );
      rows = found.map((row) => ({ id: row.id, title: row.title, note: kind === "offer" ? row.availability : "Help request" }));
    } else if (kind === "cause") {
      const found = await q<{ id: string; title: string }>(
        `select c.id, c.title from causes c
         where c.status <> 'draft' and (c.organizer_id = $1 or c.group_id is null or exists (select 1 from groups g where g.id = c.group_id and g.visibility = 'public')
           or exists (select 1 from group_members m where m.group_id = c.group_id and m.user_id = $1))
           and ($2 = '%%' or c.title ilike $2 escape '\\')
         order by c.updated_at desc limit 20`,
        [session.id, pattern],
      );
      rows = found.map((row) => ({ id: row.id, title: row.title, note: "Pledged, not collected" }));
    } else if (kind === "group") {
      const found = await q<{ id: string; name: string }>(
        `select id, name from groups g where (g.visibility = 'public' or exists (select 1 from group_members m where m.group_id = g.id and m.user_id = $1))
           and ($2 = '%%' or g.name ilike $2 escape '\\') order by g.created_at desc limit 20`,
        [session.id, pattern],
      );
      rows = found.map((row) => ({ id: row.id, title: row.name, note: "Group" }));
    } else if (kind === "event") {
      const found = await q<{ id: string; title: string }>(
        `select e.id, e.title from events e where e.status = 'scheduled'
           and (e.group_id is null or e.organizer_id = $1 or exists (select 1 from groups g where g.id = e.group_id and g.visibility = 'public')
             or exists (select 1 from group_members m where m.group_id = e.group_id and m.user_id = $1))
           and ($2 = '%%' or e.title ilike $2 escape '\\') order by e.starts_at limit 20`,
        [session.id, pattern],
      );
      rows = found.map((row) => ({ id: row.id, title: row.title, note: "Gathering" }));
    } else if (kind === "playbook") {
      const found = await q<{ id: string; title: string }>(
        `select id, title from playbooks where deleted_at is null and ($2 = '%%' or title ilike $2 escape '\\') order by created_at desc limit 20`,
        [session.id, pattern],
      );
      rows = found.map((row) => ({ id: row.id, title: row.title, note: "Community guide · not reviewed" }));
    }
    return c.json({ cards: rows });
  });

  app.get("/api/studio/sources", async (c: Ctx) => {
    const session = requireUser(c);
    const rows = await q(
      `select id, status, duration_ms, width, height from videos
       where owner_id = $1 and purpose = 'upload' order by created_at desc limit 20`,
      [session.id],
    );
    return c.json({ videos: rows.map((row) => ({ id: row.id, status: row.status, durationMs: row.duration_ms, width: row.width, height: row.height, fileUrl: row.status === "ready" ? `/api/videos/${row.id}/file` : null })) });
  });

  app.post("/api/studio/projects/:id/render", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const project = await ownProject(id, session.id);
    const segments = await q<{ start_ms: number; end_ms: number; speed: number }>("select start_ms, end_ms, speed from studio_segments where project_id = $1", [id]);
    if (!segments.length) throw new HttpError(400, "validation", "Add a clip before rendering.", { segments: "Add a clip." });
    try {
      renderedDurationMs(segments.map((segment) => ({ startMs: segment.start_ms, endMs: segment.end_ms, speed: Number(segment.speed) })));
    } catch (err) {
      throw new HttpError(400, "validation", err instanceof Error ? err.message : "That edit is outside the limit.", { segments: "Shorten the rendered clip." });
    }
    const existing = await one<{ id: string }>("select id from studio_jobs where project_id = $1 and kind = 'render' and status in ('queued','running')", [id]);
    if (existing) return c.json({ job: { id: existing.id, phase: "queued", percent: null }, project: (await present(id, session.id)).project });
    await q("update studio_jobs set status = 'canceled', finished_at = now() where project_id = $1 and kind = 'render' and status = 'queued'", [id]);
    const job = await one<{ id: string }>(
      "insert into studio_jobs (project_id, edit_version, kind) values ($1,$2,'render') returning id",
      [id, project.edit_version],
    );
    await q("update studio_projects set status = 'rendering', updated_at = now() where id = $1", [id]);
    await event(id, session.id, "render_queued", `version ${project.edit_version}`);
    return c.json({ job: { id: job!.id, phase: "queued", percent: null }, project: (await present(id, session.id)).project }, 202);
  });

  app.post("/api/studio/projects/:id/render/cancel", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    await ownProject(id, session.id);
    await q("update studio_jobs set status = 'canceled', finished_at = now() where project_id = $1 and kind = 'render' and status = 'queued'", [id]);
    await q("update studio_projects set status = 'draft', updated_at = now() where id = $1 and status = 'rendering' and not exists (select 1 from studio_jobs j where j.project_id = $1 and j.status = 'running')", [id]);
    return c.json(await present(id, session.id));
  });

  app.post("/api/studio/projects/:id/publish", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const postId = await publishProject(id, session.id, false);
    return c.json({ postId });
  });

  app.post("/api/studio/projects/:id/schedule", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const project = await ownProject(id, session.id);
    if (project.rendered_version !== project.edit_version || project.status === "failed" || project.status === "draft" || project.status === "rendering") {
      throw new HttpError(409, "conflict", "Render the current edit before scheduling.");
    }
    if (project.health_claim && project.review_status !== "approved") throw new HttpError(409, "conflict", "A health or clinical promotion cannot be scheduled until a reviewer approves it.");
    if (!project.rights_declared) throw new HttpError(400, "validation", "Confirm you have the right to share this recording.", { rights: "Confirm recording rights." });
    const body = await bodyObject(c);
    const timezone = requireTimezone(body.timezone);
    const when = localToUtc(String(body.startsAtLocal || ""), timezone, "startsAt");
    const delta = when.getTime() - Date.now();
    if (delta < 60_000 || delta > 30 * 24 * 3600_000) {
      throw new HttpError(400, "validation", "Choose a time at least a minute from now and no more than 30 days away.", { startsAt: "Choose a future time." });
    }
    await q("update studio_projects set status = 'scheduled', scheduled_at = $2, timezone = $3, updated_at = now() where id = $1 and published_post_id is null", [id, when.toISOString(), timezone]);
    const again = await ownProject(id, session.id);
    if (again.status !== "scheduled") throw new HttpError(409, "conflict", "This project is already published.");
    await event(id, session.id, "scheduled", when.toISOString());
    return c.json(await present(id, session.id));
  });

  app.post("/api/studio/projects/:id/schedule/cancel", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const project = await ownProject(id, session.id);
    if (project.status === "published") throw new HttpError(409, "conflict", "The post is already public.");
    await q("update studio_projects set status = 'ready', scheduled_at = null, updated_at = now() where id = $1 and status in ('scheduled','publishing') and published_post_id is null", [id]);
    await event(id, session.id, "schedule_canceled", "");
    return c.json(await present(id, session.id));
  });

  app.post("/api/studio/projects/:id/review", async (c: Ctx) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const body = await bodyObject(c);
    const project = await one<Record<string, unknown>>("select * from studio_projects where id = $1 and deleted_at is null", [id]);
    if (!project) throw new HttpError(404, "not_found", "Studio project not found.");
    const moderator = await one<{ is_moderator: boolean }>("select is_moderator from users where id = $1", [session.id]);
    if (body.action === "submit") {
      if (project.owner_id !== session.id) throw new HttpError(404, "not_found", "Studio project not found.");
      if (!project.health_claim) throw new HttpError(400, "validation", "Only a health or clinical promotion needs review.", { healthClaim: "Turn on the health declaration first." });
      await q("update studio_projects set review_status = 'pending', status = 'pending_review', scheduled_at = null, updated_at = now() where id = $1", [id]);
      await event(id, session.id, "review_submitted", "Waiting for a person. No automatic decision.");
      return c.json(await present(id, session.id));
    }
    if (!moderator?.is_moderator) throw new HttpError(403, "forbidden", "A reviewer has not been configured for this preview.");
    if (body.action !== "approve" && body.action !== "reject") throw new HttpError(400, "validation", "Choose approve or reject.", { action: "Choose approve or reject." });
    const note = cleanText(body.note ?? "", 400, "note", "Note", { required: false, multiline: true });
    await q("update studio_projects set review_status = $2, status = case when $2 = 'approved' and rendered_version = edit_version then 'ready' else status end, updated_at = now() where id = $1", [id, body.action === "approve" ? "approved" : "rejected"]);
    await event(id, session.id, body.action === "approve" ? "review_approved" : "review_rejected", note || "Reviewed by a person.");
    return c.json({ ok: true });
  });

  app.get("/api/studio/review", async (c: Ctx) => {
    const session = requireUser(c);
    const moderator = await one<{ is_moderator: boolean }>("select is_moderator from users where id = $1", [session.id]);
    if (!moderator?.is_moderator) throw new HttpError(403, "forbidden", "A reviewer has not been configured for this preview.");
    const rows = await q("select id, title, review_status, updated_at from studio_projects where health_claim = true and review_status = 'pending' and deleted_at is null order by updated_at limit 50");
    return c.json({ projects: rows });
  });

  app.get("/api/posts/:id/captions.vtt", async (c: Ctx) => {
    const session = c.get("session");
    const id = parseId(c.req.param("id"));
    const post = await one<{ studio_project_id: string | null; caption_mode: string; author_id: string; held_for_review: boolean }>(
      `select studio_project_id, caption_mode, author_id, held_for_review from posts p
       where p.id = $2 and p.deleted_at is null
         and (p.held_for_review = false or p.author_id = $1)
         and (p.group_id is null or p.author_id = $1
           or exists (select 1 from groups g where g.id = p.group_id and g.visibility = 'public')
           or exists (select 1 from group_members m where m.group_id = p.group_id and m.user_id = $1))`,
      [session?.id ?? null, id],
    );
    if (!post || !post.studio_project_id || post.caption_mode !== "sidecar") throw new HttpError(404, "not_found", "No caption track.");
    const cues = await q<{ start_ms: number; end_ms: number; text: string }>("select start_ms, end_ms, text from studio_captions where project_id = $1 order by position", [post.studio_project_id]);
    const body = `WEBVTT\n\n${cues.map((cue) => `${vttTime(cue.start_ms)} --> ${vttTime(cue.end_ms)}\n${cue.text.replaceAll("-->", "to")}`).join("\n\n")}\n`;
    return new Response(body, { headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "private, no-store" } });
  });
}

function vttTime(ms: number) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function whole(value: unknown, min: number, max: number, field: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, "validation", "Use a whole number of milliseconds inside the clip.", { [field]: "Check the time." });
  }
  return value;
}

function assertPlain(value: unknown, max: number, field: string) {
  try {
    return assertPlainText(String(value ?? ""), max);
  } catch {
    throw new HttpError(400, "validation", "Use plain words and simple punctuation only.", { [field]: "Remove special characters." });
  }
}

function readTimed(value: unknown, max: number, textMax: number) {
  if (!Array.isArray(value) || value.length > max) throw new HttpError(400, "validation", `Use at most ${max} text items.`, { overlays: `Use at most ${max}.` });
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    const startMs = whole(row.startMs, 0, 30_000, "startMs");
    const endMs = whole(row.endMs, 1, 30_000, "endMs");
    if (endMs <= startMs) throw new HttpError(400, "validation", "The end must be after the start.", { endMs: "End after the start." });
    const size = row.size === "small" || row.size === "large" ? row.size : "medium";
    return { startMs, endMs, text: assertPlain(row.text, textMax, "text"), x: whole(row.x, 0, 100, "x"), y: whole(row.y, 0, 100, "y"), size };
  });
}

function readCues(value: unknown) {
  if (!Array.isArray(value) || value.length > 40) throw new HttpError(400, "validation", "Use at most 40 captions.", { cues: "Use at most 40 captions." });
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    const startMs = whole(row.startMs, 0, 30_000, "startMs");
    const endMs = whole(row.endMs, 1, 30_000, "endMs");
    if (endMs <= startMs) throw new HttpError(400, "validation", "The end must be after the start.", { endMs: "End after the start." });
    return { startMs, endMs, text: assertPlain(row.text, 120, "text") };
  });
}

async function saveCues(id: string, cues: Array<{ startMs: number; endMs: number; text: string }>) {
  await q("delete from studio_captions where project_id = $1", [id]);
  for (let i = 0; i < cues.length; i += 1) {
    await q("insert into studio_captions (project_id, position, start_ms, end_ms, text) values ($1,$2,$3,$4,$5)", [id, i, cues[i].startMs, cues[i].endMs, cues[i].text]);
  }
}
