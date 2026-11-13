import { one, pool, q } from "./db.js";
import { HttpError } from "./errors.js";
import { rateLimit } from "./rate.js";
import { RANKING_VERSION, orderFeed, scorePost, type RankReason } from "./ranking.js";
import { TOPICS, cleanText } from "./validate.js";

type SessionUser = { id: string };
type Ctx = {
  get: (key: "session") => SessionUser | null;
  json: (body: unknown, status?: number) => Response;
  req: { param: (name: string) => string; text: () => Promise<string>; query: (name: string) => string | undefined };
};

type FeedPost = {
  id: string;
  topic: string;
  title: string;
  body: string;
  createdAt: string;
  mediaUrl?: string | null;
  video?: { status?: string | null; durationMs?: number | null } | null;
  author: { id: string };
  viewer?: { isAuthor?: boolean };
  digital?: { healthPromotion?: boolean } | null;
  rank?: { version: string; score: number; reasons: RankReason[]; mode: string };
};

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

async function prune(userId: string) {
  await q("delete from watch_daily where user_id = $1 and day < current_date - 30", [userId]);
  await q("delete from watch_events where user_id = $1 and created_at < now() - interval '30 days'", [userId]);
}

export async function prepareSocialFeed(posts: FeedPost[], viewerId: string | null, mode: "ranked" | "creators", offset: number) {
  const limit = 20;
  const safeOffset = Math.max(0, Math.min(offset, 60));
  let rows = posts;
  let personalization = true;
  let watchEnabled = false;
  let interests: string[] = [];
  const less = new Set<string>();
  const watch = new Map<string, { watchedMs: number; playCount: number }>();
  const followed = new Set<string>();
  if (viewerId) {
    const settings = await one<{ personalization: boolean; watch_opt_in: boolean }>("select personalization, watch_opt_in from feed_settings where user_id = $1", [viewerId]);
    personalization = settings?.personalization !== false;
    watchEnabled = Boolean(settings?.watch_opt_in);
    const hidden = await q<{ post_id: string; topic_less: boolean }>("select post_id, topic_less from feed_hides where user_id = $1", [viewerId]);
    const hiddenIds = new Set(hidden.map((row) => row.post_id));
    const muted = await q<{ muted_id: string }>("select muted_id from feed_mutes where user_id = $1", [viewerId]);
    const mutedIds = new Set(muted.map((row) => row.muted_id));
    rows = rows.filter((post) => !hiddenIds.has(post.id) && !mutedIds.has(post.author.id));
    interests = (await q<{ topic: string }>("select topic from feed_interests where user_id = $1", [viewerId])).map((row) => row.topic);
    for (const row of hidden) {
      if (row.topic_less) {
        const post = posts.find((item) => item.id === row.post_id);
        if (post) less.add(post.topic);
      }
    }
    const follows = await q<{ followee_id: string }>("select followee_id from follows where follower_id = $1", [viewerId]);
    for (const row of follows) followed.add(row.followee_id);
    if (watchEnabled) {
      const days = await q<{ post_id: string; watched_ms: number; play_count: number }>(
        "select post_id, watched_ms, play_count from watch_daily where user_id = $1 and day >= current_date - 30",
        [viewerId],
      );
      for (const row of days) watch.set(row.post_id, { watchedMs: row.watched_ms, playCount: row.play_count });
    }
  }
  if (mode === "creators" || !personalization || !viewerId && mode !== "ranked") {
    const chronological = mode === "creators" || !personalization;
    if (chronological) {
      const page = rows.slice(safeOffset, safeOffset + limit).map((post) => ({
        ...post,
        rank: {
          version: RANKING_VERSION,
          score: 0,
          mode: mode === "creators" ? "following-chronological" : "chronological",
          reasons: [{ code: "chronological", weight: 1, value: 1, text: mode === "creators"
            ? "Following is newest first from creators you follow. It does not add recommendations."
            : "Personalized ranking is off. This list is newest first." }],
        },
      }));
      return { posts: page, caughtUp: safeOffset + page.length >= rows.length, version: RANKING_VERSION, mode: page[0]?.rank.mode || "chronological" };
    }
  }
  const now = Date.now();
  const seed = `${viewerId || "anonymous"}:${new Date(now).toISOString().slice(0, 10)}`;
  const scored = rows.map((post) => {
    const duration = post.video?.durationMs || 0;
    const signal = watch.get(post.id);
    const ranked = scorePost({
      id: post.id,
      authorId: post.author.id,
      topic: post.topic,
      createdAt: post.createdAt,
      bodyLength: post.body.length,
      titleLength: post.title.length,
      hasImage: Boolean(post.mediaUrl),
      videoReady: post.video?.status === "ready",
      healthPromotion: Boolean(post.digital?.healthPromotion),
      followed: followed.has(post.author.id),
    }, {
      now,
      interests: viewerId ? interests : [],
      lessTopics: less,
      watchEnabled: Boolean(viewerId && watchEnabled),
      personalization: Boolean(viewerId),
      watch: signal && duration ? { ...signal, durationMs: duration } : null,
    });
    return { ...post, authorId: post.author.id, ...ranked, followed: followed.has(post.author.id) };
  });
  const ordered = orderFeed(scored, seed, Boolean(viewerId));
  const page = ordered.slice(safeOffset, safeOffset + limit).map((post) => {
    const { score, reasons, followed: _followed, ...rest } = post;
    return { ...rest, rank: { version: RANKING_VERSION, score, reasons, mode: viewerId ? "for-you" : "anonymous-recency" } };
  });
  return { posts: page, caughtUp: safeOffset + page.length >= ordered.length, version: RANKING_VERSION, mode: viewerId ? "for-you" : "anonymous-recency" };
}

