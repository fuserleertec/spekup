import type { Hono } from "hono";
import { one, q } from "./db.js";
import { HttpError } from "./errors.js";
import { rateLimit } from "./rate.js";
import { cleanText } from "./validate.js";

function parseId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new HttpError(400, "validation", "That id is not valid.");
  }
  return id;
}

type SessionUser = { id: string };
type App = Hono<{ Variables: { session: SessionUser | null } }>;

function requireUser(c: { get: (key: "session") => SessionUser | null }) {
  const session = c.get("session");
  if (!session) throw new HttpError(401, "unauthorized", "Log in to continue.");
  return session;
}

export async function appendThreadMessage(input: {
  postId: string;
  buyerId: string;
  sellerId: string;
  authorId: string;
  body: string;
  inquiryId?: string | null;
}) {
  if (input.buyerId === input.sellerId) throw new HttpError(400, "validation", "You can't message yourself.");
  let thread = await one<{ id: string }>("select id from threads where post_id = $1 and buyer_id = $2", [input.postId, input.buyerId]);
  if (!thread) {
    thread = await one<{ id: string }>(
      "insert into threads (post_id, buyer_id, seller_id) values ($1,$2,$3) returning id",
      [input.postId, input.buyerId, input.sellerId],
    );
  }
  const message = await one<{ id: string; created_at: Date }>(
    "insert into thread_messages (thread_id, author_id, body, inquiry_id) values ($1,$2,$3,$4) returning id, created_at",
    [thread!.id, input.authorId, input.body, input.inquiryId ?? null],
  );
  return { threadId: thread!.id, messageId: message?.id, createdAt: message ? new Date(message.created_at).toISOString() : null };
}

async function loadThread(id: string) {
  return one<{ id: string; post_id: string; buyer_id: string; seller_id: string; title: string; listing_kind: string | null }>(
    `select t.id, t.post_id, t.buyer_id, t.seller_id, p.title, p.listing_kind
     from threads t join posts p on p.id = t.post_id where t.id = $1`,
    [id],
  );
}

function otherId(thread: { buyer_id: string; seller_id: string }, me: string) {
  return thread.buyer_id === me ? thread.seller_id : thread.buyer_id;
}

