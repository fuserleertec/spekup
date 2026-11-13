import type { Hono } from "hono";
import { one, q } from "./db.js";
import { HttpError } from "./errors.js";
import { cleanText, optionalUuid } from "./validate.js";

type SessionUser = { id: string };
type App = Hono<{ Variables: { session: SessionUser | null } }>;

export function platformFeeCents(priceCents: number, bps: number) {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0 || priceCents > 100_000_000) {
    throw new HttpError(400, "validation", "That price can't be quoted.", { price: "Use a price in cents." });
  }
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10_000) {
    throw new HttpError(500, "server", "The fee schedule is not valid.");
  }
  return Math.floor((priceCents * bps) / 10_000);
}

type Schedule = { version: number; platform_fee_bps: number; label: string; note: string; currency: string };

async function currentSchedule() {
  const row = await one<Schedule>(
    `select version, platform_fee_bps, label, note, currency
     from fee_schedules where status = 'proposed_preview' order by version desc limit 1`,
  );
  if (!row) throw new HttpError(409, "conflict", "No proposed fee schedule is configured.");
  return row;
}

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

function optionalInt(value: unknown, field: string) {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new HttpError(400, "validation", "Send whole cents.", { [field]: "Use an integer number of cents." });
  }
  return value;
}

type Listing = { id: string; author_id: string; kind: string; price_mode: string | null; price_cents: number | null; listing_kind: string | null; deleted_at: Date | null; title: string };

async function listingOr404(id: string) {
  const row = await one<Listing>(
    "select id, author_id, kind, price_mode, price_cents, listing_kind, deleted_at, title from posts where id = $1",
    [id],
  );
  if (!row || row.deleted_at) throw new HttpError(404, "not_found", "Listing not found.");
  if (row.kind === "poll" || row.kind === "share") {
    throw new HttpError(400, "validation", "Polls, reports, and ordinary posts are free. A fee cannot rank or boost them.");
  }
  return row;
}

export async function quoteFor(row: Listing) {
  const schedule = await currentSchedule();
  const base = {
    scheduleVersion: schedule.version,
    scheduleLabel: schedule.label,
    scheduleNote: schedule.note,
    currency: "USD" as const,
    processorFeeCents: null,
    processorFeeStatus: "unknown_until_provider" as const,
    charged: false as const,
    finalPricing: false as const,
  };
  if (row.kind !== "offer" || row.price_mode !== "fixed" || row.price_cents == null) {
    return {
      ...base,
      applicable: false as const,
      reason: "no_fixed_price" as const,
      listPriceCents: null,
      platformFeeBps: 0,
      platformFeeCents: 0,
      sellerNetCents: null,
      buyerTotalCents: null,
    };
  }
  const fee = platformFeeCents(row.price_cents, schedule.platform_fee_bps);
  return {
    ...base,
    applicable: true as const,
    reason: "fixed_price_listing" as const,
    listPriceCents: row.price_cents,
    platformFeeBps: schedule.platform_fee_bps,
    platformFeeCents: fee,
    sellerNetCents: row.price_cents - fee,
    buyerTotalCents: row.price_cents,
  };
}

function mismatch(body: Record<string, unknown>, field: string, actual: number) {
  const sent = optionalInt(body[field], field);
  if (sent != null && sent !== actual) {
    throw new HttpError(409, "conflict", "That amount does not match the current listing. Refresh the quote.", { [field]: "The server calculated a different amount." });
  }
}

async function paymentsClosed() {
  const settings = await one<{ gate_open: boolean; provider: string | null }>(
    "select gate_open, provider from payment_settings where singleton = 'default'",
  );
  if (!settings?.gate_open || !settings.provider) {
    throw new HttpError(501, "not_enabled", "Payments are not configured. Nothing was charged.");
  }
  throw new HttpError(501, "not_enabled", "No payment provider is connected. Nothing was charged.");
}

