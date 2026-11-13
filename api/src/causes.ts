import type { Hono } from "hono";
import { one, q, withTx } from "./db.js";
import { HttpError } from "./errors.js";
import { rateLimit } from "./rate.js";
import { localToUtc, requireTimezone } from "./time.js";
import { cleanText, optionalUuid } from "./validate.js";

type SessionUser = { id: string };
type App = Hono<{ Variables: { session: SessionUser | null } }>;

const CATEGORIES = ["neighborhood", "mutual_aid", "education", "environment", "local_services"] as const;
const STATUSES = ["draft", "active", "paused", "completed", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

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

function rejectSensitive(text: string, field: string) {
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text) || /\b(ssn|social security|routing|account number|bank account|diagnosis|minor)\b/i.test(text)) {
    throw new HttpError(400, "validation", "Don't include an identity number, bank detail, medical record, or a minor's identity.", { [field]: "Remove private details." });
  }
}

function placeLabel(value: unknown, field: string, label: string, required: boolean) {
  const text = cleanText(value ?? "", 120, field, label, { required });
  if (!text) return "";
  rejectSensitive(text, field);
  if (/^\s*\d+\s+\S+/.test(text) || /\b(apt|apartment|unit|suite|#)\s*\w+/i.test(text)) {
    throw new HttpError(400, "validation", "Use a neighborhood, city, or region. Do not enter a street address.", { [field]: "Use a neighborhood, city, or region." });
  }
  return text;
}

function cents(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new HttpError(400, "validation", "Send a whole number of cents.", { [field]: "Use integer cents, not a decimal string." });
  }
  if (value < 100 || value > 100_000_000) {
    throw new HttpError(400, "validation", "Use an amount from $1.00 to $1,000,000.00.", { [field]: "Amount is out of range." });
  }
  return value;
}

function roundCoord(value: unknown, field: string, min: number, max: number) {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new HttpError(400, "validation", "That pin is out of range.", { [field]: "Choose an approximate area." });
  }
  return Math.round(number * 100) / 100;
}

function readCause(body: Record<string, unknown>, existingTarget: Date | null) {
  const title = cleanText(body.title, 140, "title", "Title");
  const story = cleanText(body.story, 8000, "story", "Story", { multiline: true });
  rejectSensitive(title, "title");
  rejectSensitive(story, "story");
  const category = body.category;
  if (typeof category !== "string" || !CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    throw new HttpError(400, "validation", "Choose a category.", { category: "Choose a category." });
  }
  const localityLabel = placeLabel(body.localityLabel, "localityLabel", "Locality", false);
  const latitude = roundCoord(body.latitude, "latitude", -90, 90);
  const longitude = roundCoord(body.longitude, "longitude", -180, 180);
  if ((latitude == null) !== (longitude == null)) {
    throw new HttpError(400, "validation", "Set both pin values or neither.", { latitude: "Set both or neither." });
  }
  const beneficiaryLabel = cleanText(body.beneficiaryLabel, 80, "beneficiaryLabel", "Beneficiary");
  rejectSensitive(beneficiaryLabel, "beneficiaryLabel");
  if (/^\s*\d+\s+\S+/.test(beneficiaryLabel)) {
    throw new HttpError(400, "validation", "Use a display name, not an address.", { beneficiaryLabel: "Use a display name." });
  }
  const relation = body.beneficiaryRelation;
  if (relation !== "self" && relation !== "authorized_organizer") {
    throw new HttpError(400, "validation", "Say whether this is your own cause or one you are authorized to organize.", { beneficiaryRelation: "Choose self or authorized organizer." });
  }
  if (body.currency != null && body.currency !== "USD") {
    throw new HttpError(400, "validation", "This preview quotes USD only. It does not convert currencies.", { currency: "Use USD." });
  }
  const goalCents = cents(body.goalCents, "goalCents");
  let targetAt = existingTarget;
  let timezone = typeof body.timezone === "string" && body.timezone ? body.timezone : "UTC";
  const local = typeof body.targetAtLocal === "string" ? body.targetAtLocal.trim() : "";
  if (local) {
    timezone = requireTimezone(body.timezone);
    targetAt = localToUtc(local, timezone, "targetAtLocal");
    if (targetAt.getTime() <= Date.now()) {
      throw new HttpError(400, "validation", "The target date has to be in the future.", { targetAtLocal: "Choose a later time." });
    }
  }
  return { title, story, category, localityLabel, latitude, longitude, beneficiaryLabel, relation, goalCents, targetAt, timezone, groupId: optionalUuid(body.groupId, "groupId"), coverMediaId: optionalUuid(body.coverMediaId, "coverMediaId") };
}

