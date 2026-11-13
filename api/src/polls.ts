import type { Context, Hono } from "hono";
import { one, withTx } from "./db.js";
import { HttpError } from "./errors.js";
import { rateLimit } from "./rate.js";
import { localToUtc, requireTimezone } from "./time.js";
import { cleanText } from "./validate.js";

type SessionUser = { id: string };
type App = Hono<{ Variables: { session: SessionUser | null } }>;
type Subject = "politician" | "corporation" | "community";

const SUBJECTS: Subject[] = ["politician", "corporation", "community"];

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

export type PollInput = {
  subjectType: Subject;
  subjectLabel: string;
  options: string[];
  closesAt: Date | null;
  timezone: string;
};

export function readPoll(body: Record<string, unknown>): PollInput {
  const subjectType = body.subjectType;
  if (typeof subjectType !== "string" || !SUBJECTS.includes(subjectType as Subject)) {
    throw new HttpError(400, "validation", "Choose a politician, corporation, or community subject.", { subjectType: "Choose a subject." });
  }
  const subjectLabel = cleanText(body.subjectLabel ?? "", 120, "subjectLabel", "Subject", { required: false });
  if (!Array.isArray(body.options)) {
    throw new HttpError(400, "validation", "Add between 2 and 6 options.", { options: "Add between 2 and 6 options." });
  }
  if (body.options.length < 2 || body.options.length > 6) {
    throw new HttpError(400, "validation", "Add between 2 and 6 options.", { options: "Use 2 to 6 options." });
  }
  const options = body.options.map((option, index) => cleanText(option, 80, "options", `Option ${index + 1}`));
  const seen = new Set<string>();
  for (const option of options) {
    const key = option.toLowerCase();
    if (seen.has(key)) throw new HttpError(400, "validation", "Options must be different.", { options: "Remove the duplicate option." });
    seen.add(key);
  }
  const local = typeof body.closesAtLocal === "string" ? body.closesAtLocal.trim() : "";
  if (!local) return { subjectType: subjectType as Subject, subjectLabel, options, closesAt: null, timezone: "UTC" };
  const timezone = requireTimezone(body.timezone);
  const closesAt = localToUtc(local, timezone, "closesAtLocal");
  if (closesAt.getTime() <= Date.now()) {
    throw new HttpError(400, "validation", "The close time has to be in the future.", { closesAtLocal: "Choose a later time." });
  }
  return { subjectType: subjectType as Subject, subjectLabel, options, closesAt, timezone };
}

const VISIBLE = `(p.group_id is null or p.author_id = $1
  or exists (select 1 from groups gv where gv.id = p.group_id and gv.visibility = 'public')
  or exists (select 1 from group_members gm where gm.group_id = p.group_id and gm.user_id = $1))`;

async function visiblePoll(postId: string, viewerId: string | null) {
  const row = await one<{ id: string; author_id: string }>(
    `select p.id, p.author_id from posts p
     where p.id = $2 and p.deleted_at is null and p.kind = 'poll' and ${VISIBLE}`,
    [viewerId, postId],
  );
  if (!row) throw new HttpError(404, "not_found", "Poll not found.");
  return row;
}

export async function createPoll(
  authorId: string,
  post: { title: string; text: string; topic: string; groupId: string | null },
  body: Record<string, unknown>,
) {
  const poll = readPoll(body);
  return withTx(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `insert into posts (author_id, kind, title, body, topic, group_id)
       values ($1, 'poll', $2, $3, $4, $5) returning id`,
      [authorId, post.title, post.text, post.topic, post.groupId],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new HttpError(500, "server", "Could not save the poll.");
    await client.query(
      `insert into polls (post_id, subject_type, subject_label, closes_at, timezone)
       values ($1, $2, $3, $4, $5)`,
      [id, poll.subjectType, poll.subjectLabel, poll.closesAt, poll.timezone],
    );
    for (let i = 0; i < poll.options.length; i += 1) {
      await client.query(
        "insert into poll_options (post_id, label, position) values ($1, $2, $3)",
        [id, poll.options[i], i],
      );
    }
    await client.query(
      "insert into poll_events (post_id, actor_id, action, note) values ($1, $2, 'created', $3)",
      [id, authorId, "Community opinion opened. Not an election."],
    );
    return id;
  });
}

export async function updatePoll(
  authorId: string,
  postId: string,
  post: { title: string; text: string; topic: string; groupId: string | null },
  body: Record<string, unknown>,
) {
  const poll = readPoll(body);
  await withTx(async (client) => {
    const locked = await client.query<{ author_id: string; status: string }>(
      `select p.author_id, pl.status from posts p
       join polls pl on pl.post_id = p.id
       where p.id = $1 and p.deleted_at is null and p.kind = 'poll'
       for update`,
      [postId],
    );
    const row = locked.rows[0];
    if (!row || row.author_id !== authorId) throw new HttpError(404, "not_found", "Poll not found.");
    const votes = await client.query<{ n: number }>("select count(*)::int as n from poll_votes where post_id = $1", [postId]);
    if ((votes.rows[0]?.n ?? 0) > 0 || row.status !== "open") {
      throw new HttpError(409, "conflict", "Question and options stay as they were once someone has voted, or after the poll closes. You can close or cancel it.");
    }
    await client.query(
      `update posts set title = $1, body = $2, topic = $3, group_id = $4, price_mode = null, price_cents = null, listing_kind = null, updated_at = now()
       where id = $5 and author_id = $6`,
      [post.title, post.text, post.topic, post.groupId, postId, authorId],
    );
    await client.query(
      `update polls set subject_type = $1, subject_label = $2, closes_at = $3, timezone = $4, updated_at = now() where post_id = $5`,
      [poll.subjectType, poll.subjectLabel, poll.closesAt, poll.timezone, postId],
    );
    await client.query("delete from poll_options where post_id = $1", [postId]);
    for (let i = 0; i < poll.options.length; i += 1) {
      await client.query("insert into poll_options (post_id, label, position) values ($1, $2, $3)", [postId, poll.options[i], i]);
    }
    await client.query(
      "insert into poll_events (post_id, actor_id, action, note) values ($1, $2, 'edited', 'Question updated before any vote.')",
      [postId, authorId],
    );
  });
}

