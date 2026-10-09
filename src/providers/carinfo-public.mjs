import * as cheerio from "cheerio";
import { AppError } from "../lib/errors.mjs";
import { fetchHtml } from "../lib/http-client.mjs";
import { logger } from "../lib/logger.mjs";
import {
  bagToVehiclePartial,
  buildPublicDebug,
  extractFromPublicHtml,
} from "../lib/public-extract.mjs";
import { normalizeVehicleData } from "../lib/schema.mjs";
import { validateRc } from "../lib/validate.mjs";

const DEFAULT_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 15_000);
const PROVIDER_ID = "carinfo-public";

function buildSourceUrl(rc) {
  return `https://www.carinfo.app/rc-details/${rc}`;
}

function logPublicSources(diagnostics, rc) {
  for (const src of diagnostics.sourcesFound) {
    logger.info("provider.public_source", { provider: PROVIDER_ID, rc, source: src });
  }
  if (diagnostics.encryptedPayloadPresent) {
    logger.info("provider.public_source", {
      provider: PROVIDER_ID,
      rc,
      source: "encrypted payload present (not decrypted)",
    });
  }
}

/**
 * Public HTML-only scraper with multi-source extraction.
 * Does not login, use cookies, OTP, or decrypt protected payloads.
 */
export async function getVehicleDetails(registrationNumber, options = {}) {
  const rc = validateRc(registrationNumber);
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const debug = Boolean(options.debug);
  const sourceUrl = buildSourceUrl(rc);
  const started = Date.now();

  logger.info("provider.getVehicleDetails.start", {
    provider: PROVIDER_ID,
    rc,
    sourceUrl,
    debug,
  });

  let response;
  try {
    response = await fetchHtml(sourceUrl, { timeoutMs });
  } catch (err) {
    logger.error("provider.getVehicleDetails.network_error", {
      provider: PROVIDER_ID,
      rc,
      code: err.code || null,
      message: err.message,
    });
    throw new AppError("Vehicle data provider unavailable", {
      status: 502,
      code: "PROVIDER_ERROR",
      details: { provider: PROVIDER_ID, reason: "network" },
    });
  }

  const { status, data: html, attempts } = response;
  const durationMs = Date.now() - started;

  if (status >= 500) {
    throw new AppError("Vehicle data provider unavailable", {
      status: 502,
      code: "PROVIDER_ERROR",
      details: { provider: PROVIDER_ID, upstreamHttpStatus: status, attempts },
    });
  }
  if (status === 404) {
    throw new AppError("Vehicle not found", {
      status: 404,
      code: "NOT_FOUND",
      details: { provider: PROVIDER_ID, rc },
    });
  }
  if (status === 401 || status === 403) {
    throw new AppError("Vehicle data provider unavailable", {
      status: 502,
      code: "PROVIDER_ERROR",
      details: { provider: PROVIDER_ID, upstreamHttpStatus: status },
    });
  }
  if (typeof html !== "string" || !html.includes("<")) {
    throw new AppError("Vehicle data provider unavailable", {
      status: 502,
      code: "PROVIDER_ERROR",
      details: { provider: PROVIDER_ID, reason: "invalid_html" },
    });
  }

  const { bag, diagnostics } = extractFromPublicHtml(html, {
    cheerio,
    registrationNumber: rc,
  });
  logPublicSources(diagnostics, rc);

  const partial = bagToVehiclePartial(bag);
  if (!partial.registrationNumber) partial.registrationNumber = rc;

  const fetchedAt = new Date().toISOString();
  const data = normalizeVehicleData(partial, {
    source: "carinfo-public-html",
    fetchedAt,
    provider: PROVIDER_ID,
  });

  logger.info("provider.getVehicleDetails.ok", {
    provider: PROVIDER_ID,
    rc,
    upstreamHttpStatus: status,
    durationMs,
    attempts,
    extractedPublicFields: diagnostics.extractedPublicFields.length,
    encryptedPayloadPresent: diagnostics.encryptedPayloadPresent,
  });

  if (debug) {
    data._debug = buildPublicDebug(diagnostics);
  }

  return data;
}

export const carinfoPublicProvider = {
  id: PROVIDER_ID,
  name: "CarInfo public HTML",
  getVehicleDetails,
  isConfigured() {
    return true;
  },
};
