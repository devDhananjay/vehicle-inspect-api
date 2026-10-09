import { AppError } from "../errors.mjs";
import { AVAILABILITY } from "./types.mjs";

/**
 * Placeholder for an officially licensed vehicle-data API.
 *
 * To enable later:
 * 1. Set VEHICLE_PROVIDER=licensed
 * 2. Set LICENSED_PROVIDER_BASE_URL and LICENSED_PROVIDER_API_KEY
 * 3. Implement HTTP calls to the licensed vendor (no scraping / no cookie storage).
 */
export const licensedStubProvider = {
  id: "licensed",
  name: "Licensed vehicle-data provider (stub)",

  async lookup(_rc) {
    const configured = Boolean(
      process.env.LICENSED_PROVIDER_BASE_URL && process.env.LICENSED_PROVIDER_API_KEY,
    );

    if (!configured) {
      throw new AppError(
        "Licensed provider is not configured. Set LICENSED_PROVIDER_BASE_URL and LICENSED_PROVIDER_API_KEY.",
        {
          status: 501,
          code: "provider_not_configured",
          details: {
            provider: this.id,
            availability: {
              ownership: AVAILABILITY.LICENSE_REQUIRED,
              importantDates: AVAILABILITY.LICENSE_REQUIRED,
              otherInfo: AVAILABILITY.LICENSE_REQUIRED,
            },
          },
        },
      );
    }

    throw new AppError(
      "Licensed provider adapter not implemented yet. Plug in the vendor SDK/HTTP client here.",
      {
        status: 501,
        code: "provider_not_implemented",
        details: { provider: this.id },
      },
    );
  },
};
