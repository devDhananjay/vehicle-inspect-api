import { maskSecretPresent } from "../redact.mjs";

/**
 * Official API / OAuth configuration only (env vars).
 * Never reads Gmail passwords, browser cookies, OTPs, or session files.
 */
export function readAuthenticatedProviderConfig() {
  const authMode = (process.env.AUTHENTICATED_PROVIDER_AUTH_MODE || "api_key").toLowerCase();

  return {
    authMode,
    baseUrl: (process.env.AUTHENTICATED_PROVIDER_BASE_URL || "").replace(/\/$/, "") || null,
    apiKeyConfigured: maskSecretPresent(process.env.AUTHENTICATED_PROVIDER_API_KEY),
    oauth: {
      tokenUrl: process.env.AUTHENTICATED_PROVIDER_OAUTH_TOKEN_URL || null,
      clientIdConfigured: maskSecretPresent(process.env.AUTHENTICATED_PROVIDER_CLIENT_ID),
      clientSecretConfigured: maskSecretPresent(
        process.env.AUTHENTICATED_PROVIDER_CLIENT_SECRET,
      ),
      scope: process.env.AUTHENTICATED_PROVIDER_OAUTH_SCOPE || null,
    },
    timeoutMs: Number(
      process.env.AUTHENTICATED_PROVIDER_TIMEOUT_MS ||
        process.env.UPSTREAM_TIMEOUT_MS ||
        15_000,
    ),
  };
}

export function isAuthenticatedProviderConfigured(config = readAuthenticatedProviderConfig()) {
  if (!config.baseUrl) return false;
  if (config.authMode === "oauth_client_credentials") {
    return Boolean(
      config.oauth.tokenUrl &&
        config.oauth.clientIdConfigured &&
        config.oauth.clientSecretConfigured,
    );
  }
  // default: api_key
  return config.apiKeyConfigured;
}

/** Safe summary for /health and logs — never includes secret values. */
export function authenticatedConfigStatus() {
  const config = readAuthenticatedProviderConfig();
  return {
    configured: isAuthenticatedProviderConfigured(config),
    authMode: config.authMode,
    baseUrlSet: Boolean(config.baseUrl),
    apiKeySet: config.apiKeyConfigured,
    oauthTokenUrlSet: Boolean(config.oauth.tokenUrl),
    oauthClientIdSet: config.oauth.clientIdConfigured,
    oauthClientSecretSet: config.oauth.clientSecretConfigured,
    oauthScopeSet: Boolean(config.oauth.scope),
    timeoutMs: config.timeoutMs,
  };
}