export function registerSocial(app: { get: Function; put: Function; post: Function; patch: Function; delete: Function }) {
  app.get("/api/feed/guide", (c: Ctx) => c.json({
    version: RANKING_VERSION,
    following: "Newest first from creators you follow. No recommended or paid posts are inserted.",
    forYou: "Version social-baseline-1. Without watch opt-in the score is 0.55 recency, 0.30 topic, and 0.15 substance. Recency falls by half about every 50 hours. Topic is neutral until you select topics. Substance is length plus a photo or ready clip, not a credibility score. With watch opt-in the weights are 0.50, 0.25, 0.15, and 0.10. Repeats add at most 25 percent. Every fifth slot can show a creator you do not follow. That is not a guaranteed audience.",
    watch: "Watch counting is off until you opt in. It stores a daily count and milliseconds for 30 days, then deletes them. It is not a record of every millisecond, and it is not fraud-proof.",
  }));

  app.get("/api/feed/settings", async (c: Ctx) => {
    const session = requireUser(c);
    const row = await one<{ personalization: boolean; watch_opt_in: boolean }>("select personalization, watch_opt_in from feed_settings where user_id = $1", [session.id]);
    const topics = await q<{ topic: string }>("select topic from feed_interests where user_id = $1 order by topic", [session.id]);
    return c.json({ personalization: row?.personalization !== false, watchOptIn: Boolean(row?.watch_opt_in), topics: topics.map((item) => item.topic), rankingVersion: RANKING_VERSION });
  });

  app.patch("/api/feed/settings", async (c: Ctx) => {
    const session = requireUser(c);
    const body = await bodyObject(c);
    const personalization = body.personalization !== false;
    const watchOptIn = body.watchOptIn === true;
    await q(
      `insert into feed_settings (user_id, personalization, watch_opt_in) values ($1,$2,$3)
       on conflict (user_id) do update set personalization = $2, watch_opt_in = $3, updated_at = now()`,
      [session.id, personalization, watchOptIn],
    );
    if (!watchOptIn) await q("delete from watch_daily where user_id = $1", [session.id]);
    return c.json({ personalization, watchOptIn });
  });

  app.put("/api/feed/interests", async (c: Ctx) => {
    const session = requireUser(c);
    const body = await bodyObject(c);
    if (!Array.isArray(body.topics) || body.topics.length > TOPICS.length) throw new HttpError(400, "validation", "Choose from the listed topics.", { topics: "Choose listed topics." });
    const topics = [...new Set(body.topics.map((topic) => {
      if (typeof topic !== "string" || !TOPICS.includes(topic as typeof TOPICS[number])) throw new HttpError(400, "validation", "That topic is not available.", { topics: "Choose a listed topic." });
      return topic;
    }))];
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from feed_interests where user_id = $1", [session.id]);
      for (const topic of topics) await client.query("insert into feed_interests (user_id, topic) values ($1,$2)", [session.id, topic]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    return c.json({ topics });
  });

  app.delete("/api/feed/interests", async (c: Ctx) => {
    const session = requireUser(c);
    await q("delete from feed_interests where user_id = $1", [session.id]);
    return c.json({ topics: [] });
  });

  app.post("/api/feed/hides", async (c: Ctx) => {
    const session = requireUser(c);
    const body = await bodyObject(c);
    const postId = parseId(String(body.postId || ""));
    const post = await one("select 1 from posts where id = $1 and deleted_at is null", [postId]);
    if (!post) throw new HttpError(404, "not_found", "Post not found.");
    await q(
      `insert into feed_hides (user_id, post_id, topic_less) values ($1,$2,$3)
       on conflict (user_id, post_id) do update set topic_less = feed_hides.topic_less or $3`,
      [session.id, postId, body.topicLess === true],
    );
    return c.json({ hidden: true });
  });

  app.delete("/api/feed/hides/:postId", async (c: Ctx) => {
    const session = requireUser(c);
    await q("delete from feed_hides where user_id = $1 and post_id = $2", [session.id, parseId(c.req.param("postId"))]);
    return c.json({ hidden: false });
  });

  app.post("/api/feed/mutes", async (c: Ctx) => {
    const session = requireUser(c);
    const body = await bodyObject(c);
    const handle = cleanText(body.handle, 32, "handle", "Handle").toLowerCase();
    const user = await one<{ id: string }>("select id from users where handle = $1", [handle]);
    if (!user) throw new HttpError(404, "not_found", "Person not found.");
    if (user.id === session.id) throw new HttpError(400, "validation", "You can't mute yourself.", { handle: "Choose someone else." });
    await q("insert into feed_mutes (user_id, muted_id) values ($1,$2) on conflict do nothing", [session.id, user.id]);
    return c.json({ muted: true });
  });

  app.delete("/api/feed/mutes/:handle", async (c: Ctx) => {
    const session = requireUser(c);
    const user = await one<{ id: string }>("select id from users where handle = $1", [c.req.param("handle").toLowerCase()]);
    if (!user) throw new HttpError(404, "not_found", "Person not found.");
    await q("delete from feed_mutes where user_id = $1 and muted_id = $2", [session.id, user.id]);
    return c.json({ muted: false });
  });

  app.post("/api/feed/history/reset", async (c: Ctx) => {
    const session = requireUser(c);
    await q("delete from watch_daily where user_id = $1", [session.id]);
    await q("delete from watch_events where user_id = $1", [session.id]);
    await q("delete from feed_hides where user_id = $1", [session.id]);
    return c.json({ reset: true, interestsKept: true });
  });

  app.post("/api/feed/watch", async (c: Ctx) => {
    const session = requireUser(c);
    await rateLimit(`watch:${session.id}`, 30, 60);
    const body = await bodyObject(c);
    const eventId = parseId(String(body.eventId || ""));
    const postId = parseId(String(body.postId || ""));
    const seen = await one("select 1 from watch_events where id = $1", [eventId]);
    if (seen) return c.json({ counted: false, reason: "duplicate" });
    const settings = await one<{ watch_opt_in: boolean }>("select watch_opt_in from feed_settings where user_id = $1", [session.id]);
    if (!settings?.watch_opt_in) return c.json({ counted: false, reason: "watch_off" });
    if (body.userInitiated !== true || body.hidden === true || body.paused === true || body.seeking === true || body.visible !== true) {
      return c.json({ counted: false, reason: "not_active_playback" });
    }
    const post = await one<{ author_id: string; duration_ms: number | null; status: string | null }>(
      `select p.author_id, v.duration_ms, v.status from posts p left join videos v on v.id = p.video_id
       where p.id = $1 and p.deleted_at is null`,
      [postId],
    );
    if (!post || post.status !== "ready" || !post.duration_ms) return c.json({ counted: false, reason: "not_ready" });
    if (post.author_id === session.id) return c.json({ counted: false, reason: "own_post" });
    const played = typeof body.playedMs === "number" && Number.isFinite(body.playedMs) ? Math.floor(body.playedMs) : 0;
    if (played < 1000) return c.json({ counted: false, reason: "too_short" });
    const countedMs = Math.min(5000, played, post.duration_ms);
    await prune(session.id);
    const client = await pool.connect();
    try {
      await client.query("begin");
      const inserted = await client.query("insert into watch_events (id, user_id) values ($1,$2) on conflict do nothing returning id", [eventId, session.id]);
      if (!inserted.rowCount) {
        await client.query("commit");
        return c.json({ counted: false, reason: "duplicate" });
      }
      await client.query(
        `insert into watch_daily (user_id, post_id, day, play_count, watched_ms)
         values ($1,$2,current_date,$3,$4)
         on conflict (user_id, post_id, day) do update
           set play_count = least(3, watch_daily.play_count + $3),
               watched_ms = least($5, watch_daily.watched_ms + $4)`,
        [session.id, postId, body.started === true ? 1 : 0, countedMs, post.duration_ms * 2],
      );
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
    return c.json({ counted: true, countedMs, capMs: 5000, retentionDays: 30 });
  });
}

void cleanText;
