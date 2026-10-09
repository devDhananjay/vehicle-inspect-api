/**
 * Vehicle data provider contract.
 *
 * Every provider must implement:
 *   - id: string
 *   - name: string
 *   - async lookup(rc: string, options?: { timeoutMs?: number }) => ProviderResult
 *
 * ProviderResult:
 * {
 *   ok: boolean,
 *   provider: string,
 *   data: NormalizedVehicleData | null,  // from schema.normalizeVehicleData
 *   availability: {
 *     ownership: "public" | "unavailable" | "provider_license_required" | "official_auth_required",
 *     importantDates: ...,
 *     otherInfo: ...,
 *   },
 *   meta: {
 *     sourceUrl?: string,
 *     fetchedAt: string,
 *     upstreamHttpStatus?: number,
 *     durationMs?: number,
 *   },
 *   error?: { code: string, message: string },
 *   debug?: object,  // only when explicitly requested; never secrets
 * }
 *
 * Rules:
 * - Do not decrypt protected payloads.
 * - Do not bypass login, CAPTCHA, or bot protection.
 * - Do not store passwords, OTPs, session cookies, or refresh tokens.
 * - Do not automate Gmail / consumer account login.
 * - Authenticated providers may only use documented API keys or OAuth.
 * - Leave ownership / importantDates / otherInfo as null when not available.
 */

export const AVAILABILITY = {
  PUBLIC: "public",
  UNAVAILABLE: "unavailable",
  LICENSE_REQUIRED: "provider_license_required",
  AUTH_REQUIRED: "official_auth_required",
};