const CAUSE_SQL = `
  select c.id, c.organizer_id, c.group_id, g.name as group_name, g.visibility as group_visibility,
    c.title, c.story, c.category, c.locality_label, c.latitude, c.longitude,
    c.beneficiary_label, c.beneficiary_relation, c.cover_media_id, c.goal_cents, c.currency,
    c.target_at, c.timezone, c.status, c.created_at, c.updated_at,
    u.handle as organizer_handle, u.display_name as organizer_name,
    (select coalesce(sum(p.amount_cents), 0)::int from cause_pledges p where p.cause_id = c.id and p.status = 'pledged' and p.currency = c.currency) as pledged_cents,
    (select count(*)::int from cause_pledges p where p.cause_id = c.id and p.status = 'pledged') as pledger_count,
    (select count(*)::int from cause_support s where s.cause_id = c.id and s.status = 'offered' and s.kind = 'volunteer') as volunteer_count,
    (select count(*)::int from cause_support s where s.cause_id = c.id and s.status = 'offered' and s.kind = 'in_kind') as in_kind_count,
    exists(select 1 from cause_follows f where f.cause_id = c.id and f.user_id = $1) as viewer_following
  from causes c
  join users u on u.id = c.organizer_id
  left join groups g on g.id = c.group_id
`;

function visibleSql() {
  return `(
    c.organizer_id = $1
    or (
      c.status <> 'draft'
      and (
        c.group_id is null
        or exists (select 1 from groups gv where gv.id = c.group_id and gv.visibility = 'public')
        or exists (select 1 from group_members gm where gm.group_id = c.group_id and gm.user_id = $1)
      )
    )
  )`;
}

function present(row: Record<string, unknown>, viewerId: string | null, extras: Record<string, unknown> = {}) {
  const goal = Number(row.goal_cents);
  const pledged = Number(row.pledged_cents || 0);
  const percent = goal > 0 ? Math.round((pledged / goal) * 1000) / 10 : 0;
  return {
    id: row.id,
    title: row.title,
    story: row.story,
    category: row.category,
    localityLabel: row.locality_label,
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    beneficiaryLabel: row.beneficiary_label,
    beneficiaryRelation: row.beneficiary_relation,
    coverUrl: row.cover_media_id ? `/api/media/${row.cover_media_id}` : null,
    goalCents: goal,
    currency: row.currency,
    pledgedCents: pledged,
    pledgedProgressPercent: Number.isFinite(percent) ? percent : 0,
    collectedCents: null,
    collectedStatus: "unavailable",
    progressLabel: "Pledged—not collected",
    pledgerCount: row.pledger_count,
    volunteerCount: row.volunteer_count,
    inKindCount: row.in_kind_count,
    targetAt: row.target_at ? new Date(row.target_at as string).toISOString() : null,
    timezone: row.timezone,
    status: row.status,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    organizer: { handle: row.organizer_handle, displayName: row.organizer_name, verifiedCharity: false },
    group: row.group_id ? { id: row.group_id, name: row.group_name, visibility: row.group_visibility } : null,
    viewerIsOrganizer: viewerId === row.organizer_id,
    viewerFollowing: Boolean(row.viewer_following),
    feeApplies: false,
    charged: false,
    notices: [
      "Pledged amounts are intentions. No money has been collected.",
      "The organizer is not a verified charity. This is not tax advice, not escrow, and not a guaranteed payout.",
      "The listing fee does not apply here. No cause fee is configured.",
    ],
    ...extras,
  };
}

