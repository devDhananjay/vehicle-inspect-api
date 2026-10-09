/**
 * Officially authorized CarInfo / CarInfo Business API adapter.
 *
 * STUB STATUS: Endpoint paths, auth header names, and response field paths
 * MUST be filled from official CarInfo API documentation before production use.
 * No undocumented private endpoints, no cookies, no consumer login, no decryption.
 *
 * Env (use only what official docs require):
 *   CARINFO_API_BASE_URL
 *   CARINFO_VEHICLE_ENDPOINT
 *   CARINFO_REQUEST_METHOD          GET | POST (default GET)
 *   CARINFO_RC_PARAM                query/body field (default registrationNumber)
 *   CARINFO_API_KEY
 *   CARINFO_CLIENT_ID
 *   CARINFO_CLIENT_SECRET
 *   CARINFO_ACCESS_TOKEN
 *   CARINFO_TOKEN_URL               optional — only if docs specify OAuth token endpoint
 *   CARINFO_AUTH_HEADER             default Authorization
 *   CARINFO_AUTH_SCHEME             Bearer | raw | ApiKey
 */

import { AppError } from "../lib/errors.mjs";
import { requestWithRetry } from "../lib/http-client.mjs";
import { logger } from "../lib/logger.mjs";
import { redactForLog } from "../lib/redact.mjs";
import { normalizeVehicleData } from "../lib/schema.mjs";
import { validateRc } from "../lib/validate.mjs";

const PROVIDER_ID = "carinfo-authorized";

export function readCarInfoAuthorizedConfig() {
  return {
    baseUrl: (process.env.CARINFO_API_BASE_URL || "").replace(/\/$/, "") || null,
    vehicleEndpoint: (process.env.CARINFO_VEHICLE_ENDPOINT || "").trim(),
    method: (process.env.CARINFO_REQUEST_METHOD || "GET").toUpperCase(),
    rcParam: process.env.CARINFO_RC_PARAM || "registrationNumber",
    apiKey: process.env.CARINFO_API_KEY || null,
    clientId: process.env.CARINFO_CLIENT_ID || null,
    clientSecret: process.env.CARINFO_CLIENT_SECRET || null,
    accessToken: process.env.CARINFO_ACCESS_TOKEN || null,
    tokenUrl: (process.env.CARINFO_TOKEN_URL || "").trim() || null,
    authHeader: process.env.CARINFO_AUTH_HEADER || "Authorization",
    authScheme: (process.env.CARINFO_AUTH_SCHEME || "Bearer").trim(),
    timeoutMs: Number(
      process.env.CARINFO_TIMEOUT_MS || process.env.UPSTREAM_TIMEOUT_MS || 15_000,
    ),
    maxRetries: Number(process.env.UPSTREAM_MAX_RETRIES || 2),
  };
}

function hasAuthMaterial(config) {
  return Boolean(
    config.apiKey ||
      config.accessToken ||
      (config.clientId && config.clientSecret),
  );
}

export function isCarInfoAuthorizedConfigured(config = readCarInfoAuthorizedConfig()) {
  return Boolean(config.baseUrl && hasAuthMaterial(config));
}

export function isCarInfoAuthorizedReadyForHttp(
  config = readCarInfoAuthorizedConfig(),
) {
  return (
    isCarInfoAuthorizedConfigured(config) && Boolean(config.vehicleEndpoint)
  );
}

export function carInfoAuthorizedStatus() {
  const config = readCarInfoAuthorizedConfig();
  return {
    configured: isCarInfoAuthorizedConfigured(config),
    vehicleEndpointConfigured: Boolean(config.vehicleEndpoint),
    readyForHttp: isCarInfoAuthorizedReadyForHttp(config),
    oauthTokenUrlConfigured: Boolean(config.tokenUrl),
    method: config.method,
    timeoutMs: config.timeoutMs,
  };
}

