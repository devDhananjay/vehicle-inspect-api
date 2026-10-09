import { AppError } from "../lib/errors.mjs";
import { requestWithRetry } from "../lib/http-client.mjs";
import { logger } from "../lib/logger.mjs";
import { normalizeVehicleData } from "../lib/schema.mjs";
import { validateRc } from "../lib/validate.mjs";

const PROVIDER_ID = "licensed";

/**
 * Licensed provider configuration (env only — never hardcode secrets).
 *
 * Required for live calls:
 *   LICENSED_PROVIDER_BASE_URL
 *   LICENSED_PROVIDER_API_KEY
 *
 * Optional — fill from vendor docs before enabling production calls:
 *   LICENSED_PROVIDER_REQUEST_PATH   e.g. /v1/vehicle  (required for HTTP call)
 *   LICENSED_PROVIDER_HTTP_METHOD    GET | POST (default GET)
 *   LICENSED_PROVIDER_RC_PARAM       query/body field name (default registrationNumber)
 *   LICENSED_PROVIDER_AUTH_HEADER    header name (default Authorization)
 *   LICENSED_PROVIDER_AUTH_SCHEME    Bearer | raw | X-API-Key style via header name
 *
 * Do not invent vendor-specific paths here. Set REQUEST_PATH from official docs.
 */
export function readLicensedConfig() {
  return {
    baseUrl: (process.env.LICENSED_PROVIDER_BASE_URL || "").replace(/\/$/, "") || null,
    apiKey: process.env.LICENSED_PROVIDER_API_KEY || null,
    requestPath: process.env.LICENSED_PROVIDER_REQUEST_PATH || "",
    method: (process.env.LICENSED_PROVIDER_HTTP_METHOD || "GET").toUpperCase(),
    rcParam: process.env.LICENSED_PROVIDER_RC_PARAM || "registrationNumber",
    authHeader: process.env.LICENSED_PROVIDER_AUTH_HEADER || "Authorization",
    authScheme: (process.env.LICENSED_PROVIDER_AUTH_SCHEME || "Bearer").trim(),
    timeoutMs: Number(
      process.env.LICENSED_PROVIDER_TIMEOUT_MS || process.env.UPSTREAM_TIMEOUT_MS || 15_000,
    ),
    maxRetries: Number(process.env.UPSTREAM_MAX_RETRIES || 2),
  };
}

export function isLicensedConfigured(config = readLicensedConfig()) {
  return Boolean(config.baseUrl && config.apiKey);
}

/** True when env has enough to attempt an HTTP call without inventing a path. */
export function isLicensedReadyForHttp(config = readLicensedConfig()) {
  return isLicensedConfigured(config) && Boolean(config.requestPath);
}

export function licensedStatus() {
  const config = readLicensedConfig();
  return {
    configured: isLicensedConfigured(config),
    requestPathConfigured: Boolean(config.requestPath),
    readyForHttp: isLicensedReadyForHttp(config),
    method: config.method,
    timeoutMs: config.timeoutMs,
  };
}

function buildAuthHeaderValue(config) {
  const key = config.apiKey;
  if (!key) return null;
  if (!config.authScheme || config.authScheme.toLowerCase() === "raw") return key;
  if (config.authScheme.toLowerCase() === "x-api-key") return key;
  return `${config.authScheme} ${key}`;
}

/**
 * Map vendor JSON → normalized schema.
 * Adjust field paths here when vendor documentation is available.
 * Does not invent missing values.
 */
export function mapLicensedResponse(vendorBody, fallbackRc, meta = {}) {
  const src = vendorBody && typeof vendorBody === "object" ? vendorBody : {};
  const root = src.data && typeof src.data === "object" ? src.data : src;

  // --- VENDOR MAPPING (fill from official API docs) ---
  return normalizeVehicleData(
    {
      registrationNumber:
        root.registrationNumber ?? root.rcNumber ?? root.vehicleNumber ?? fallbackRc,
      makeAndModel: root.makeAndModel ?? root.model ?? root.vehicleModel ?? null,
      ownerNameMasked: root.ownerNameMasked ?? root.ownerName ?? null,
      insurance: {
        expiryDate: root.insurance?.expiryDate ?? root.insuranceExpiry ?? null,
        status: root.insurance?.status ?? root.insuranceStatus ?? "unknown",
      },
      rto: {
        code: root.rto?.code ?? root.rtoCode ?? null,
        registeredOffice: root.rto?.registeredOffice ?? root.rtoOffice ?? null,
        state: root.rto?.state ?? null,
        website: root.rto?.website ?? null,
      },
      ownership: {
        ownerName: root.ownership?.ownerName ?? null,
        registeredRto: root.ownership?.registeredRto ?? null,
        vehicleClass: root.ownership?.vehicleClass ?? null,
        fuelType: root.ownership?.fuelType ?? null,
        fuelNorms: root.ownership?.fuelNorms ?? null,
      },
      importantDates: {
        registrationDate: root.importantDates?.registrationDate ?? null,
        fitnessUpto: root.importantDates?.fitnessUpto ?? null,
        vehicleAge: root.importantDates?.vehicleAge ?? null,
        pollutionUpto: root.importantDates?.pollutionUpto ?? null,
        insuranceUpto: root.importantDates?.insuranceUpto ?? null,
        insuranceExpiringIn: root.importantDates?.insuranceExpiringIn ?? null,
      },
      otherInfo: {
        registrationNo: root.otherInfo?.registrationNo ?? null,
        unloadedWeightKg: root.otherInfo?.unloadedWeightKg ?? null,
        numberOfSeats: root.otherInfo?.numberOfSeats ?? null,
        rcStatus: root.otherInfo?.rcStatus ?? null,
      },
    },
    {
      source: meta.source || "licensed-api",
      fetchedAt: meta.fetchedAt || new Date().toISOString(),
      provider: PROVIDER_ID,
    },
  );
}

