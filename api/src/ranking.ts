export const RANKING_VERSION = "social-baseline-1";
export const RANKING_WEIGHTS = {
  off: { recency: 0.55, topic: 0.3, substance: 0.15, watch: 0 },
  watch: { recency: 0.5, topic: 0.25, substance: 0.15, watch: 0.1 },
} as const;

export type RankInput = {
  id: string;
  authorId: string;
  topic: string;
  createdAt: string;
  bodyLength: number;
  titleLength: number;
  hasImage: boolean;
  videoReady: boolean;
  healthPromotion: boolean;
  followed: boolean;
};

export type RankReason = { code: string; weight: number; value: number; text: string };

const HALF_LIFE_HOURS = 50;

export function recencyValue(createdAt: string, now: number) {
  const ageHours = Math.max(0, (now - new Date(createdAt).getTime()) / 3_600_000);
  const value = Math.exp((-ageHours * Math.LN2) / HALF_LIFE_HOURS);
  return Math.max(0, Math.min(1, value));
}

export function substanceValue(post: RankInput) {
  let value = post.bodyLength >= 40 ? 0.4 : 0.15;
  if (post.titleLength >= 8) value += 0.2;
  if (post.hasImage || post.videoReady) value += 0.4;
  return Math.max(0, Math.min(1, value));
}

export function topicValue(topic: string, interests: string[], lessTopics: Set<string>) {
  if (!interests.length) return { value: 0.5, text: "No topics selected. Topic weight is neutral for every post." };
  if (lessTopics.has(topic)) return { value: 0.1, text: "You asked for less of this topic. That is stronger than skipping a clip." };
  if (interests.includes(topic)) return { value: 1, text: "You selected this topic." };
  return { value: 0.2, text: "This topic is not one you selected." };
}

export function watchValue(watchedMs: number, durationMs: number, playCount: number) {
  if (durationMs <= 0 || watchedMs <= 0) return 0;
  const completion = Math.min(1, watchedMs / durationMs);
  const repeat = Math.min(1.25, 1 + 0.08 * Math.max(0, Math.min(playCount, 3) - 1));
  return Math.min(1, completion * repeat);
}

export function scorePost(post: RankInput, opts: {
  now: number;
  interests: string[];
  lessTopics: Set<string>;
  watch?: { watchedMs: number; durationMs: number; playCount: number } | null;
  watchEnabled: boolean;
  personalization: boolean;
}) {
  const recency = recencyValue(post.createdAt, opts.now);
  const topic = topicValue(post.topic, opts.personalization ? opts.interests : [], opts.lessTopics);
  const substance = substanceValue(post);
  const watch = opts.watchEnabled && !post.healthPromotion && opts.watch
    ? watchValue(opts.watch.watchedMs, opts.watch.durationMs, opts.watch.playCount)
    : 0;
  const weights = opts.watchEnabled ? RANKING_WEIGHTS.watch : RANKING_WEIGHTS.off;
  const reasons: RankReason[] = [
    { code: "recency", weight: weights.recency, value: round(recency), text: "Newer posts rank higher. This weight falls by half about every 50 hours." },
    { code: "topic", weight: weights.topic, value: round(topic.value), text: topic.text },
    { code: "substance", weight: weights.substance, value: round(substance), text: "Length, a title, and a photo or ready clip. This is not a credibility score or a follower count." },
  ];
  if (opts.watchEnabled) {
    reasons.push({
      code: "watch",
      weight: weights.watch,
      value: round(watch),
      text: post.healthPromotion
        ? "Health-related listings are not boosted by watch signals."
        : "Optional watch time you opted into. Repeats add at most 25 percent, not double. This is not fraud-proof.",
    });
  }
  const score = reasons.reduce((sum, reason) => sum + reason.weight * reason.value, 0);
  return { score: round(score), reasons };
}

export function orderFeed<T extends { id: string; authorId: string; createdAt: string; followed: boolean; score: number; reasons: RankReason[] }>(rows: T[], seed: string, explore: boolean) {
  const sorted = [...rows].sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const picked: T[] = [];
  const used = new Set<string>();
  const recentAuthors: string[] = [];
  const take = (preferExplore: boolean) => {
    const pool = sorted.filter((row) => !used.has(row.id) && (!preferExplore || (!row.followed && ageHours(row.createdAt) < 24 * 14 && hash(`${seed}:${row.id}`) % 100 < 40)));
    const choice = pool.find((row) => recentAuthors.filter((author) => author === row.authorId).length < 2) || pool[0];
    if (!choice) return;
    if (preferExplore) {
      choice.reasons = [...choice.reasons, { code: "exploration", weight: 0, value: 1, text: "Discovery slot for a creator you do not follow. This is not a guaranteed audience and not a viral boost." }];
    }
    used.add(choice.id);
    picked.push(choice);
    recentAuthors.push(choice.authorId);
    if (recentAuthors.length > 4) recentAuthors.shift();
  };
  while (picked.length < sorted.length) {
    const exploreSlot = explore && picked.length > 0 && picked.length % 5 === 4;
    const before = picked.length;
    if (exploreSlot) take(true);
    if (picked.length === before) take(false);
    if (picked.length === before) break;
  }
  return picked;
}

export function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function ageHours(createdAt: string) {
  return Math.max(0, (Date.now() - new Date(createdAt).getTime()) / 3_600_000);
}

function round(value: number) {
  return Math.round(value * 10000) / 10000;
}
