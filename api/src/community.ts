import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Hono } from "hono";
import { one, q } from "./db.js";
import { HttpError } from "./errors.js";
import { limitFromEnv, rateLimit } from "./rate.js";
import { localToUtc, requireTimezone } from "./time.js";
import { cleanText, optionalUuid } from "./validate.js";
import { normalizeClip, publicError, safeMediaFile, VIDEO_MAX_BYTES } from "./video.js";
import { readUpload } from "./media.js";

type SessionUser = {
  id: string;
  handle: string;
  display_name: string;
};

type App = Hono<{ Variables: { session: SessionUser | null } }>;

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

function optionalHttpUrl(value: unknown) {
  const text = cleanText(value ?? "", 300, "onlineUrl", "Link", { required: false });
  if (!text) return "";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new HttpError(400, "validation", "Enter an http or https link.", { onlineUrl: "Enter an http or https link." });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(400, "validation", "Enter an http or https link.", { onlineUrl: "Enter an http or https link." });
  }
  return url.toString();
}

async function membership(groupId: string, userId: string | null) {
  if (!userId) return null;
  return one<{ role: "owner" | "admin" | "member" }>(
    "select role from group_members where group_id = $1 and user_id = $2",
    [groupId, userId],
  );
}

function mapGroup(row: {
  id: string;
  name: string;
  description: string;
  neighborhood: string;
  visibility: "public" | "private";
  created_at: Date;
  owner_handle: string;
  member_count: number;
  viewer_role: string | null;
}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    neighborhood: row.neighborhood,
    visibility: row.visibility,
    createdAt: new Date(row.created_at).toISOString(),
    ownerHandle: row.owner_handle,
    memberCount: row.member_count,
    viewerRole: row.viewer_role,
  };
}

const GROUP_SQL = `
  select g.id, g.name, g.description, g.neighborhood, g.visibility, g.created_at,
         u.handle as owner_handle,
         (select count(*)::int from group_members gm where gm.group_id = g.id) as member_count,
         (select role from group_members vm where vm.group_id = g.id and vm.user_id = $1) as viewer_role
  from groups g join users u on u.id = g.owner_id
`;

function mapEvent(row: {
  id: string;
  title: string;
  description: string;
  starts_at: Date;
  ends_at: Date | null;
  timezone: string;
  place: string;
  online_url: string;
  status: "scheduled" | "cancelled";
  group_id: string | null;
  group_name: string | null;
  organizer_id: string;
  organizer_handle: string;
  organizer_name: string;
  rsvp_count: number;
  viewer_going: boolean;
}, viewerId: string | null) {
  const starts = new Date(row.starts_at);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startsAt: starts.toISOString(),
    endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
    timezone: row.timezone,
    place: row.place,
    onlineUrl: row.online_url,
    status: row.status,
    passed: row.status === "scheduled" && starts.getTime() <= Date.now(),
    group: row.group_id ? { id: row.group_id, name: row.group_name } : null,
    organizer: { id: row.organizer_id, handle: row.organizer_handle, displayName: row.organizer_name },
    rsvpCount: row.rsvp_count,
    viewerGoing: row.viewer_going,
    viewerCanManage: viewerId === row.organizer_id,
  };
}

const EVENT_SQL = `
  select e.id, e.title, e.description, e.starts_at, e.ends_at, e.timezone, e.place, e.online_url, e.status,
         e.group_id, g.name as group_name, e.organizer_id, u.handle as organizer_handle, u.display_name as organizer_name,
         (select count(*)::int from event_rsvps r where r.event_id = e.id) as rsvp_count,
         exists(select 1 from event_rsvps r where r.event_id = e.id and r.user_id = $1) as viewer_going
  from events e
  join users u on u.id = e.organizer_id
  left join groups g on g.id = e.group_id
`;

function eventVisible(alias = "e") {
  return `(
    ${alias}.group_id is null
    or exists (select 1 from groups gv where gv.id = ${alias}.group_id and gv.visibility = 'public')
    or exists (select 1 from group_members gm where gm.group_id = ${alias}.group_id and gm.user_id = $1)
    or ${alias}.organizer_id = $1
  )`;
}