export function registerMoney(app: App) {
  app.get("/api/listings/:id/quote", async (c) => {
    const row = await listingOr404(parseId(c.req.param("id")));
    if (row.kind !== "offer") throw new HttpError(400, "validation", "Only a listing has a proposed fee. Asks, polls, and reports stay free.");
    return c.json({ quote: await quoteFor(row) });
  });

  app.post("/api/listings/:id/interest", async (c) => {
    const session = requireUser(c);
    const row = await listingOr404(parseId(c.req.param("id")));
    if (row.kind !== "offer" || row.price_mode !== "fixed" || row.price_cents == null) {
      throw new HttpError(400, "validation", "Interest in a charge applies only to a fixed-price listing. Free help has no fee.");
    }
    if (row.author_id === session.id) throw new HttpError(400, "validation", "You can't save purchase interest in your own listing.");
    const body = await bodyObject(c);
    const quote = await quoteFor(row);
    const version = optionalInt(body.scheduleVersion, "scheduleVersion");
    const price = optionalInt(body.priceCents, "priceCents");
    if (version == null || price == null) throw new HttpError(400, "validation", "Send the schedule version and the list price from the quote.");
    if (version !== quote.scheduleVersion || price !== quote.listPriceCents) {
      throw new HttpError(409, "conflict", "The listing price or the proposed fee changed. Refresh before saving interest.");
    }
    mismatch(body, "platformFeeCents", quote.platformFeeCents);
    mismatch(body, "sellerNetCents", quote.sellerNetCents ?? 0);
    mismatch(body, "buyerTotalCents", quote.buyerTotalCents ?? 0);
    const saved = await one<{ id: string }>(
      `insert into quote_requests (
         listing_id, buyer_id, schedule_version, price_cents, platform_fee_bps, platform_fee_cents, seller_net_cents, buyer_total_cents, currency, status
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,'USD','interest_saved')
       on conflict (listing_id, buyer_id) do update set
         schedule_version = excluded.schedule_version,
         price_cents = excluded.price_cents,
         platform_fee_bps = excluded.platform_fee_bps,
         platform_fee_cents = excluded.platform_fee_cents,
         seller_net_cents = excluded.seller_net_cents,
         buyer_total_cents = excluded.buyer_total_cents,
         status = 'interest_saved',
         created_at = now()
       returning id`,
      [row.id, session.id, quote.scheduleVersion, quote.listPriceCents, quote.platformFeeBps, quote.platformFeeCents, quote.sellerNetCents, quote.buyerTotalCents],
    );
    return c.json({
      interest: { id: saved?.id, status: "interest_saved", listingId: row.id, quote },
      charged: false,
      order: null,
    }, 201);
  });

  app.get("/api/plans", async (c) => {
    const plans = await q("select code, title, summary from plan_catalog order by code");
    return c.json({ plans, finalPricing: false });
  });

  app.post("/api/me/plans/:code", async (c) => {
    const session = requireUser(c);
    const code = c.req.param("code");
    if (!["supporter", "pro", "organizer"].includes(code)) throw new HttpError(404, "not_found", "That plan is not in the preview catalog.");
    await one(
      `insert into plan_interests (user_id, plan_code, status) values ($1, $2, 'requested')
       on conflict (user_id, plan_code) do update set status = 'requested', updated_at = now()`,
      [session.id, code],
    );
    const entitlement = await one("select 1 from entitlements where user_id = $1 and active = true", [session.id]);
    return c.json({
      plan: code,
      status: "requested",
      membershipActive: false,
      entitlement: Boolean(entitlement),
      verification: "not_available",
      charged: false,
    });
  });

  app.delete("/api/me/plans/:code", async (c) => {
    const session = requireUser(c);
    const code = c.req.param("code");
    await one("update plan_interests set status = 'withdrawn', updated_at = now() where user_id = $1 and plan_code = $2", [session.id, code]);
    return c.json({ plan: code, status: "withdrawn", membershipActive: false, charged: false });
  });

  app.post("/api/support-interests", async (c) => {
    const session = requireUser(c);
    const body = await bodyObject(c);
    const postId = optionalUuid(body.postId, "postId");
    const note = cleanText(body.note ?? "", 500, "note", "Note", { required: false, multiline: true });
    const wished = optionalInt(body.wishedCents, "wishedCents");
    if (wished != null && (wished < 1 || wished > 100_000_000)) {
      throw new HttpError(400, "validation", "That amount is out of range.", { wishedCents: "Use cents from 1 to 100000000." });
    }
    const row = await one<{ id: string }>(
      "insert into support_interests (user_id, post_id, wished_cents, note, status) values ($1, $2, $3, $4, 'requested') returning id",
      [session.id, postId, wished, note],
    );
    return c.json({ interest: { id: row?.id, status: "requested", wishedCents: wished }, charged: false, transfer: null }, 201);
  });

  app.post("/api/groups/:id/goals", async (c) => {
    const session = requireUser(c);
    const groupId = parseId(c.req.param("id"));
    const member = await one<{ role: string }>("select role from group_members where group_id = $1 and user_id = $2", [groupId, session.id]);
    if (!member || (member.role !== "owner" && member.role !== "admin")) throw new HttpError(403, "forbidden", "Only an owner or admin can add a goal.");
    const body = await bodyObject(c);
    if ("raisedCents" in body || "amount" in body || "balance" in body) {
      throw new HttpError(400, "validation", "A goal does not store money raised.");
    }
    const title = cleanText(body.title, 140, "title", "Title");
    const detail = cleanText(body.detail, 2000, "detail", "Detail", { multiline: true });
    const progressLabel = cleanText(body.progressLabel, 80, "progressLabel", "Progress label");
    const target = optionalInt(body.progressTarget, "progressTarget");
    if (target == null || target < 1 || target > 1_000_000) throw new HttpError(400, "validation", "Set a target count above zero.", { progressTarget: "Use a whole number." });
    const row = await one<{ id: string }>(
      `insert into community_goals (group_id, organizer_id, title, detail, progress_label, progress_target)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [groupId, session.id, title, detail, progressLabel, target],
    );
    return c.json({ goal: { id: row?.id, progressCount: 0, progressTarget: target, moneyRaised: null } }, 201);
  });

  app.get("/api/groups/:id/goals", async (c) => {
    const groupId = parseId(c.req.param("id"));
    const session = c.get("session");
    const visible = await one(
      `select 1 from groups g where g.id = $2 and (
         g.visibility = 'public' or g.owner_id = $1
         or exists (select 1 from group_members gm where gm.group_id = g.id and gm.user_id = $1)
       )`,
      [session?.id ?? null, groupId],
    );
    if (!visible) throw new HttpError(404, "not_found", "Group not found.");
    const goals = await q(
      `select g.id, g.title, g.detail, g.progress_label, g.progress_count, g.progress_target, u.handle as organizer_handle
       from community_goals g join users u on u.id = g.organizer_id
       where g.group_id = $1 order by g.created_at desc`,
      [groupId],
    );
    const proposals = await q(
      `select p.id, p.goal_id, p.kind, p.statement, p.status, u.handle, u.display_name
       from sponsor_proposals p join users u on u.id = p.proposer_id
       where p.goal_id in (select id from community_goals where group_id = $1) and p.status <> 'withdrawn'
       order by p.created_at`,
      [groupId],
    );
    return c.json({
      goals: goals.map((goal) => ({
        id: goal.id,
        title: goal.title,
        detail: goal.detail,
        progressLabel: goal.progress_label,
        progressCount: goal.progress_count,
        progressTarget: goal.progress_target,
        organizerHandle: goal.organizer_handle,
        moneyRaised: null,
        proposals: proposals.filter((item) => item.goal_id === goal.id).map((item) => ({
          id: item.id,
          kind: item.kind,
          statement: item.statement,
          status: item.status,
          from: { handle: item.handle, displayName: item.display_name },
          label: item.status === "agreed" ? "Sponsored" : null,
          paid: false,
          disclaimer: item.status === "agreed" ? "The organizer marked this proposal as agreed. No payment was collected and no business was created." : null,
        })),
      })),
    });
  });

  app.patch("/api/goals/:id", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const goal = await one<{ organizer_id: string; group_id: string }>("select organizer_id, group_id from community_goals where id = $1", [id]);
    if (!goal) throw new HttpError(404, "not_found", "Goal not found.");
    const member = await one<{ role: string }>("select role from group_members where group_id = $1 and user_id = $2", [goal.group_id, session.id]);
    if (!member || (member.role !== "owner" && member.role !== "admin")) throw new HttpError(403, "forbidden", "Only an owner or admin can update progress.");
    const body = await bodyObject(c);
    if ("raisedCents" in body || "amount" in body || "balance" in body) throw new HttpError(400, "validation", "Progress is a count, not money raised.");
    const count = optionalInt(body.progressCount, "progressCount");
    if (count == null || count < 0 || count > 1_000_000) throw new HttpError(400, "validation", "Enter a progress count.", { progressCount: "Use a whole number from 0 up." });
    await one("update community_goals set progress_count = $2, updated_at = now() where id = $1", [id, count]);
    return c.json({ goal: { id, progressCount: count, moneyRaised: null } });
  });

  app.post("/api/goals/:id/proposals", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const goal = await one<{ group_id: string }>("select group_id from community_goals where id = $1", [id]);
    if (!goal) throw new HttpError(404, "not_found", "Goal not found.");
    const visible = await one(
      `select 1 from groups g where g.id = $2 and (g.visibility = 'public' or exists (select 1 from group_members gm where gm.group_id = g.id and gm.user_id = $1))`,
      [session.id, goal.group_id],
    );
    if (!visible) throw new HttpError(404, "not_found", "Goal not found.");
    const body = await bodyObject(c);
    const kind = body.kind === "partner" ? "partner" : body.kind === "sponsor" ? "sponsor" : "";
    if (!kind) throw new HttpError(400, "validation", "Choose a sponsor proposal or a partner inquiry.", { kind: "Choose sponsor or partner." });
    const statement = cleanText(body.statement, 2000, "statement", "Proposal", { multiline: true });
    const row = await one<{ id: string }>(
      "insert into sponsor_proposals (goal_id, proposer_id, kind, statement) values ($1, $2, $3, $4) returning id",
      [id, session.id, kind, statement],
    );
    return c.json({
      proposal: { id: row?.id, status: "submitted", kind, paid: false },
      granted: false,
      disclaimer: kind === "partner" ? "This is an inquiry to the organizer. It is not a grant award." : "This is a proposal. It is not a payment or a confirmed sponsorship.",
    }, 201);
  });

  app.post("/api/proposals/:id/decision", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const proposal = await one<{ goal_id: string | null; cause_id: string | null; proposer_id: string }>(
      "select goal_id, cause_id, proposer_id from sponsor_proposals where id = $1",
      [id],
    );
    if (!proposal) throw new HttpError(404, "not_found", "Proposal not found.");
    const body = await bodyObject(c);
    const decision = body.status;
    if (decision === "withdrawn") {
      if (proposal.proposer_id !== session.id) throw new HttpError(403, "forbidden", "Only the person who wrote the proposal can withdraw it.");
      await one("update sponsor_proposals set status = 'withdrawn', updated_at = now() where id = $1", [id]);
      return c.json({ proposal: { id, status: "withdrawn", label: null, paid: false, fundsCollected: 0 } });
    }
    let allowed = false;
    let label = "Sponsored";
    let disclaimer = "The organizer marked this proposal as agreed. No payment was collected and no business was created.";
    if (proposal.cause_id) {
      const cause = await one<{ organizer_id: string; group_id: string | null }>("select organizer_id, group_id from causes where id = $1", [proposal.cause_id]);
      if (!cause) throw new HttpError(404, "not_found", "Cause not found.");
      allowed = cause.organizer_id === session.id;
      if (cause.group_id) {
        const member = await one<{ role: string }>("select role from group_members where group_id = $1 and user_id = $2", [cause.group_id, session.id]);
        if (member && (member.role === "owner" || member.role === "admin")) allowed = true;
      }
      label = "Accepted offer";
      disclaimer = "This is an accepted offer of support. No funds were collected. It is not a paid sponsorship.";
    } else if (proposal.goal_id) {
      const goal = await one<{ group_id: string }>("select group_id from community_goals where id = $1", [proposal.goal_id]);
      const member = await one<{ role: string }>("select role from group_members where group_id = $1 and user_id = $2", [goal?.group_id, session.id]);
      allowed = Boolean(member && (member.role === "owner" || member.role === "admin"));
    }
    if (!allowed) throw new HttpError(403, "forbidden", "Only the organizer can decide this offer.");
    if (decision !== "agreed" && decision !== "declined") throw new HttpError(400, "validation", "Choose agreed or declined.", { status: "Choose agreed or declined." });
    await one("update sponsor_proposals set status = $2, updated_at = now() where id = $1", [id, decision]);
    return c.json({
      proposal: {
        id,
        status: decision,
        label: decision === "agreed" ? label : null,
        paid: false,
        fundsCollected: 0,
        disclaimer: decision === "agreed" ? disclaimer : null,
      },
    });
  });

  app.get("/api/me/money", async (c) => {
    const session = requireUser(c);
    const quotes = await q(
      `select q.id, q.listing_id, q.price_cents, q.platform_fee_cents, q.seller_net_cents, q.buyer_total_cents, q.status, p.title
       from quote_requests q join posts p on p.id = q.listing_id
       where q.buyer_id = $1 order by q.created_at desc`,
      [session.id],
    );
    const plans = await q("select plan_code, status from plan_interests where user_id = $1", [session.id]);
    const support = await q("select id, post_id, wished_cents, note, status from support_interests where user_id = $1 and status = 'requested'", [session.id]);
    const proposals = await q(
      `select id, goal_id, kind, status from sponsor_proposals where proposer_id = $1 and status <> 'withdrawn'`,
      [session.id],
    );
    const records = await one<{ n: number }>("select count(*)::int as n from financial_records where actor_id = $1", [session.id]);
    const entitlement = await one("select 1 from entitlements where user_id = $1 and code = 'pro_commercial' and active = true", [session.id]);
    return c.json({
      payments: { enabled: false, gateOpen: false, provider: null, balance: null, transactions: [] },
      financialRecordCount: records?.n ?? 0,
      entitlement: { proCommercial: Boolean(entitlement) },
      verification: "not_available",
      interests: { quotes, plans, support, proposals },
    });
  });

  app.post("/api/checkout", async () => {
    await paymentsClosed();
  });
  app.post("/api/tips", async () => {
    await paymentsClosed();
  });
  app.post("/api/payments", async () => {
    await paymentsClosed();
  });
}