function pick(...values) {
  for (const v of values) {
    if (v == null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return typeof v === "string" ? v.trim() : v;
  }
  return null;
}

/**
 * Map official CarInfo authorized API JSON → normalized schema.
 * Field paths are placeholders — adjust ONLY from official API docs.
 * Never fabricates values.
 */
export function normalizeCarInfoAuthorizedResponse(response, fallbackRc, meta = {}) {
  const src = response && typeof response === "object" ? response : {};
  const root =
    src.data && typeof src.data === "object"
      ? src.data
      : src.result && typeof src.result === "object"
        ? src.result
        : src.vehicle && typeof src.vehicle === "object"
          ? src.vehicle
          : src;

  const ownership = root.ownership && typeof root.ownership === "object" ? root.ownership : {};
  const importantDates =
    root.importantDates && typeof root.importantDates === "object"
      ? root.importantDates
      : root.dates && typeof root.dates === "object"
        ? root.dates
        : {};
  const otherInfo =
    root.otherInfo && typeof root.otherInfo === "object" ? root.otherInfo : {};
  const insurance =
    root.insurance && typeof root.insurance === "object" ? root.insurance : {};
  const rto = root.rto && typeof root.rto === "object" ? root.rto : {};

  // --- OFFICIAL DOCS MAPPING (adjust keys when documentation arrives) ---
  return normalizeVehicleData(
    {
      registrationNumber: pick(
        root.registrationNumber,
        root.registrationNo,
        root.rcNumber,
        root.vehicleNumber,
        fallbackRc,
      ),
      makeAndModel: pick(root.makeAndModel, root.model, root.vehicleModel, root.makeModel),
      ownerNameMasked: pick(
        root.ownerNameMasked,
        root.maskedOwnerName,
        ownership.ownerNameMasked,
      ),
      insurance: {
        expiryDate: pick(
          insurance.expiryDate,
          root.insuranceExpiry,
          importantDates.insuranceUpto,
        ),
        status: pick(insurance.status, root.insuranceStatus) || "unknown",
      },
      rto: {
        code: pick(rto.code, rto.number, root.rtoCode),
        registeredOffice: pick(rto.registeredOffice, rto.office, root.rtoOffice),
        state: pick(rto.state, root.state),
        website: pick(rto.website, root.rtoWebsite),
      },
      ownership: {
        ownerName: pick(ownership.ownerName, root.ownerName, root.owner),
        registeredRto: pick(
          ownership.registeredRto,
          ownership.rto,
          root.registeredRto,
        ),
        vehicleClass: pick(ownership.vehicleClass, root.vehicleClass),
        fuelType: pick(ownership.fuelType, root.fuelType, root.fuel),
        fuelNorms: pick(ownership.fuelNorms, root.fuelNorms),
      },
      importantDates: {
        registrationDate: pick(
          importantDates.registrationDate,
          root.registrationDate,
        ),
        fitnessUpto: pick(importantDates.fitnessUpto, root.fitnessUpto),
        vehicleAge: pick(importantDates.vehicleAge, root.vehicleAge),
        pollutionUpto: pick(importantDates.pollutionUpto, root.pollutionUpto),
        insuranceUpto: pick(importantDates.insuranceUpto, root.insuranceUpto),
        insuranceExpiringIn: pick(
          importantDates.insuranceExpiringIn,
          root.insuranceExpiringIn,
        ),
      },
      otherInfo: {
        registrationNo: pick(
          otherInfo.registrationNo,
          otherInfo.registrationNumber,
          root.registrationNo,
        ),
        unloadedWeightKg: pick(
          otherInfo.unloadedWeightKg,
          otherInfo.unloadedWeight,
          root.unloadedWeightKg,
          root.unloadedWeight,
        ),
        numberOfSeats: pick(
          otherInfo.numberOfSeats,
          otherInfo.seats,
          root.numberOfSeats,
        ),
        rcStatus: pick(otherInfo.rcStatus, root.rcStatus),
      },
    },
    {
      source: meta.source || "carinfo-authorized-api",
      fetchedAt: meta.fetchedAt || new Date().toISOString(),
      provider: PROVIDER_ID,
    },
  );
}

function fieldAvailability(data) {
  const check = (obj, prefix) =>
    Object.entries(obj || {}).map(([k, v]) => ({
      field: `${prefix}.${k}`,
      available: v != null,
    }));
  return [
    { field: "makeAndModel", available: data.makeAndModel != null },
    { field: "ownerNameMasked", available: data.ownerNameMasked != null },
    ...check(data.insurance, "insurance"),
    ...check(data.rto, "rto"),
    ...check(data.ownership, "ownership"),
    ...check(data.importantDates, "importantDates"),
    ...check(data.otherInfo, "otherInfo"),
  ];
}

function buildAuthHeaderValue(tokenOrKey, scheme) {
  if (!tokenOrKey) return null;
  const s = (scheme || "Bearer").toLowerCase();
  if (s === "raw" || s === "apikey" || s === "api-key" || s === "x-api-key") {
    return tokenOrKey;
  }
  return `${scheme} ${tokenOrKey}`;
}

/**
 * Optional OAuth2 client_credentials fetch — ONLY when CARINFO_TOKEN_URL is set
 * from official documentation. Does not invent a token host.
 */
async function resolveAccessToken(config, requestFn) {
  if (config.accessToken) return config.accessToken;
  if (config.apiKey && !config.tokenUrl) return null; // API-key mode
  if (!config.tokenUrl) return null;
  if (!config.clientId || !config.clientSecret) {
    throw new AppError(
      "CarInfo OAuth requires CARINFO_CLIENT_ID and CARINFO_CLIENT_SECRET (from official docs).",
      {
        status: 501,
        code: "PROVIDER_NOT_CONFIGURED",
        details: { provider: PROVIDER_ID, oauth: true },
      },
    );
  }

  logger.info("provider.oauth.token_request", {
    provider: PROVIDER_ID,
    tokenUrlConfigured: true,
  });

  const response = await requestFn({
    method: "POST",
    url: config.tokenUrl,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    data: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }).toString(),
    timeoutMs: config.timeoutMs,
    maxRetries: 1,
  });

  if (response.status < 200 || response.status >= 300) {
    logger.warn("provider.oauth.token_failed", {
      provider: PROVIDER_ID,
      upstreamHttpStatus: response.status,
    });
    throw new AppError("Vehicle data provider unavailable", {
      status: 502,
      code: "PROVIDER_UNAVAILABLE",
      details: { provider: PROVIDER_ID, reason: "oauth_token_failed" },
    });
  }

  const token =
    response.data?.access_token ||
    response.data?.accessToken ||
    response.data?.token ||
    null;
  if (!token) {
    throw new AppError("Vehicle data provider unavailable", {
      status: 502,
      code: "PROVIDER_UNAVAILABLE",
      details: { provider: PROVIDER_ID, reason: "oauth_token_missing" },
    });
  }
  return token;
}

