import { getProvider } from "./providers/index.mjs";
import { validateRc } from "./validate.mjs";
import { logger } from "./logger.mjs";
import { redactForLog } from "./redact.mjs";
import { vehicleRateLimiter } from "./rate-limit.mjs";

/**
 * Frontend-stable endpoint logic:
 *   GET /api/vehicle/:registrationNumber
 * Provider is selected via VEHICLE_PROVIDER or ?provider=
 * Response schema is always the complete vehicle-data shape.
 */
export async function lookupVehicle(rawRc, options = {}) {
  const rc = validateRc(rawRc);
  const provider = getProvider(options.provider);
  const timeoutMs = Number(options.timeoutMs || process.env.UPSTREAM_TIMEOUT_MS || 15_000);
  const safeTimeout = Math.min(Math.max(Number(timeoutMs) || 15_000, 1_000), 60_000);
  const rateLimitKey = options.rateLimitKey || "global";

  vehicleRateLimiter.check(rateLimitKey);

  logger.info(
    "service.lookup",
    redactForLog({
      rc,
      provider: provider.id,
      timeoutMs: safeTimeout,
      debug: Boolean(options.debug),
      full: Boolean(options.full),
    }),
  );

  const result = await provider.lookup(rc, {
    timeoutMs: safeTimeout,
    debug: Boolean(options.debug),
  });

  logger.info("service.lookup.ok", {
    rc,
    provider: result.provider,
    durationMs: result.meta?.durationMs ?? null,
  });

  const clean = {
    ok: true,
    data: result.data,
  };

  if (options.full || options.debug) {
    return {
      ...clean,
      availability: result.availability,
      provider: result.provider,
      meta: result.meta,
      ...(options.debug && result.debug ? { debug: redactForLog(result.debug) } : {}),
    };
  }

  return clean;
}