export function registerThreads(app: App) {
  app.get("/api/threads/summary", async (c) => {
    const session = requireUser(c);
    const row = await one<{ n: number }>(
      `select count(*)::int as n
       from thread_messages m
       join threads t on t.id = m.thread_id
       left join thread_reads r on r.thread_id = t.id and r.user_id = $1
       where (t.buyer_id = $1 or t.seller_id = $1)
         and m.author_id <> $1
         and (r.read_at is null or m.created_at > r.read_at)`,
      [session.id],
    );
    return c.json({ unread: row?.n ?? 0 });
  });

  app.get("/api/threads", async (c) => {
    const session = requireUser(c);
    const rows = await q<{
      id: string; post_id: string; title: string; listing_kind: string | null;
      other_handle: string; other_name: string; last_body: string | null; last_at: Date | null; unread: number;
    }>(
      `select t.id, t.post_id, p.title, p.listing_kind,
              ou.handle as other_handle, ou.display_name as other_name,
              lm.body as last_body, lm.created_at as last_at,
              (select count(*)::int from thread_messages m
                 left join thread_reads r on r.thread_id = t.id and r.user_id = $1
                 where m.thread_id = t.id and m.author_id <> $1
                   and (r.read_at is null or m.created_at > r.read_at)) as unread
       from threads t
       join posts p on p.id = t.post_id
       join users ou on ou.id = case when t.buyer_id = $1 then t.seller_id else t.buyer_id end
       left join lateral (
         select body, created_at from thread_messages where thread_id = t.id order by created_at desc limit 1
       ) lm on true
       where t.buyer_id = $1 or t.seller_id = $1
       order by coalesce(lm.created_at, t.created_at) desc
       limit 50`,
      [session.id],
    );
    const unread = rows.reduce((sum, row) => sum + row.unread, 0);
    return c.json({
      unread,
      threads: rows.map((row) => ({
        id: row.id,
        postId: row.post_id,
        title: row.title,
        listingKind: row.listing_kind,
        other: { handle: row.other_handle, displayName: row.other_name },
        lastMessage: row.last_body,
        lastAt: row.last_at ? new Date(row.last_at).toISOString() : null,
        unread: row.unread,
      })),
    });
  });

  app.post("/api/threads", async (c) => {
    const session = requireUser(c);
    await rateLimit(`message:${session.id}`, 30, 3600);
    const body = await bodyObject(c);
    const postId = parseId(String(body.postId || ""));
    const post = await one<{ author_id: string; kind: string; listing_kind: string | null; deleted_at: Date | null; title: string; availability: string }>(
      "select author_id, kind, listing_kind, deleted_at, title, availability from posts where id = $1",
      [postId],
    );
    if (!post || post.deleted_at || post.kind !== "offer") throw new HttpError(404, "not_found", "Listing not found.");
    if (post.author_id === session.id) throw new HttpError(400, "validation", "You can't message yourself.");
    if (post.availability !== "available") throw new HttpError(409, "conflict", "This listing is not available. Nothing was reserved or charged.");
    const purpose = body.purpose === "booking_request" ? "booking_request" : "message";
    if (purpose === "booking_request" && post.listing_kind !== "service") {
      throw new HttpError(400, "validation", "A booking request is for a service listing.", { purpose: "Use a service listing." });
    }
    const text = cleanText(body.body, 2000, "body", "Message", { multiline: true });
    const when = cleanText(body.timeNote ?? "", 120, "timeNote", "Time", { required: false });
    const stored = when ? `Proposed time: ${when}\n${text}` : text;
    const inquiry = await one<{ id: string }>(
      "insert into inquiries (post_id, author_id, body, purpose) values ($1,$2,$3,$4) returning id",
      [postId, session.id, stored, purpose],
    );
    const saved = await appendThreadMessage({
      postId, buyerId: session.id, sellerId: post.author_id, authorId: session.id, body: stored, inquiryId: inquiry?.id,
    });
    return c.json({ threadId: saved.threadId, messageId: saved.messageId, delivery: "internal_only", appointment: null, paid: false }, 201);
  });

  app.get("/api/threads/:id", async (c) => {
    const session = requireUser(c);
    const id = parseId(c.req.param("id"));
    const thread = await loadThread(id);
    if (!thread || (thread.buyer_id !== session.id && thread.seller_id !== session.id)) throw new HttpError(404, "not_found", "Conversation not found.");
    await q(
      `insert into thread_reads (thread_id, user_id, read_at) values ($1,$2,now())
       on conflict (thread_id, user_id) do update set read_at = now()`,
      [id, session.id],
    );
    const messages = await q<{ id: string; author_id: string; body: string; created_at: Date; handle: string; display_name: string }>(
      `select m.id, m.author_id, m.body, m.created_at, u.handle, u.display_name
       from thread_messages m join users u on u.id = m.author_id
       where m.thread_id = $1 order by m.created_at asc`,
      [id],
    );
    const other = otherId(thread, session.id);
    const muted = await one("select 1 from feed_mutes where user_id = $1 and muted_id = $2", [session.id, other]);
    const person = await one<{ handle: string; display_name: string }>("select handle, display_name from users where id = $1", [other]);
    const otherRead = await one<{ read_at: Date }>("select read_at from thread_reads where thread_id = $1 and user_id = $2", [id, other]);
    const seenAt = otherRead ? new Date(otherRead.read_at).getTime() : 0;
    return c.json({
      thread: {
        id: thread.id,
        postId: thread.post_id,
        title: thread.title,
        listingKind: thread.listing_kind,
        other: { handle: person?.handle, displayName: person?.display_name },
        muted: Boolean(muted),
        note: "You'll see replies here. Nothing is emailed.",
      },
      messages: messages.map((row) => ({
        id: row.id,
        body: row.body,
        createdAt: new Date(row.created_at).toISOString(),
        mine: row.author_id === session.id,
        read: row.author_id === session.id ? new Date(row.created_at).getTime() <= seenAt : true,
        author: { handle: row.handle, displayName: row.display_name },
      })),
    });
  });

  app.post("/api/threads/:id/messages", async (c) => {
    const session = requireUser(c);
    await rateLimit(`message:${session.id}`, 30, 3600);
    const id = parseId(c.req.param("id"));
    const thread = await loadThread(id);
    if (!thread || (thread.buyer_id !== session.id && thread.seller_id !== session.id)) throw new HttpError(404, "not_found", "Conversation not found.");
    const text = cleanText((await bodyObject(c)).body, 2000, "body", "Message", { multiline: true });
    const saved = await one<{ id: string; created_at: Date }>(
      "insert into thread_messages (thread_id, author_id, body) values ($1,$2,$3) returning id, created_at",
      [id, session.id, text],
    );
    await q(
      `insert into thread_reads (thread_id, user_id, read_at) values ($1,$2,now())
       on conflict (thread_id, user_id) do update set read_at = now()`,
      [id, session.id],
    );
    return c.json({ message: { id: saved?.id, body: text, createdAt: saved ? new Date(saved.created_at).toISOString() : null, mine: true } }, 201);
  });
}

async function bodyObject(c: { req: { json: () => Promise<unknown> } }) {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "validation", "Send a JSON object.");
  return body as Record<string, unknown>;
}
