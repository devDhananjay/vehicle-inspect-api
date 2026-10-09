import { AppError } from "./errors.mjs";
import { logger } from "./logger.mjs";

export function createRateLimiter({
  windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  maxRequests = Number(process.env.RATE_LIMIT_MAX || 30),
} = {}) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();

  function prune(key, now) {
    const list = hits.get(key) || [];
    const kept = list.filter((t) => now - t < windowMs);
    if (kept.length) hits.set(key, kept);
    else hits.delete(key);
    return kept;
  }

  return {
    check(key = "global") {
      const now = Date.now();
      const recent = prune(key, now);
      if (recent.length >= maxRequests) {
        const retryAfterMs = windowMs - (now - recent[0]);
        logger.warn("rate_limit.exceeded", { key, maxRequests, windowMs });
        throw new AppError("Too many requests. Please retry later.", {
          status: 429,
          code: "RATE_LIMITED",
          details: {
            retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
          },
        });
      }
      recent.push(now);
      hits.set(key, recent);
    },
    stats() {
      return { windowMs, maxRequests, trackedKeys: hits.size };
    },
  };
}

export const vehicleRateLimiter = createRateLimiter();
