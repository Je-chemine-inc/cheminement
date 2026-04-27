/**
 * In-memory IP-based rate limiter for Next.js API routes (Node.js runtime).
 *
 * NOTE: Each serverless function instance has its own memory. For multi-instance
 * production deployments (Vercel, etc.) upgrade to an Upstash Redis store:
 *   https://upstash.com/docs/redis/sdks/ratelimit-ts/overview
 *
 * Current implementation is safe for single-instance and development use,
 * and provides meaningful protection against burst abuse on any given instance.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * @param key     Unique key (e.g. `signup:${ip}`)
 * @param limit   Max requests allowed in the window
 * @param windowMs  Duration of the window in milliseconds
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  cleanup();

  const now = Date.now();
  let entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 1, resetAt: now + windowMs };
    store.set(key, entry);
    return { allowed: true, remaining: limit - 1, resetAt: entry.resetAt };
  }

  entry.count += 1;
  const allowed = entry.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
  };
}

/**
 * Extract the real IP from a Next.js request, respecting common proxy headers.
 */
export function getClientIp(req: { headers: { get(name: string): string | null } }): string {
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "unknown"
  );
}

/**
 * Pre-configured limiters for auth endpoints.
 */
export const AuthRateLimits = {
  signup: { limit: 5, windowMs: 15 * 60 * 1000 },
  verifyEmail: { limit: 10, windowMs: 15 * 60 * 1000 },
  verifyPhone: { limit: 10, windowMs: 15 * 60 * 1000 },
  sendSms: { limit: 3, windowMs: 10 * 60 * 1000 },
  resendEmail: { limit: 3, windowMs: 10 * 60 * 1000 },
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
} as const;
