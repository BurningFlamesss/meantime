import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Small fixed-window limiter for a single API instance. It is intentionally
 * dependency-free: Redis is optional in this deployment, and a limiter that
 * fails open when Redis is down is worse than an in-process one that at least
 * blunts brute force and accidental loops.
 *
 * Limits are per process. A multi-instance deployment should put a shared
 * limiter in front of the API; this remains a last line of defense.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

function prune(now: number): void {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Still oversized: drop the oldest inserts until we are back under the cap.
  for (const key of buckets.keys()) {
    if (buckets.size <= MAX_BUCKETS) break;
    buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
  /** Configured ceiling for this scope/window. */
  limit: number;
  /** Requests left in the current window (0 once exhausted). */
  remaining: number;
  /** Epoch ms when the window resets. */
  resetAt: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  prune(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, retryAfterSec: 0, limit, remaining: Math.max(0, limit - 1), resetAt };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      limit,
      remaining: 0,
      resetAt: bucket.resetAt,
    };
  }
  return {
    allowed: true,
    retryAfterSec: 0,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
  };
}

/**
 * Apply a limit and reply 429 when exceeded. `subject` should be the
 * authenticated user id where one exists; otherwise the request IP is used as
 * an in-memory key only (it is never logged or stored).
 */
export function rateLimit(
  req: FastifyRequest,
  reply: FastifyReply,
  scope: string,
  limit: number,
  windowMs: number,
  subject?: string,
): boolean {
  const result = checkRateLimit(`${scope}:${subject ?? req.ip}`, limit, windowMs);
  reply
    .header("x-ratelimit-limit", String(result.limit))
    .header("x-ratelimit-remaining", String(result.remaining))
    .header("x-ratelimit-reset", String(Math.ceil(result.resetAt / 1000)));
  if (result.allowed) return true;
  void reply
    .code(429)
    .header("retry-after", String(result.retryAfterSec))
    .send({ error: "rate_limited", retryAfterSec: result.retryAfterSec });
  return false;
}
