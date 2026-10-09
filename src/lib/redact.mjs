/** Exact-ish secret field names — avoid matching flags like apiKeySet. */
const SECRET_KEY =
  /^(password|passwd|secret|token|access[_-]?token|refresh[_-]?token|refresh|cookie|cookies|set-cookie|otp|authorization|api[_-]?key|x-api-key|client[_-]?secret|clientsecret|client[_-]?id)$/i;

/** Strip secret-looking fields before logging. Never persist the return value as auth. */
export function redactForLog(value, depth = 0) {
  if (value == null || depth > 4) return value;
  if (typeof value === "string") {
    if (value.length > 24 && /^[A-Za-z0-9._\-+/=]{24,}$/.test(value)) {
      return `[redacted:${value.length}chars]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactForLog(v, depth + 1));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redactForLog(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function maskSecretPresent(value) {
  if (!value) return false;
  return true;
}