function mapUpstreamStatus(status) {
  if (status === 401 || status === 403) {
    return new AppError("Vehicle data provider unavailable", {
      status: 502,
      code: "PROVIDER_UNAVAILABLE",
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
  if (status === 408) {
    return new AppError("Vehicle data provider timed out", {
      status: 504,
      code: "PROVIDER_UNAVAILABLE",
      details: { provider: PROVIDER_ID, upstreamHttpStatus: 408 },
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
      code: "PROVIDER_UNAVAILABLE",
      details: { provider: PROVIDER_ID, upstreamHttpStatus: status },
    });
  }
  return new AppError("Vehicle data provider unavailable", {
    status: 502,
    code: "PROVIDER_UNAVAILABLE",
    details: { provider: PROVIDER_ID, upstreamHttpStatus: status },
  });
}

export async function getVehicleDetails(registrationNumber, options = {}) {
  const rc = validateRc(registrationNumber);
  const config = options._config || readCarInfoAuthorizedConfig();
  const timeoutMs = Number(options.timeoutMs || config.timeoutMs);
  const debug = Boolean(options.debug);
  const requestFn = options._request || requestWithRetry;

  logger.info(
    "provider.getVehicleDetails.start",
    redactForLog({
      provider: PROVIDER_ID,
      rc,
      configured: isCarInfoAuthorizedConfigured(config),
      vehicleEndpointConfigured: Boolean(config.vehicleEndpoint),
      debug,
    }),
  );

  if (!isCarInfoAuthorizedConfigured(config)) {
    throw new AppError(
      "CarInfo authorized provider is not configured. Set CARINFO_API_BASE_URL and an official auth credential (CARINFO_API_KEY or CARINFO_ACCESS_TOKEN or CLIENT_ID/SECRET).",
      {
        status: 501,
        code: "PROVIDER_NOT_CONFIGURED",
        details: { provider: PROVIDER_ID, configured: false },
      },
    );
  }

  if (!config.vehicleEndpoint) {
    throw new AppError(
      "CarInfo vehicle endpoint is not set. Set CARINFO_VEHICLE_ENDPOINT from official API documentation.",
      {
        status: 501,
        code: "PROVIDER_NOT_CONFIGURED",
        details: {
          provider: PROVIDER_ID,
          configured: true,
          vehicleEndpointConfigured: false,
        },
      },
    );
  }

  let bearer = null;
  try {
    bearer = await resolveAccessToken(config, requestFn);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("Vehicle data provider unavailable", {
      status: 502,
      code: "PROVIDER_UNAVAILABLE",
      details: { provider: PROVIDER_ID, reason: "oauth_network" },
    });
  }

  const credential = bearer || config.apiKey || config.accessToken;
  const headers = {
    Accept: "application/json",
    [config.authHeader]: buildAuthHeaderValue(credential, config.authScheme),
  };

  const path = config.vehicleEndpoint.startsWith("/")
    ? config.vehicleEndpoint
    : `/${config.vehicleEndpoint}`;
  const url = `${config.baseUrl}${path}`;

  // --- OFFICIAL REQUEST SHAPE (adjust from docs; do not invent paths) ---
  const params = config.method === "GET" ? { [config.rcParam]: rc } : undefined;
  const body = config.method === "POST" ? { [config.rcParam]: rc } : undefined;

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
        status: timedOut ? 504 : 502,
        code: "PROVIDER_UNAVAILABLE",
        details: { provider: PROVIDER_ID, reason: timedOut ? "timeout" : "network" },
      },
    );
  }

  if (response.status < 200 || response.status >= 300) {
    logger.warn("provider.getVehicleDetails.upstream_error", {
      provider: PROVIDER_ID,
      rc,
      upstreamHttpStatus: response.status,
      durationMs: response.durationMs,
    });
    throw mapUpstreamStatus(response.status);
  }

  if (response.data == null || typeof response.data !== "object") {
    throw new AppError("Vehicle data provider unavailable", {
      status: 502,
      code: "PROVIDER_UNAVAILABLE",
      details: { provider: PROVIDER_ID, reason: "malformed_response" },
    });
  }

  const fetchedAt = new Date().toISOString();
  const data = normalizeCarInfoAuthorizedResponse(response.data, rc, {
    source: "carinfo-authorized-api",
    fetchedAt,
  });

  logger.info("provider.getVehicleDetails.ok", {
    provider: PROVIDER_ID,
    rc,
    upstreamHttpStatus: response.status,
    durationMs: response.durationMs,
    attempts: response.attempts,
  });

  if (debug) {
    data._debug = {
      provider: PROVIDER_ID,
      upstreamHttpStatus: response.status,
      durationMs: response.durationMs,
      attempts: response.attempts,
      fieldAvailability: fieldAvailability(data),
      mappedSections: ["ownership", "importantDates", "otherInfo", "insurance", "rto"],
    };
  }

  return data;
}

export const carinfoAuthorizedProvider = {
  id: PROVIDER_ID,
  name: "CarInfo authorized / Business API",
  getVehicleDetails,
  isConfigured: isCarInfoAuthorizedConfigured,
  getStatus: carInfoAuthorizedStatus,
};
