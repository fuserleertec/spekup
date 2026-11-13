import { one } from "./db.js";
import { HttpError } from "./errors.js";

export async function rateLimit(bucket: string, limit: number, windowSec: number) {
  const windowMs = windowSec * 1000;
  const startMs = Math.floor(Date.now() / windowMs) * windowMs;
  const windowStart = new Date(startMs);
  const row = await one<{ count: number }>(
    `insert into rate_limits (bucket, window_start, count) values ($1, $2, 1)
     on conflict (bucket, window_start) do update set count = rate_limits.count + 1
     returning count`,
    [bucket, windowStart],
  );
  if (row && row.count > limit) {
    const retry = Math.max(1, Math.ceil((startMs + windowMs - Date.now()) / 1000));
    throw new HttpError(429, "rate_limited", "Too many requests. Try again later.", { retryAfter: String(retry) });
  }
  if (Math.random() < 0.02) {
    await one(`delete from rate_limits where window_start < now() - interval '2 days'`).catch(() => undefined);
  }
}

export function limitFromEnv(name: string, fallback: number) {
  const n = Number(process.env[name] || fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
