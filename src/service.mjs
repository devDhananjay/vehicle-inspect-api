import { logger } from "./lib/logger.mjs";
import { redactForLog } from "./lib/redact.mjs";
import { vehicleRateLimiter } from "./lib/rate-limit.mjs";
import { getActiveProviderName, getVehicleDetails } from "./providers/index.mjs";

/**
 * Application service for:
 *   GET /api/vehicle/:registrationNumber
 */
export async function lookupVehicle(rawRc, options = {}) {
  const rateLimitKey = options.rateLimitKey || "global";
  vehicleRateLimiter.check(rateLimitKey);

  const timeoutMs = Number(options.timeoutMs || process.env.UPSTREAM_TIMEOUT_MS || 15_000);
  const safeTimeout = Math.min(Math.max(Number(timeoutMs) || 15_000, 1_000), 60_000);

  logger.info(
    "service.lookup",
    redactForLog({
      registrationNumber: String(rawRc || "").toUpperCase(),
      provider: options.provider || getActiveProviderName(),
      timeoutMs: safeTimeout,
    }),
  );

  const data = await getVehicleDetails(rawRc, {
    timeoutMs: safeTimeout,
    provider: options.provider,
    debug: Boolean(options.debug),
  });

  const debugPayload = data._debug;
  if (data._debug) delete data._debug;

  logger.info("service.lookup.ok", {
    registrationNumber: data.registrationNumber,
    provider: data.meta?.provider,
    debug: Boolean(options.debug),
  });

  if (options.debug && debugPayload) {
    return { ok: true, data, debug: debugPayload };
  }
  return { ok: true, data };
}