function votingOpen(status: string, closesAt: Date | null) {
  if (status !== "open") return false;
  if (closesAt && closesAt.getTime() <= Date.now()) return false;
  return true;
}

export function registerPolls(app: App) {
  app.post("/api/polls/:id/vote", async (c) => {
    const session = requireUser(c);
    await rateLimit(`poll-vote:${session.id}`, 60, 3600);
    const postId = parseId(c.req.param("id"));
    await visiblePoll(postId, session.id);
    const optionId = cleanText((await bodyObject(c)).optionId, 80, "optionId", "Option");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(optionId)) {
      throw new HttpError(400, "validation", "Choose an option on this poll.", { optionId: "Choose an option on this poll." });
    }
    await withTx(async (client) => {
      const locked = await client.query<{ status: string; closes_at: Date | null }>(
        "select status, closes_at from polls where post_id = $1 for update",
        [postId],
      );
      const poll = locked.rows[0];
      if (!poll) throw new HttpError(404, "not_found", "Poll not found.");
      if (!votingOpen(poll.status, poll.closes_at)) {
        throw new HttpError(409, "conflict", "This poll is not open for votes.");
      }
      const option = await client.query("select 1 from poll_options where id = $1 and post_id = $2", [optionId, postId]);
      if (!option.rowCount) throw new HttpError(400, "validation", "That option is not on this poll.", { optionId: "Choose an option on this poll." });
      await client.query(
        `insert into poll_votes (post_id, user_id, option_id) values ($1, $2, $3)
         on conflict (post_id, user_id) do update set option_id = excluded.option_id, updated_at = now()`,
        [postId, session.id, optionId],
      );
    });
    const count = await one<{ n: number }>("select count(*)::int as n from poll_votes where post_id = $1", [postId]);
    return c.json({ respondents: count?.n ?? 0, viewerChoice: optionId });
  });

  app.delete("/api/polls/:id/vote", async (c) => {
    const session = requireUser(c);
    const postId = parseId(c.req.param("id"));
    await visiblePoll(postId, session.id);
    await withTx(async (client) => {
      const locked = await client.query<{ status: string; closes_at: Date | null }>(
        "select status, closes_at from polls where post_id = $1 for update",
        [postId],
      );
      const poll = locked.rows[0];
      if (!poll) throw new HttpError(404, "not_found", "Poll not found.");
      if (!votingOpen(poll.status, poll.closes_at)) throw new HttpError(409, "conflict", "Votes stay as they were after a poll closes.");
      await client.query("delete from poll_votes where post_id = $1 and user_id = $2", [postId, session.id]);
    });
    const count = await one<{ n: number }>("select count(*)::int as n from poll_votes where post_id = $1", [postId]);
    return c.json({ respondents: count?.n ?? 0, viewerChoice: null });
  });

  app.post("/api/polls/:id/follow", async (c) => {
    const session = requireUser(c);
    const postId = parseId(c.req.param("id"));
    await visiblePoll(postId, session.id);
    await one("insert into poll_follows (user_id, post_id) values ($1, $2) on conflict do nothing", [session.id, postId]);
    return c.json({ following: true });
  });

  app.delete("/api/polls/:id/follow", async (c) => {
    const session = requireUser(c);
    const postId = parseId(c.req.param("id"));
    await visiblePoll(postId, session.id);
    await one("delete from poll_follows where user_id = $1 and post_id = $2", [session.id, postId]);
    return c.json({ following: false });
  });

  async function setStatus(c: Context<{ Variables: { session: SessionUser | null } }>, status: "closed" | "canceled") {
    const session = requireUser(c);
    const postId = parseId(c.req.param("id"));
    const poll = await visiblePoll(postId, session.id);
    if (poll.author_id !== session.id) throw new HttpError(403, "forbidden", "Only the person who wrote the poll can do that.");
    await withTx(async (client) => {
      const locked = await client.query<{ status: string }>("select status from polls where post_id = $1 for update", [postId]);
      const current = locked.rows[0]?.status;
      if (!current) throw new HttpError(404, "not_found", "Poll not found.");
      if (current === "canceled" && status === "closed") throw new HttpError(409, "conflict", "A canceled poll stays canceled.");
      if (current !== status) {
        await client.query("update polls set status = $2, updated_at = now() where post_id = $1", [postId, status]);
        await client.query(
          "insert into poll_events (post_id, actor_id, action, note) values ($1, $2, $3, $4)",
          [postId, session.id, status, status === "closed" ? "Closed by the author. Results stay visible." : "Canceled by the author. This is not a result."],
        );
      }
    });
    return c.json({ status });
  }

  app.post("/api/polls/:id/close", (c) => setStatus(c, "closed"));
  app.post("/api/polls/:id/cancel", (c) => setStatus(c, "canceled"));
}
