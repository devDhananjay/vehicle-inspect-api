import { AppError } from "../errors.mjs";
import { logger } from "../logger.mjs";
import { normalizeVehicleData } from "../schema.mjs";
import { redactForLog } from "../redact.mjs";
import {
  authenticatedConfigStatus,
  isAuthenticatedProviderConfigured,
  readAuthenticatedProviderConfig,
} from "./authenticated-config.mjs";
import { AVAILABILITY } from "./types.mjs";

/**
 * Maps an officially authorized vendor JSON body into the canonical schema.
 * Call this only with payloads returned by a documented vendor API.
 * Does not decrypt opaque/encrypted blobs.
 */
export function mapAuthorizedApiPayload(vendorBody, fallbackRc = null) {
  const src = vendorBody && typeof vendorBody === "object" ? vendorBody : {};
  const dataRoot = src.data && typeof src.data === "object" ? src.data : src;

  return normalizeVehicleData(
    {
      registrationNumber:
        dataRoot.registrationNumber ??
        dataRoot.rcNumber ??
        dataRoot.vehicleNumber ??
        fallbackRc,
      makeAndModel: dataRoot.makeAndModel ?? dataRoot.model ?? dataRoot.vehicleModel ?? null,
      ownerNameMasked: dataRoot.ownerNameMasked ?? dataRoot.ownerName ?? null,
      insurance: {
        expiryDate:
          dataRoot.insurance?.expiryDate ??
          dataRoot.insuranceExpiry ??
          dataRoot.insuranceUpto ??
          null,
        status: dataRoot.insurance?.status ?? dataRoot.insuranceStatus ?? "unknown",
      },
      rto: {
        code: dataRoot.rto?.code ?? dataRoot.rtoCode ?? null,
        registeredOffice: dataRoot.rto?.registeredOffice ?? dataRoot.rtoOffice ?? null,
        state: dataRoot.rto?.state ?? null,
        website: dataRoot.rto?.website ?? null,
      },
      ownership: dataRoot.ownership ?? {},
      importantDates: dataRoot.importantDates ?? {},
      otherInfo: dataRoot.otherInfo ?? {},
    },
    { source: "authenticated-provider", fetchedAt: new Date().toISOString() },
  );
}

/**
 * Stub provider for officially supported API / OAuth integrations only.
 *
 * Forbidden:
 * - Gmail / consumer login automation
 * - OTP, cookie, session, or refresh-token persistence
 * - CAPTCHA / paywall / encryption bypass
 *
 * Allowed (when vendor documents it):
 * - API key over HTTPS
 * - OAuth 2.0 client_credentials (server-to-server)
 */
export const authenticatedProvider = {
  id: "authenticated-provider",
  name: "Authenticated official API (stub)",

  getStatus() {
    return authenticatedConfigStatus();
  },

  async lookup(rc, { timeoutMs, debug = false } = {}) {
    const config = readAuthenticatedProviderConfig();
    const effectiveTimeout = Number(timeoutMs || config.timeoutMs);
    const status = authenticatedConfigStatus();

    logger.info("provider.lookup.start", {
      provider: this.id,
      rc,
      timeoutMs: effectiveTimeout,
      config: redactForLog(status),
    });

    if (!isAuthenticatedProviderConfigured(config)) {
      throw new AppError(
        "authenticated-provider is not configured. See AUTHENTICATED_PROVIDER_* env vars in README.",
        {
          status: 501,
          code: "provider_not_configured",
          details: {
            provider: this.id,
            config: status,
            availability: {
              ownership: AVAILABILITY.AUTH_REQUIRED,
              importantDates: AVAILABILITY.AUTH_REQUIRED,
              otherInfo: AVAILABILITY.AUTH_REQUIRED,
            },
          },
        },
      );
    }

    // Intentionally not implemented: wire vendor HTTP/OAuth here only after
    // you have a documented, licensed API. Do not scrape authenticated HTML.
    logger.warn("provider.lookup.not_implemented", {
      provider: this.id,
      rc,
      authMode: config.authMode,
      baseUrlSet: Boolean(config.baseUrl),
    });

    throw new AppError(
      "authenticated-provider adapter is a stub. Implement official vendor HTTP/OAuth calls when credentials are available.",
      {
        status: 501,
        code: "provider_not_implemented",
        details: {
          provider: this.id,
          authMode: config.authMode,
          nextSteps: [
            "Obtain vendor API docs + commercial license",
            "Set AUTHENTICATED_PROVIDER_* env vars (never commit secrets)",
            "Implement token fetch (oauth_client_credentials) or API-key header",
            "Map vendor JSON via mapAuthorizedApiPayload()",
          ],
          ...(debug
            ? {
                debug: {
                  note: "Debug contains no secrets",
                  configStatus: status,
                  emptyNormalizedShape: normalizeVehicleData({ registrationNumber: rc }),
                },
              }
            : {}),
        },
      },
    );
  },
};