function mapUpstreamStatus(status) {
  if (status === 401 || status === 403) {
    return new AppError("Vehicle data provider unavailable", {
      status: 502,
      code: "PROVIDER_ERROR",
      details: { provider: PROVIDER_ID, upstreamHttpStatus: status },
    });
  }
  if (status === 404) {
    return new AppError("Vehicle not found", {
      status: 404,
      code: "NOT_FOUND",
      details: { provider: PROVIDER_ID },
    });
  }
  if (status === 429) {
    return new AppError("Vehicle data provider rate limited", {
      status: 429,
      code: "RATE_LIMITED",
      details: { provider: PROVIDER_ID },
    });
  }
  if (status >= 500) {
    return new AppError("Vehicle data provider unavailable", {
      status: 502,
      code: "PROVIDER_ERROR",
      details: { provider: PROVIDER_ID, upstreamHttpStatus: status },
    });
  }
  return new AppError("Vehicle data provider unavailable", {
    status: 502,
    code: "PROVIDER_ERROR",
    details: { provider: PROVIDER_ID, upstreamHttpStatus: status },
  });
}

/**
 * Official licensed API adapter.
 * Requires LICENSED_PROVIDER_REQUEST_PATH from vendor docs before HTTP is attempted.
 */
export async function getVehicleDetails(registrationNumber, options = {}) {
  const rc = validateRc(registrationNumber);
  const config = options._config || readLicensedConfig();
  const timeoutMs = Number(options.timeoutMs || config.timeoutMs);

  logger.info("provider.getVehicleDetails.start", {
    provider: PROVIDER_ID,
    rc,
    configured: isLicensedConfigured(config),
    requestPathConfigured: Boolean(config.requestPath),
  });

  if (!isLicensedConfigured(config)) {
    throw new AppError(
      "Licensed provider is not configured. Set LICENSED_PROVIDER_BASE_URL and LICENSED_PROVIDER_API_KEY.",
      {
        status: 501,
        code: "PROVIDER_NOT_CONFIGURED",
        details: { provider: PROVIDER_ID, configured: false },
      },
    );
  }

  if (!config.requestPath) {
    throw new AppError(
      "Licensed provider request path is not set. Set LICENSED_PROVIDER_REQUEST_PATH from the vendor API docs.",
      {
        status: 501,
        code: "PROVIDER_NOT_CONFIGURED",
        details: {
          provider: PROVIDER_ID,
          configured: true,
          requestPathConfigured: false,
        },
      },
    );
  }

  const url = `${config.baseUrl}${config.requestPath.startsWith("/") ? "" : "/"}${config.requestPath}`;
  const headers = {
    Accept: "application/json",
    [config.authHeader]: buildAuthHeaderValue(config),
  };

  // --- VENDOR REQUEST SHAPE (adjust from official docs) ---
  const params = config.method === "GET" ? { [config.rcParam]: rc } : undefined;
  const body = config.method === "POST" ? { [config.rcParam]: rc } : undefined;

  const requestFn = options._request || requestWithRetry;

  let response;
  try {
    response = await requestFn({
      method: config.method,
      url,
      headers,
      params,
      data: body,
      timeoutMs,
      maxRetries: config.maxRetries,
    });
  } catch (err) {
    const timedOut = err.code === "ECONNABORTED" || err.code === "ETIMEDOUT";
    logger.error("provider.getVehicleDetails.network_error", {
      provider: PROVIDER_ID,
      rc,
      timedOut,
      code: err.code || null,
      message: err.message,
    });
    throw new AppError(
      timedOut ? "Vehicle data provider timed out" : "Vehicle data provider unavailable",
      {
        status: 502,
        code: "PROVIDER_ERROR",
        details: { provider: PROVIDER_ID, reason: timedOut ? "timeout" : "network" },
      },
    );
  }

  if (response.status < 200 || response.status >= 300) {
    throw mapUpstreamStatus(response.status);
  }

  const fetchedAt = new Date().toISOString();
  const data = mapLicensedResponse(response.data, rc, {
    source: "licensed-api",
    fetchedAt,
  });

  logger.info("provider.getVehicleDetails.ok", {
    provider: PROVIDER_ID,
    rc,
    upstreamHttpStatus: response.status,
    durationMs: response.durationMs,
    attempts: response.attempts,
  });

  return data;
}

export const licensedProvider = {
  id: PROVIDER_ID,
  name: "Licensed vehicle-data API",
  getVehicleDetails,
  isConfigured: isLicensedConfigured,
  getStatus: licensedStatus,
};