async function loadCause(id: string, viewerId: string | null) {
  const row = await one(`${CAUSE_SQL} where c.id = $2 and ${visibleSql()}`, [viewerId, id]);
  if (!row) throw new HttpError(404, "not_found", "Cause not found.");
  return row;
}

export async function listFeedCauses(viewerId: string | null, filter: { followingOnly?: boolean; category?: string; status?: string; locality?: string; q?: string } = {}) {
  const params: unknown[] = [viewerId];
  const where = [visibleSql()];
  if (filter.followingOnly) where.push("exists (select 1 from cause_follows f where f.cause_id = c.id and f.user_id = $1)");
  if (filter.category) {
    if (!CATEGORIES.includes(filter.category as (typeof CATEGORIES)[number])) {
      throw new HttpError(400, "validation", "Choose a category.", { category: "Choose a category." });
    }
    params.push(filter.category);
    where.push(`c.category = $${params.length}`);
  }
  if (filter.status) {
    if (!STATUSES.includes(filter.status as Status)) throw new HttpError(400, "validation", "Choose a cause status.", { status: "Choose a status." });
    params.push(filter.status);
    where.push(`c.status = $${params.length}`);
  }
  if (filter.locality?.trim()) {
    params.push(`%${filter.locality.trim().slice(0, 80).replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    where.push(`c.locality_label ilike $${params.length} escape '\\'`);
  }
  if (filter.q?.trim()) {
    params.push(`%${filter.q.trim().slice(0, 80).replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    const n = `$${params.length}`;
    where.push(`(c.title ilike ${n} escape '\\' or c.story ilike ${n} escape '\\' or c.locality_label ilike ${n} escape '\\' or c.beneficiary_label ilike ${n} escape '\\')`);
  }
  const rows = await q(`${CAUSE_SQL} where ${where.join(" and ")} order by c.created_at desc limit 50`, params);
  return rows.map((row) => present(row, viewerId));
}

export function registerCauses(app: App) {
  app.get("/api/causes/fee", (c) => c.json({
    applicable: false,
    reason: "not_configured",
    listingFeeApplies: false,
    proposedCauseFee: null,
    charged: false,
    note: "The listing fee is not applied to causes. No cause fee is configured, and nothing is charged.",
  }));

  app.get("/api/causes", async (c) => {
    const session = c.get("session");
    const params: unknown[] = [session?.id ?? null];
    const where = [visibleSql()];
    if (c.req.query("mine") === "1") {
      if (!session) return c.json({ causes: [], notice: "login_required" });
      where.push("c.organizer_id = $1");
    }
    if (c.req.query("following") === "1") {
      if (!session) return c.json({ causes: [], notice: "login_required" });
      where.push("exists (select 1 from cause_follows f where f.cause_id = c.id and f.user_id = $1)");
    }
    const category = c.req.query("category") || "";
    if (category) {
      if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number])) throw new HttpError(400, "validation", "Choose a category.", { category: "Choose a category." });
      params.push(category);
      where.push(`c.category = $${params.length}`);
    }
    const status = c.req.query("status") || "";
    if (status) {
      if (!STATUSES.includes(status as Status) || (status === "draft" && c.req.query("mine") !== "1")) {
        throw new HttpError(400, "validation", "Choose a public status, or your own drafts.", { status: "Choose a status." });
      }
      params.push(status);
      where.push(`c.status = $${params.length}`);
    } else if (c.req.query("mine") !== "1") {
      where.push("c.status <> 'draft'");
    }
    const locality = (c.req.query("locality") || "").trim();
    if (locality) {
      params.push(`%${locality.slice(0, 80).replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      where.push(`c.locality_label ilike $${params.length} escape '\\'`);
    }
    const groupId = c.req.query("groupId");
    if (groupId) {
      params.push(parseId(groupId));
      where.push(`c.group_id = $${params.length}`);
    }
    const qtext = (c.req.query("q") || "").trim();
    if (qtext.length > 80) throw new HttpError(400, "validation", "Search is limited to 80 characters.", { q: "Shorten the search." });
    if (qtext) {
      params.push(`%${qtext.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      const n = `$${params.length}`;
      where.push(`(c.title ilike ${n} escape '\\' or c.story ilike ${n} escape '\\' or c.locality_label ilike ${n} escape '\\' or c.beneficiary_label ilike ${n} escape '\\')`);
    }
    const rows = await q(`${CAUSE_SQL} where ${where.join(" and ")} order by c.updated_at desc limit 50`, params);
    return c.json({ causes: rows.map((row) => present(row, session?.id ?? null)), notice: null });
  });

  app.post("/api/causes", async (c) => {
    const session = requireUser(c);
    await rateLimit(`cause:${session.id}`, 10, 3600);
    const input = readCause(await bodyObject(c), null);
    if (input.groupId) {
      const member = await one<{ role: string }>("select role from group_members where group_id = $1 and user_id = $2", [input.groupId, session.id]);
      if (!member || (member.role !== "owner" && member.role !== "admin")) throw new HttpError(403, "forbidden", "Only a group owner or admin can attach a cause to that group.");
    }
    if (input.coverMediaId) {
      const media = await one<{ owner_id: string }>("select owner_id from media where id = $1", [input.coverMediaId]);
      if (!media || media.owner_id !== session.id) throw new HttpError(400, "validation", "That photo isn't yours.", { coverMediaId: "Upload your own cover." });
    }
    const id = await withTx(async (client) => {
      const inserted = await client.query<{ id: string }>(
        `insert into causes (
           organizer_id, group_id, title, story, category, locality_label, latitude, longitude,
           beneficiary_label, beneficiary_relation, cover_media_id, goal_cents, currency, target_at, timezone, status
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'USD',$13,$14,'draft') returning id`,
        [session.id, input.groupId, input.title, input.story, input.category, input.localityLabel, input.latitude, input.longitude, input.beneficiaryLabel, input.relation, input.coverMediaId, input.goalCents, input.targetAt, input.timezone],
      );
      const causeId = inserted.rows[0]?.id;
      if (!causeId) throw new HttpError(500, "server", "Could not save the cause.");
      await client.query(
        "insert into cause_events (cause_id, actor_id, action, note) values ($1, $2, 'created', 'Draft saved. Nothing is being collected.')",
        [causeId, session.id],
      );
      return causeId;
    });
    return c.json({ cause: present(await loadCause(id, session.id), session.id) }, 201);
  });

  app.get("/api/causes/:id", async (c) => {
    const session = c.get("session");
    const id = parseId(c.req.param("id"));
    const row = await loadCause(id, session?.id ?? null);
    const updates = await q("select id, body, created_at from cause_updates where cause_id = $1 order by created_at", [id]);
    const events = await q("select action, note, created_at from cause_events where cause_id = $1 order by created_at", [id]);
    const names = await q(
      `select u.display_name from cause_pledges p join users u on u.id = p.user_id
       where p.cause_id = $1 and p.status = 'pledged' and p.public_credit = true order by p.updated_at`,
      [id],
    );
    const proposals = await q(
      `select p.id, p.kind, p.statement, p.status, u.display_name
       from sponsor_proposals p join users u on u.id = p.proposer_id
       where p.cause_id = $1 and p.status <> 'withdrawn' order by p.created_at`,
      [id],
    );
    let viewerPledge = null;
    let viewerSupport: Array<{ kind: string; detail: string; status: string }> = [];
    if (session) {
      const pledge = await one<{ amount_cents: number; currency: string; message: string; public_credit: boolean; status: string }>(
        "select amount_cents, currency, message, public_credit, status from cause_pledges where cause_id = $1 and user_id = $2",
        [id, session.id],
      );
      if (pledge && pledge.status === "pledged") {
        viewerPledge = { amountCents: pledge.amount_cents, currency: pledge.currency, message: pledge.message, publicCredit: pledge.public_credit, status: pledge.status, collected: false };
      }
      viewerSupport = await q("select kind, detail, status from cause_support where cause_id = $1 and user_id = $2 and status = 'offered'", [id, session.id]);
    }
    return c.json({
      cause: present(row, session?.id ?? null, {
        updates: updates.map((item) => ({ id: item.id, body: item.body, createdAt: new Date(item.created_at as string).toISOString() })),
        history: events.map((item) => ({ action: item.action, note: item.note, createdAt: new Date(item.created_at as string).toISOString() })),
        publicCredits: names.map((item) => ({ displayName: item.display_name })),
        proposals: proposals.map((item) => ({
          id: item.id,
          kind: item.kind,
          statement: item.statement,
          status: item.status,
          from: { displayName: item.display_name },
          label: item.status === "agreed" ? "Accepted offer" : null,
          paid: false,
          fundsCollected: 0,
          disclaimer: item.status === "agreed" ? "This is an accepted offer of support. No funds were collected." : null,
        })),
        viewerPledge,
        viewerSupport,
        moderation: { configured: false, autoPublished: false },
      }),
    });
  });

  app.patch("/api/causes/:id", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const existing = await one<{ organizer_id: string; status: Status; target_at: Date | null }>("select organizer_id, status, target_at from causes where id = $1", [id]);
    if (!existing) throw new HttpError(404, "not_found", "Cause not found.");
    if (existing.organizer_id !== session.id) throw new HttpError(403, "forbidden", "Only the organizer can edit this cause.");
    if (existing.status === "cancelled" || existing.status === "completed") {
      throw new HttpError(409, "conflict", "A completed or cancelled cause stays archived. Post an update before it is completed, or leave the archive as it is.");
    }
    const input = readCause(await bodyObject(c), existing.target_at);
    if (input.coverMediaId) {
      const media = await one<{ owner_id: string }>("select owner_id from media where id = $1", [input.coverMediaId]);
      if (!media || media.owner_id !== session.id) throw new HttpError(400, "validation", "That photo isn't yours.", { coverMediaId: "Upload your own cover." });
    }
    await one(
      `update causes set title = $2, story = $3, category = $4, locality_label = $5, latitude = $6, longitude = $7,
         beneficiary_label = $8, beneficiary_relation = $9, cover_media_id = $10, goal_cents = $11, target_at = $12, timezone = $13, updated_at = now()
       where id = $1`,
      [id, input.title, input.story, input.category, input.localityLabel, input.latitude, input.longitude, input.beneficiaryLabel, input.relation, input.coverMediaId, input.goalCents, input.targetAt, input.timezone],
    );
    await one("insert into cause_events (cause_id, actor_id, action, note) values ($1, $2, 'edited', 'Organizer edited the cause. Pledges were not converted into payments.')", [id, session.id]);
    return c.json({ cause: present(await loadCause(id, session.id), session.id) });
  });

  app.post("/api/causes/:id/status", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const existing = await one<{ organizer_id: string; status: Status }>("select organizer_id, status from causes where id = $1", [id]);
    if (!existing) throw new HttpError(404, "not_found", "Cause not found.");
    if (existing.organizer_id !== session.id) throw new HttpError(403, "forbidden", "Only the organizer can change the status.");
    const next = (await bodyObject(c)).status;
    if (typeof next !== "string" || !STATUSES.includes(next as Status)) throw new HttpError(400, "validation", "Choose a status.", { status: "Choose a status." });
    const allowed: Record<Status, Status[]> = {
      draft: ["active", "cancelled"],
      active: ["paused", "completed", "cancelled"],
      paused: ["active", "completed", "cancelled"],
      completed: [],
      cancelled: [],
    };
    if (!allowed[existing.status].includes(next as Status)) throw new HttpError(409, "conflict", "That status change isn't available.");
    await one("update causes set status = $2, updated_at = now() where id = $1", [id, next]);
    await one("insert into cause_events (cause_id, actor_id, action, note) values ($1, $2, 'status', $3)", [id, session.id, `Status set to ${next}. No funds were collected.`]);
    return c.json({ cause: present(await loadCause(id, session.id), session.id) });
  });

  app.post("/api/causes/:id/updates", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const existing = await one<{ organizer_id: string; status: Status }>("select organizer_id, status from causes where id = $1", [id]);
    if (!existing) throw new HttpError(404, "not_found", "Cause not found.");
    if (existing.organizer_id !== session.id) throw new HttpError(403, "forbidden", "Only the organizer can post an update.");
    if (existing.status === "cancelled") throw new HttpError(409, "conflict", "A cancelled cause is archived.");
    const text = cleanText((await bodyObject(c)).body, 4000, "body", "Update", { multiline: true });
    rejectSensitive(text, "body");
    const row = await one<{ id: string }>("insert into cause_updates (cause_id, author_id, body) values ($1, $2, $3) returning id", [id, session.id, text]);
    await one("insert into cause_events (cause_id, actor_id, action, note) values ($1, $2, 'update', 'Organizer posted an update.')", [id, session.id]);
    return c.json({ update: { id: row?.id, body: text } }, 201);
  });

  app.post("/api/causes/:id/follow", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    await loadCause(id, session.id);
    const row = await one<{ status: string; organizer_id: string }>("select status, organizer_id from causes where id = $1", [id]);
    if (row?.status === "draft") throw new HttpError(404, "not_found", "Cause not found.");
    await one("insert into cause_follows (user_id, cause_id) values ($1, $2) on conflict do nothing", [session.id, id]);
    return c.json({ following: true });
  });

  app.delete("/api/causes/:id/follow", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    await loadCause(id, session.id);
    await one("delete from cause_follows where user_id = $1 and cause_id = $2", [session.id, id]);
    return c.json({ following: false });
  });

  app.post("/api/causes/:id/pledge", async (c) => {
    const session = requireUser(c);
    await rateLimit(`pledge:${session.id}`, 30, 3600);
    const id = parseId(c.req.param("id"));
    await loadCause(id, session.id);
    const body = await bodyObject(c);
    const amount = cents(body.amountCents, "amountCents");
    if (body.currency != null && body.currency !== "USD") throw new HttpError(400, "validation", "Pledges use the cause currency. This preview does not convert.", { currency: "Use USD." });
    const message = cleanText(body.message ?? "", 500, "message", "Message", { required: false, multiline: true });
    rejectSensitive(message, "message");
    const publicCredit = body.publicCredit === true;
    await withTx(async (client) => {
      const locked = await client.query<{ status: string; currency: string; organizer_id: string }>("select status, currency, organizer_id from causes where id = $1 for update", [id]);
      const cause = locked.rows[0];
      if (!cause) throw new HttpError(404, "not_found", "Cause not found.");
      if (cause.organizer_id === session.id) throw new HttpError(400, "validation", "The organizer doesn't pledge to their own cause.");
      if (cause.status !== "active") throw new HttpError(409, "conflict", "Pledges are open only while the cause is active.");
      if (cause.currency !== "USD") throw new HttpError(400, "validation", "This cause is not in USD.");
      await client.query(
        `insert into cause_pledges (cause_id, user_id, amount_cents, currency, message, public_credit, status)
         values ($1, $2, $3, 'USD', $4, $5, 'pledged')
         on conflict (cause_id, user_id) do update set
           amount_cents = excluded.amount_cents,
           message = excluded.message,
           public_credit = excluded.public_credit,
           status = 'pledged',
           updated_at = now()`,
        [id, session.id, amount, message, publicCredit],
      );
    });
    const totals = await one<{ pledged_cents: number }>("select coalesce(sum(amount_cents), 0)::int as pledged_cents from cause_pledges where cause_id = $1 and status = 'pledged'", [id]);
    return c.json({
      pledge: { amountCents: amount, currency: "USD", status: "pledged", collected: false, publicCredit },
      pledgedCents: totals?.pledged_cents ?? 0,
      collectedCents: null,
      progressLabel: "Pledged—not collected",
    });
  });

  app.delete("/api/causes/:id/pledge", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    await loadCause(id, session.id);
    await withTx(async (client) => {
      const locked = await client.query<{ status: string }>("select status from causes where id = $1 for update", [id]);
      if (!["active", "paused"].includes(locked.rows[0]?.status || "")) throw new HttpError(409, "conflict", "Pledges can be withdrawn while the cause is active or paused.");
      const updated = await client.query("update cause_pledges set status = 'withdrawn', updated_at = now() where cause_id = $1 and user_id = $2 and status = 'pledged'", [id, session.id]);
      if (!updated.rowCount) throw new HttpError(404, "not_found", "You don't have a current pledge.");
    });
    const totals = await one<{ pledged_cents: number }>("select coalesce(sum(amount_cents), 0)::int as pledged_cents from cause_pledges where cause_id = $1 and status = 'pledged'", [id]);
    return c.json({ pledge: null, pledgedCents: totals?.pledged_cents ?? 0, collectedCents: null });
  });

  app.post("/api/causes/:id/support", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    await loadCause(id, session.id);
    const body = await bodyObject(c);
    const kind = body.kind === "volunteer" ? "volunteer" : body.kind === "in_kind" ? "in_kind" : "";
    if (!kind) throw new HttpError(400, "validation", "Choose volunteer or in-kind support.", { kind: "Choose volunteer or in-kind." });
    const detail = cleanText(body.detail, 500, "detail", "Detail", { multiline: true });
    rejectSensitive(detail, "detail");
    const cause = await one<{ status: string; organizer_id: string }>("select status, organizer_id from causes where id = $1", [id]);
    if (cause?.organizer_id === session.id) throw new HttpError(400, "validation", "The organizer doesn't offer support to their own cause.");
    if (cause?.status !== "active") throw new HttpError(409, "conflict", "Support offers are open only while the cause is active.");
    await one(
      `insert into cause_support (cause_id, user_id, kind, detail, public_credit, status)
       values ($1, $2, $3, $4, $5, 'offered')
       on conflict (cause_id, user_id, kind) do update set detail = excluded.detail, public_credit = excluded.public_credit, status = 'offered', updated_at = now()`,
      [id, session.id, kind, detail, body.publicCredit === true],
    );
    return c.json({ support: { kind, status: "offered", collected: false }, charged: false });
  });

  app.post("/api/causes/:id/proposals", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const cause = await loadCause(id, session.id);
    if (cause.status === "draft") throw new HttpError(404, "not_found", "Cause not found.");
    const body = await bodyObject(c);
    const kind = body.kind === "partner" ? "partner" : body.kind === "sponsor" ? "sponsor" : "";
    if (!kind) throw new HttpError(400, "validation", "Choose a sponsor offer or a partner inquiry.", { kind: "Choose sponsor or partner." });
    const statement = cleanText(body.statement, 2000, "statement", "Offer", { multiline: true });
    rejectSensitive(statement, "statement");
    const row = await one<{ id: string }>(
      "insert into sponsor_proposals (cause_id, proposer_id, kind, statement) values ($1, $2, $3, $4) returning id",
      [id, session.id, kind, statement],
    );
    return c.json({
      proposal: { id: row?.id, status: "submitted", kind, paid: false, fundsCollected: 0 },
      granted: false,
      disclaimer: "This is an offer of support. Accepting it does not collect money.",
    }, 201);
  });

  app.post("/api/causes/:id/flags", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    await loadCause(id, session.id);
    const reason = cleanText((await bodyObject(c)).reason, 500, "reason", "Reason", { multiline: true });
    await one("insert into cause_flags (cause_id, reporter_id, reason) values ($1, $2, $3)", [id, session.id, reason]);
    return c.json({
      flag: { saved: true },
      moderation: { configured: false, removed: false },
      message: "Flag saved for an operator. No moderator is assigned, so nothing is auto-removed or approved.",
    }, 201);
  });

  app.get("/api/users/:handle/causes", async (c) => {
    const handle = c.req.param("handle").toLowerCase();
    const user = await one<{ id: string }>("select id from users where handle = $1", [handle]);
    if (!user) throw new HttpError(404, "not_found", "Person not found.");
    const session = c.get("session");
    const rows = await q(
      `${CAUSE_SQL} where c.organizer_id = $2 and ${visibleSql()} and ($3::boolean or c.status <> 'draft') order by c.updated_at desc limit 50`,
      [session?.id ?? null, user.id, session?.id === user.id],
    );
    return c.json({ causes: rows.map((row) => present(row, session?.id ?? null)) });
  });
}
