import { AppError } from "../lib/errors.mjs";
import { logger } from "../lib/logger.mjs";
import {
  carinfoAuthorizedProvider,
  isCarInfoAuthorizedConfigured,
  carInfoAuthorizedStatus,
} from "./carinfo-authorized.mjs";
import { carinfoPublicProvider } from "./carinfo-public.mjs";
import {
  isLicensedConfigured,
  licensedProvider,
  licensedStatus,
} from "./licensed-provider.mjs";

/**
 * Provider registry.
 * VEHICLE_PROVIDER = carinfo-public | carinfo-authorized | licensed | fallback
 */
const providers = {
  "carinfo-public": carinfoPublicProvider,
  "carinfo-authorized": carinfoAuthorizedProvider,
  licensed: licensedProvider,
  "licensed-provider": licensedProvider,
};

export function getActiveProviderName() {
  return (process.env.VEHICLE_PROVIDER || "carinfo-public").toLowerCase();
}

export function getHealthProviders() {
  return {
    "carinfo-public": true,
    "carinfo-authorized": {
      configured: isCarInfoAuthorizedConfigured(),
    },
    licensed: isLicensedConfigured(),
  };
}

export function getProviderStatus() {
  return {
    "carinfo-public": { configured: true },
    "carinfo-authorized": carInfoAuthorizedStatus(),
    licensed: { configured: isLicensedConfigured(), ...licensedStatus() },
  };
}

/**
 * Resolve and call getVehicleDetails for the active selection strategy.
 */
export async function getVehicleDetails(registrationNumber, options = {}) {
  const mode = (options.provider || getActiveProviderName()).toLowerCase();

  if (mode === "fallback") {
    return getVehicleDetailsWithFallback(registrationNumber, options);
  }

  const provider = providers[mode];
  if (!provider) {
    throw new AppError(`Unknown provider: ${mode}`, {
      status: 400,
      code: "UNKNOWN_PROVIDER",
      details: {
        available: [
          "carinfo-public",
          "carinfo-authorized",
          "licensed",
          "fallback",
        ],
      },
    });
  }

  return provider.getVehicleDetails(registrationNumber, options);
}

/**
 * fallback: try carinfo-authorized → on failure use carinfo-public.
 */
async function getVehicleDetailsWithFallback(registrationNumber, options = {}) {
  logger.info("provider.fallback.try_authorized", {});
  try {
    const data = await carinfoAuthorizedProvider.getVehicleDetails(
      registrationNumber,
      options,
    );
    data.meta = {
      ...data.meta,
      provider: "carinfo-authorized",
      source: data.meta?.source || "carinfo-authorized-api",
      fallbackUsed: false,
    };
    return data;
  } catch (err) {
    logger.warn("provider.fallback.authorized_failed", {
      code: err.code || null,
      message: err.message,
    });
    const data = await carinfoPublicProvider.getVehicleDetails(
      registrationNumber,
      options,
    );
    data.meta = {
      ...data.meta,
      provider: "carinfo-public",
      source: "carinfo-public-html",
      fallbackUsed: true,
      authorizedErrorCode: err.code || "PROVIDER_UNAVAILABLE",
    };
    return data;
  }
}

export {
  carinfoPublicProvider,
  carinfoAuthorizedProvider,
  licensedProvider,
};
