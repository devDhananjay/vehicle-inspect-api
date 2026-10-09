import { AppError } from "../errors.mjs";
import { logger } from "../logger.mjs";
import { normalizeVehicleData } from "../schema.mjs";
import { redactForLog } from "../redact.mjs";
import { AVAILABILITY } from "./types.mjs";

/**
 * Official licensed vehicle-data API adapter (stub).
 *
 * Env (never commit secrets):
 *   LICENSED_PROVIDER_BASE_URL
 *   LICENSED_PROVIDER_API_KEY
 *   optional: LICENSED_PROVIDER_AUTH_MODE=api_key|oauth_client_credentials
 *   optional OAuth: LICENSED_PROVIDER_OAUTH_TOKEN_URL, CLIENT_ID, CLIENT_SECRET, SCOPE
 *
 * Forbidden: Gmail login, OTP, browser cookies, CAPTCHA bypass, payload decryption.
 */
export function readLicensedProviderConfig() {
  return {
    authMode: (process.env.LICENSED_PROVIDER_AUTH_MODE || "api_key").toLowerCase(),
    baseUrl: (process.env.LICENSED_PROVIDER_BASE_URL || "").replace(/\/$/, "") || null,
    apiKeySet: Boolean(process.env.LICENSED_PROVIDER_API_KEY),
    oauth: {
      tokenUrl: process.env.LICENSED_PROVIDER_OAUTH_TOKEN_URL || null,
      clientIdSet: Boolean(process.env.LICENSED_PROVIDER_CLIENT_ID),
      clientSecretSet: Boolean(process.env.LICENSED_PROVIDER_CLIENT_SECRET),
      scope: process.env.LICENSED_PROVIDER_OAUTH_SCOPE || null,
    },
    timeoutMs: Number(
      process.env.LICENSED_PROVIDER_TIMEOUT_MS ||
        process.env.UPSTREAM_TIMEOUT_MS ||
        15_000,
    ),
  };
}

export function isLicensedProviderConfigured(config = readLicensedProviderConfig()) {
  if (!config.baseUrl) return false;
  if (config.authMode === "oauth_client_credentials") {
    return Boolean(
      config.oauth.tokenUrl && config.oauth.clientIdSet && config.oauth.clientSecretSet,
    );
  }
  return config.apiKeySet;
}

export function licensedConfigStatus() {
  const config = readLicensedProviderConfig();
  return {
    configured: isLicensedProviderConfigured(config),
    authMode: config.authMode,
    baseUrlSet: Boolean(config.baseUrl),
    apiKeySet: config.apiKeySet,
    oauthTokenUrlSet: Boolean(config.oauth.tokenUrl),
    oauthClientIdSet: config.oauth.clientIdSet,
    oauthClientSecretSet: config.oauth.clientSecretSet,
    timeoutMs: config.timeoutMs,
  };
}

/**
 * Map vendor JSON → complete schema. Use only with authorized API responses.
 */
export function mapLicensedApiPayload(vendorBody, fallbackRc = null, meta = {}) {
  const src = vendorBody && typeof vendorBody === "object" ? vendorBody : {};
  const root = src.data && typeof src.data === "object" ? src.data : src;

  return normalizeVehicleData(
    {
      registrationNumber:
        root.registrationNumber ?? root.rcNumber ?? root.vehicleNumber ?? fallbackRc,
      makeAndModel: root.makeAndModel ?? root.model ?? null,
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
      source: meta.source || "licensed-provider",
      fetchedAt: meta.fetchedAt || new Date().toISOString(),
    },
  );
}

export const licensedProvider = {
  id: "licensed-provider",
  name: "Licensed vehicle-data API (stub)",

  getStatus() {
    return licensedConfigStatus();
  },

  async lookup(rc, { timeoutMs, debug = false } = {}) {
    const config = readLicensedProviderConfig();
    const status = licensedConfigStatus();
    const effectiveTimeout = Number(timeoutMs || config.timeoutMs);

    logger.info("provider.lookup.start", {
      provider: this.id,
      rc,
      timeoutMs: effectiveTimeout,
      config: redactForLog(status),
    });

    if (!isLicensedProviderConfigured(config)) {
      throw new AppError(
        "licensed-provider is not configured. Set LICENSED_PROVIDER_BASE_URL and API key / OAuth env vars.",
        {
          status: 501,
          code: "provider_not_configured",
          details: {
            provider: this.id,
            config: status,
            availability: {
              ownership: AVAILABILITY.LICENSE_REQUIRED,
              importantDates: AVAILABILITY.LICENSE_REQUIRED,
              otherInfo: AVAILABILITY.LICENSE_REQUIRED,
            },
            // Empty complete schema so clients know the contract
            emptySchema: normalizeVehicleData(
              { registrationNumber: rc },
              { source: this.id, fetchedAt: new Date().toISOString() },
            ),
          },
        },
      );
    }

    logger.warn("provider.lookup.not_implemented", {
      provider: this.id,
      rc,
      authMode: config.authMode,
    });

    throw new AppError(
      "licensed-provider adapter is a stub. Implement official vendor HTTP/OAuth when licensed credentials are available.",
      {
        status: 501,
        code: "provider_not_implemented",
        details: {
          provider: this.id,
          authMode: config.authMode,
          nextSteps: [
            "Obtain licensed vendor API documentation",
            "Set LICENSED_PROVIDER_* environment variables",
            "Implement authorized HTTP calls (no cookies / no login automation)",
            "Map response with mapLicensedApiPayload()",
          ],
          ...(debug
            ? {
                debug: {
                  configStatus: status,
                  schema: normalizeVehicleData(
                    { registrationNumber: rc },
                    { source: this.id, fetchedAt: new Date().toISOString() },
                  ),
                },
              }
            : {}),
        },
      },
    );
  },
};