export function registerCommunity(app: App) {
  app.post("/api/videos", async (c) => {
    const session = requireUser(c);
    await rateLimit(`video:${session.id}`, limitFromEnv("VIDEO_RATE_LIMIT", 6), 3600);
    const count = await one<{ n: number }>(
      "select count(*)::int as n from videos where owner_id = $1 and purpose = 'upload' and created_at > now() - interval '1 day'",
      [session.id],
    );
    if ((count?.n ?? 0) >= limitFromEnv("VIDEO_DAILY_LIMIT", 8)) {
      throw new HttpError(429, "rate_limited", "You've reached today's clip limit.");
    }
    const data = await readUpload(c.req.raw, VIDEO_MAX_BYTES, "Clips must be 40 MB or smaller.");
    const id = randomUUID();
    let stored: { key: string; full: string } | null = null;
    try {
      const normalized = await normalizeClip(id, data);
      stored = normalized;
      const probe = normalized.probe;
      await q(
        `insert into videos (id, owner_id, original_key, container, video_codec, audio_codec, byte_size, duration_ms, width, height)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, session.id, stored.key, probe.container, probe.videoCodec, probe.audioCodec, data.length, probe.durationMs, probe.width, probe.height],
      );
      return c.json({
        video: {
          id,
          status: "queued",
          durationMs: probe.durationMs,
          width: probe.width,
          height: probe.height,
          error: null,
          posterUrl: null,
          fileUrl: null,
          moderation: "format_check_only",
        },
      }, 201);
    } catch (err) {
      if (stored) {
        const { unlink } = await import("node:fs/promises");
        const full = safeMediaFile(stored.key);
        if (full) await unlink(full).catch(() => undefined);
      }
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, "validation", publicError(err), { file: "That clip could not be checked." });
    }
  });

  app.delete("/api/videos/:id", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const video = await one<{ owner_id: string; original_key: string }>("select owner_id, original_key from videos where id = $1", [id]);
    if (!video || video.owner_id !== session.id) throw new HttpError(404, "not_found", "Clip not found.");
    const used = await one("select 1 from posts where video_id = $1 and deleted_at is null", [id]);
    if (used) throw new HttpError(409, "conflict", "This clip is already on a post. Delete the post to withdraw it.");
    const drafted = await one("select 1 from studio_segments where video_id = $1", [id]);
    if (drafted) throw new HttpError(409, "conflict", "This clip is in a Studio project. Remove it there before deleting the file.");
    await q("delete from videos where id = $1 and owner_id = $2", [id, session.id]);
    const full = safeMediaFile(video.original_key);
    if (full) {
      const { unlink } = await import("node:fs/promises");
      await unlink(full).catch(() => undefined);
    }
    return c.json({ ok: true });
  });

  app.get("/api/videos/:id", async (c) => {
    const session = c.get("session");
    const id = parseId(c.req.param("id"));
    const video = await visibleVideo(id, session?.id ?? null);
    return c.json({ video: publicVideo(video) });
  });

  app.get("/api/videos/:id/file", async (c) => serveReady(c, "file"));
  app.get("/api/videos/:id/poster", async (c) => serveReady(c, "poster"));
  app.get("/api/videos/:id/download", async (c) => {
    const session = c.get("session");
    const id = parseId(c.req.param("id"));
    const video = await visibleVideo(id, session?.id ?? null);
    const blocked = await one(
      `select 1 from posts p where p.video_id = $1 and p.deleted_at is null and p.download_allowed = false
         and (p.held_for_review = false or p.author_id = $2)`,
      [id, session?.id ?? null],
    );
    if (blocked) throw new HttpError(403, "forbidden", "The creator hid downloads. This is a restriction, not copy protection. Screen recording is still possible.");
    if (video.status !== "ready" || !video.output_key?.startsWith("ready/")) throw new HttpError(404, "not_found", "That clip is not ready.");
    const full = safeMediaFile(video.output_key);
    if (!full) throw new HttpError(404, "not_found", "That clip is not ready.");
    const data = await readFile(full);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(data.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Disposition": "attachment; filename=\"clip.mp4\"",
      },
    });
  });

  app.get("/api/groups", async (c) => {
    const session = c.get("session");
    const qtext = (c.req.query("q") || "").trim();
    const mine = c.req.query("mine") === "1";
    const params: unknown[] = [session?.id ?? null];
    const where = [mine
      ? "exists (select 1 from group_members mine where mine.group_id = g.id and mine.user_id = $1)"
      : "(g.visibility = 'public' or exists (select 1 from group_members mine where mine.group_id = g.id and mine.user_id = $1))"];
    if (qtext) {
      params.push(`%${qtext.slice(0, 80).replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      where.push(`(g.name ilike $${params.length} escape '\\' or g.neighborhood ilike $${params.length} escape '\\')`);
    }
    const rows = await q(`${GROUP_SQL} where ${where.join(" and ")} order by g.created_at desc limit 50`, params);
    return c.json({ groups: rows.map((row) => mapGroup(row as never)) });
  });

  app.post("/api/groups", async (c) => {
    const session = requireUser(c);
    await rateLimit(`group:${session.id}`, 20, 3600);
    const body = await bodyObject(c);
    const name = cleanText(body.name, 80, "name", "Name");
    if (name.length < 2) throw new HttpError(400, "validation", "Use a longer group name.", { name: "Use at least 2 characters." });
    const description = cleanText(body.description ?? "", 500, "description", "Description", { required: false, multiline: true });
    const neighborhood = cleanText(body.neighborhood ?? "", 80, "neighborhood", "Neighborhood", { required: false });
    const visibility = body.visibility === "private" ? "private" : body.visibility === "public" ? "public" : null;
    if (!visibility) throw new HttpError(400, "validation", "Choose public or private.", { visibility: "Choose public or private." });
    const client = await (await import("./db.js")).pool.connect();
    try {
      await client.query("begin");
      const created = await client.query(
        `insert into groups (owner_id, name, description, neighborhood, visibility) values ($1,$2,$3,$4,$5) returning id`,
        [session.id, name, description, neighborhood, visibility],
      );
      const id = created.rows[0].id as string;
      await client.query(
        `insert into group_members (group_id, user_id, role) values ($1,$2,'owner')`,
        [id, session.id],
      );
      await client.query("commit");
      const row = await one(`${GROUP_SQL} where g.id = $2`, [session.id, id]);
      return c.json({ group: mapGroup(row as never) }, 201);
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  });

  app.get("/api/groups/:id", async (c) => {
    const session = c.get("session");
    const id = parseId(c.req.param("id"));
    const row = await one(`${GROUP_SQL} where g.id = $2`, [session?.id ?? null, id]);
    if (!row) throw new HttpError(404, "not_found", "Group not found.");
    const group = mapGroup(row as never);
    const canSeeMembers = Boolean(group.viewerRole);
    let members: Array<{ handle: string; displayName: string; role: string }> = [];
    if (canSeeMembers) {
      const rows = await q<{ handle: string; display_name: string; role: string }>(
        `select u.handle, u.display_name, m.role from group_members m join users u on u.id = m.user_id
         where m.group_id = $1 order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, u.display_name`,
        [id],
      );
      members = rows.map((member) => ({ handle: member.handle, displayName: member.display_name, role: member.role }));
    }
    return c.json({ group, members, canViewPosts: group.visibility === "public" || Boolean(group.viewerRole) });
  });

  app.patch("/api/groups/:id", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const role = await membership(id, session.id);
    if (!role || (role.role !== "owner" && role.role !== "admin")) throw new HttpError(403, "forbidden", "Only an owner or admin can edit this group.");
    const body = await bodyObject(c);
    const name = cleanText(body.name, 80, "name", "Name");
    const description = cleanText(body.description ?? "", 500, "description", "Description", { required: false, multiline: true });
    const neighborhood = cleanText(body.neighborhood ?? "", 80, "neighborhood", "Neighborhood", { required: false });
    const visibility = body.visibility === "private" ? "private" : body.visibility === "public" ? "public" : null;
    if (!visibility) throw new HttpError(400, "validation", "Choose public or private.", { visibility: "Choose public or private." });
    if (role.role !== "owner" && visibility) {
      const current = await one<{ visibility: string }>("select visibility from groups where id = $1", [id]);
      if (current && current.visibility !== visibility) throw new HttpError(403, "forbidden", "Only the owner can change who can see this group.");
    }
    await q(
      `update groups set name = $1, description = $2, neighborhood = $3, visibility = $4, updated_at = now() where id = $5`,
      [name, description, neighborhood, role.role === "owner" ? visibility : (await one<{ visibility: string }>("select visibility from groups where id = $1", [id]))?.visibility, id],
    );
    const row = await one(`${GROUP_SQL} where g.id = $2`, [session.id, id]);
    return c.json({ group: mapGroup(row as never) });
  });

  app.delete("/api/groups/:id", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const role = await membership(id, session.id);
    if (!role || role.role !== "owner") throw new HttpError(403, "forbidden", "Only the owner can delete this group.");
    await q("delete from groups where id = $1 and owner_id = $2", [id, session.id]);
    return c.json({ ok: true });
  });

  app.post("/api/groups/:id/join", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const group = await one<{ visibility: string }>("select visibility from groups where id = $1", [id]);
    if (!group) throw new HttpError(404, "not_found", "Group not found.");
    if (group.visibility !== "public") throw new HttpError(403, "forbidden", "This group is private. An owner or admin has to add you.");
    await q(
      `insert into group_members (group_id, user_id, role) values ($1,$2,'member') on conflict do nothing`,
      [id, session.id],
    );
    return c.json({ joined: true, role: (await membership(id, session.id))?.role || "member" });
  });

  app.delete("/api/groups/:id/join", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const role = await membership(id, session.id);
    if (!role) throw new HttpError(404, "not_found", "You are not in this group.");
    if (role.role === "owner") throw new HttpError(400, "validation", "The owner stays until the group is deleted.");
    await q("delete from group_members where group_id = $1 and user_id = $2", [id, session.id]);
    return c.json({ joined: false });
  });

  app.post("/api/groups/:id/members", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const actor = await membership(id, session.id);
    if (!actor || (actor.role !== "owner" && actor.role !== "admin")) throw new HttpError(403, "forbidden", "Only an owner or admin can add people.");
    const body = await bodyObject(c);
    const handle = cleanText(body.handle, 24, "handle", "Handle").toLowerCase();
    const role = body.role == null || body.role === "member" ? "member" : body.role === "admin" ? "admin" : null;
    if (!role) throw new HttpError(400, "validation", "Choose member or admin.", { role: "Choose member or admin." });
    if (role === "admin" && actor.role !== "owner") throw new HttpError(403, "forbidden", "Only the owner can name an admin.");
    const user = await one<{ id: string }>("select id from users where handle = $1", [handle]);
    if (!user) throw new HttpError(404, "not_found", "Person not found.");
    const existing = await membership(id, user.id);
    if (existing?.role === "owner") throw new HttpError(400, "validation", "The owner already belongs to this group.");
    await q(
      `insert into group_members (group_id, user_id, role) values ($1,$2,$3)
       on conflict (group_id, user_id) do update set role = excluded.role`,
      [id, user.id, role],
    );
    return c.json({ ok: true, role });
  });

  app.delete("/api/groups/:id/members/:handle", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const actor = await membership(id, session.id);
    if (!actor || (actor.role !== "owner" && actor.role !== "admin")) throw new HttpError(403, "forbidden", "Only an owner or admin can remove people.");
    const handle = c.req.param("handle").toLowerCase();
    const user = await one<{ id: string }>("select id from users where handle = $1", [handle]);
    if (!user) throw new HttpError(404, "not_found", "Person not found.");
    const target = await membership(id, user.id);
    if (!target) throw new HttpError(404, "not_found", "That person is not in this group.");
    if (target.role === "owner") throw new HttpError(403, "forbidden", "The owner cannot be removed.");
    if (target.role === "admin" && actor.role !== "owner") throw new HttpError(403, "forbidden", "Only the owner can remove an admin.");
    await q("delete from group_members where group_id = $1 and user_id = $2", [id, user.id]);
    return c.json({ ok: true });
  });

  app.get("/api/events", async (c) => {
    const session = c.get("session");
    const groupId = c.req.query("groupId");
    const params: unknown[] = [session?.id ?? null];
    const where = [eventVisible("e")];
    if (groupId) {
      params.push(parseId(groupId));
      where.push(`e.group_id = $${params.length}`);
    }
    const rows = await q(`${EVENT_SQL} where ${where.join(" and ")} order by e.starts_at asc limit 50`, params);
    return c.json({ events: rows.map((row) => mapEvent(row as never, session?.id ?? null)) });
  });

  app.post("/api/events", async (c) => {
    const session = requireUser(c);
    await rateLimit(`event:${session.id}`, 30, 3600);
    const body = await bodyObject(c);
    const input = await readEvent(body, session.id);
    const row = await one<{ id: string }>(
      `insert into events (organizer_id, group_id, title, description, starts_at, ends_at, timezone, place, online_url)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [session.id, input.groupId, input.title, input.description, input.startsAt, input.endsAt, input.timezone, input.place, input.onlineUrl],
    );
    const full = await one(`${EVENT_SQL} where e.id = $2`, [session.id, row?.id]);
    return c.json({ event: mapEvent(full as never, session.id) }, 201);
  });

  app.get("/api/events/:id", async (c) => {
    const session = c.get("session");
    const id = parseId(c.req.param("id"));
    const row = await one(`${EVENT_SQL} where e.id = $2 and ${eventVisible("e")}`, [session?.id ?? null, id]);
    if (!row) throw new HttpError(404, "not_found", "Event not found.");
    const event = mapEvent(row as never, session?.id ?? null);
    const member = row.group_id ? await membership(String((row as { group_id: string }).group_id), session?.id ?? null) : null;
    const groupRole = member?.role;
    event.viewerCanManage = event.viewerCanManage || groupRole === "owner" || groupRole === "admin";
    return c.json({ event });
  });

  app.patch("/api/events/:id", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    await assertCanManageEvent(id, session.id);
    const existing = await one<{ status: string }>("select status from events where id = $1", [id]);
    const body = await bodyObject(c);
    const input = await readEvent(body, session.id, true);
    const status = body.status === "cancelled" ? "cancelled" : body.status === "scheduled" ? "scheduled" : existing?.status;
    if (status !== "cancelled" && status !== "scheduled") throw new HttpError(400, "validation", "Choose scheduled or cancelled.", { status: "Choose scheduled or cancelled." });
    await q(
      `update events set title = $1, description = $2, starts_at = $3, ends_at = $4, timezone = $5, place = $6, online_url = $7,
         group_id = $8, status = $9, updated_at = now() where id = $10`,
      [input.title, input.description, input.startsAt, input.endsAt, input.timezone, input.place, input.onlineUrl, input.groupId, status, id],
    );
    const row = await one(`${EVENT_SQL} where e.id = $2`, [session.id, id]);
    return c.json({ event: mapEvent(row as never, session.id) });
  });

  app.post("/api/events/:id/cancel", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    await assertCanManageEvent(id, session.id);
    await q("update events set status = 'cancelled', updated_at = now() where id = $1", [id]);
    const row = await one(`${EVENT_SQL} where e.id = $2`, [session.id, id]);
    return c.json({ event: mapEvent(row as never, session.id) });
  });

  app.post("/api/events/:id/rsvp", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const row = await one<{ status: string; starts_at: Date }>(
      `select e.status, e.starts_at from events e where e.id = $2 and ${eventVisible("e")}`,
      [session.id, id],
    );
    if (!row) throw new HttpError(404, "not_found", "Event not found.");
    if (row.status === "cancelled") throw new HttpError(400, "validation", "This gathering was cancelled.");
    if (new Date(row.starts_at).getTime() <= Date.now()) throw new HttpError(400, "validation", "This gathering has already started.");
    await q(
      `insert into event_rsvps (event_id, user_id) values ($1,$2) on conflict do nothing`,
      [id, session.id],
    );
    const count = await one<{ n: number }>("select count(*)::int as n from event_rsvps where event_id = $1", [id]);
    return c.json({ going: true, rsvpCount: count?.n ?? 1 });
  });

  app.delete("/api/events/:id/rsvp", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    await q("delete from event_rsvps where event_id = $1 and user_id = $2", [id, session.id]);
    const count = await one<{ n: number }>("select count(*)::int as n from event_rsvps where event_id = $1", [id]);
    return c.json({ going: false, rsvpCount: count?.n ?? 0 });
  });

  app.get("/api/me/activity", async (c) => {
    const session = requireUser(c);
    const groups = await q(`${GROUP_SQL} where exists (select 1 from group_members m where m.group_id = g.id and m.user_id = $1) order by g.name`, [session.id]);
    const events = await q(
      `${EVENT_SQL} where (e.organizer_id = $1 or exists (select 1 from event_rsvps r where r.event_id = e.id and r.user_id = $1))
       and ${eventVisible("e")} order by e.starts_at asc limit 50`,
      [session.id],
    );
    return c.json({
      groups: groups.map((row) => mapGroup(row as never)),
      events: events.map((row) => mapEvent(row as never, session.id)),
    });
  });
}

async function readEvent(body: Record<string, unknown>, userId: string, editing = false) {
  const title = cleanText(body.title, 140, "title", "Title");
  const description = cleanText(body.description, 4000, "description", "Details", { multiline: true });
  const timezone = requireTimezone(body.timezone);
  const startsLocal = cleanText(body.startsAtLocal, 32, "startsAt", "Start");
  const startsAt = localToUtc(startsLocal, timezone);
  let endsAt: Date | null = null;
  if (body.endsAtLocal) {
    const endsLocal = cleanText(body.endsAtLocal, 32, "endsAt", "End");
    endsAt = localToUtc(endsLocal, timezone);
    if (endsAt.getTime() <= startsAt.getTime()) throw new HttpError(400, "validation", "The end must be after the start.", { endsAt: "End after the start." });
  }
  const place = cleanText(body.place ?? "", 200, "place", "Place", { required: false });
  const onlineUrl = optionalHttpUrl(body.onlineUrl);
  if (!place && !onlineUrl) throw new HttpError(400, "validation", "Add a place or an online link.", { place: "Add a place or a link." });
  const groupId = optionalUuid(body.groupId, "groupId");
  if (groupId) {
    const member = await membership(groupId, userId);
    if (!member) throw new HttpError(403, "forbidden", "Join the group before attaching a gathering to it.");
  }
  if (!editing && startsAt.getTime() <= Date.now()) throw new HttpError(400, "validation", "Choose a start time in the future.", { startsAt: "Choose a future time." });
  return { title, description, timezone, startsAt, endsAt, place, onlineUrl, groupId };
}

async function assertCanManageEvent(id: string, userId: string) {
  const row = await one<{ organizer_id: string; group_id: string | null }>("select organizer_id, group_id from events where id = $1", [id]);
  if (!row) throw new HttpError(404, "not_found", "Event not found.");
  if (row.organizer_id === userId) return;
  if (row.group_id) {
    const role = await membership(row.group_id, userId);
    if (role && (role.role === "owner" || role.role === "admin")) return;
  }
  throw new HttpError(403, "forbidden", "You can't change this gathering.");
}

type VideoRow = {
  id: string;
  owner_id: string;
  status: "queued" | "processing" | "ready" | "failed";
  original_key: string;
  output_key: string | null;
  poster_key: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  error: string | null;
};

async function visibleVideo(id: string, viewerId: string | null) {
  const video = await one<VideoRow>("select id, owner_id, status, original_key, output_key, poster_key, duration_ms, width, height, error from videos where id = $1", [id]);
  if (!video) throw new HttpError(404, "not_found", "Clip not found.");
  if (viewerId && video.owner_id === viewerId) return video;
  const attached = await one(
    `select 1 from posts p
     where p.video_id = $2 and p.deleted_at is null and (
       p.group_id is null
       or exists (select 1 from groups g where g.id = p.group_id and g.visibility = 'public')
       or exists (select 1 from group_members m where m.group_id = p.group_id and m.user_id = $1)
       or p.author_id = $1
     )`,
    [viewerId, id],
  );
  if (!attached) throw new HttpError(404, "not_found", "Clip not found.");
  return video;
}

function publicVideo(video: VideoRow) {
  const ready = video.status === "ready";
  return {
    id: video.id,
    status: video.status,
    durationMs: video.duration_ms,
    width: video.width,
    height: video.height,
    error: video.status === "failed" ? video.error : null,
    posterUrl: ready ? `/api/videos/${video.id}/poster` : null,
    fileUrl: ready ? `/api/videos/${video.id}/file` : null,
    moderation: "format_check_only",
  };
}

async function serveReady(c: { req: { param: (name: string) => string }; get: (key: "session") => SessionUser | null }, kind: "file" | "poster") {
  const session = c.get("session");
  const id = parseId(c.req.param("id"));
  const video = await visibleVideo(id, session?.id ?? null);
  if (video.status !== "ready") throw new HttpError(404, "not_found", "That clip is not ready.");
  const key = kind === "file" ? video.output_key : video.poster_key;
  if (!key || !key.startsWith("ready/")) throw new HttpError(404, "not_found", "That clip is not ready.");
  const full = safeMediaFile(key);
  if (!full) throw new HttpError(404, "not_found", "That clip is not ready.");
  const data = await readFile(full);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": kind === "file" ? "video/mp4" : "image/jpeg",
      "Content-Length": String(data.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": "inline",
    },
  });
}
