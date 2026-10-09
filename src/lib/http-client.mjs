import axios from "axios";
import { logger } from "./logger.mjs";

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GET HTML with timeout + limited retries. No cookies / auth headers.
 */
export async function fetchHtml(url, {
  timeoutMs = 15_000,
  maxRetries = Number(process.env.UPSTREAM_MAX_RETRIES || 2),
  userAgent = "Mozilla/5.0 (compatible; VehicleInspectAPI/1.3)",
} = {}) {
  return requestWithRetry({
    method: "GET",
    url,
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": userAgent,
    },
    timeoutMs,
    maxRetries,
  });
}

/**
 * Generic JSON/HTTP request with timeout + retries. Never logs Authorization.
 */
export async function requestWithRetry({
  method = "GET",
  url,
  headers = {},
  params,
  data,
  timeoutMs = 15_000,
  maxRetries = Number(process.env.UPSTREAM_MAX_RETRIES || 2),
} = {}) {
  let lastError = null;
  const attempts = Math.max(1, maxRetries + 1);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const started = Date.now();
    try {
      const response = await axios({
        method,
        url,
        headers,
        params,
        data,
        timeout: timeoutMs,
        validateStatus: () => true,
        maxRedirects: 5,
        withCredentials: false,
      });

      const durationMs = Date.now() - started;
      const status = response.status;

      if (RETRYABLE_STATUS.has(status) && attempt < attempts) {
        const backoffMs = 300 * attempt;
        logger.warn("http.retry", {
          url,
          method,
          attempt,
          status,
          backoffMs,
          durationMs,
        });
        await sleep(backoffMs);
        continue;
      }

      return {
        status,
        headers: response.headers,
        data: response.data,
        durationMs,
        attempts: attempt,
      };
    } catch (err) {
      lastError = err;
      const retryable =
        err.code === "ECONNABORTED" ||
        err.code === "ETIMEDOUT" ||
        err.code === "ECONNRESET" ||
        err.code === "ENOTFOUND" ||
        err.code === "EAI_AGAIN";

      if (retryable && attempt < attempts) {
        const backoffMs = 300 * attempt;
        logger.warn("http.retry_network", {
          url,
          method,
          attempt,
          code: err.code || null,
          message: err.message,
          backoffMs,
        });
        await sleep(backoffMs);
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("requestWithRetry failed");
}
