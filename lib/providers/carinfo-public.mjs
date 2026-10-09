import * as cheerio from "cheerio";
import { AppError } from "../errors.mjs";
import { fetchHtml } from "../http-client.mjs";
import { logger } from "../logger.mjs";
import {
  mapImportantDatesFromLabels,
  mapOtherInfoFromLabels,
  mapOwnershipFromLabels,
  normalizeVehicleData,
} from "../schema.mjs";
import { AVAILABILITY } from "./types.mjs";

const DATE_IN_TEXT = /(\d{1,2}-[A-Za-z]{3}-\d{4})/;
const DEFAULT_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 15_000);

function text($, selector) {
  const t = $(selector).first().text().replace(/\s+/g, " ").trim();
  return t || null;
}

function parseInsuranceFromNotice(notice) {
  if (!notice) return { expiryDate: null, status: "unknown", message: null };
  const match = notice.match(DATE_IN_TEXT);
  const expiryDate = match ? match[1] : null;
  const lower = notice.toLowerCase();
  let status = "unknown";
  if (lower.includes("expired")) status = "expired";
  else if (lower.includes("expiring")) status = "expiring";
  else if (expiryDate) status = "active";
  return { expiryDate, status, message: notice };
}

function sectionFields(detailItems) {
  return Object.fromEntries(detailItems.map((d) => [d.label, d.value]));
}

function extractExpandSections($) {
  const sections = [];
  $(".expand_component_expandComponentContainer__fCIDc").each((_, el) => {
    const $el = $(el);
    const title =
      $el.find(".expand_component_expandHeader__TAsoW p").first().text().trim() || null;
    const locked = $el.find('img[alt="lock icon"]').length > 0;
    const detailItems = [];
    $el.find(".expand_component_detailItem__V43eh").each((_, item) => {
      const label = $(item).find(".expand_component_itemText__cbigB").text().trim();
      const value = $(item).find(".expand_component_itemSubTitle__ElsYf").text().trim();
      if (label) detailItems.push({ label, value: value || null });
    });
    sections.push({ title, locked, fields: sectionFields(detailItems), detailItems });
  });
  return sections;
}

function pickSection(sections, titlePart) {
  return sections.find((s) => s.title?.toLowerCase().includes(titlePart.toLowerCase()));
}

function buildSourceUrl(rc) {
  return `https://www.carinfo.app/rc-details/${rc}`;
}

function collectPublicLabelValues($, sections) {
  const out = {};
  for (const section of sections) {
    if (section.locked) continue;
    for (const [label, value] of Object.entries(section.fields || {})) {
      if (value != null && value !== "") out[label] = value;
    }
  }
  // Also any open detail items not nested under a locked section container
  $(".expand_component_detailItem__V43eh").each((_, el) => {
    const $el = $(el);
    if ($el.closest(".expand_component_expandComponentContainer__fCIDc").find('img[alt="lock icon"]').length) {
      return;
    }
    const label = $el.find(".expand_component_itemText__cbigB").text().trim();
    const value = $el.find(".expand_component_itemSubTitle__ElsYf").text().trim();
    if (label && value) out[label] = value;
  });
  return out;
}

/**
 * Public HTML-only CarInfo scraper.
 * Fetches https://www.carinfo.app/rc-details/{RC} without login, cookies, or decryption.
 */
export const carinfoPublicProvider = {
  id: "carinfo-public",
  name: "CarInfo public HTML",

  async lookup(rc, { timeoutMs = DEFAULT_TIMEOUT_MS, debug = false } = {}) {
    const sourceUrl = buildSourceUrl(rc);
    const started = Date.now();

    logger.info("provider.lookup.start", { provider: this.id, rc, sourceUrl });

    let response;
    try {
      response = await fetchHtml(sourceUrl, { timeoutMs });
    } catch (err) {
      const code = err.code === "ECONNABORTED" || err.code === "ETIMEDOUT"
        ? "upstream_timeout"
        : "upstream_unreachable";
      logger.error("provider.lookup.network_error", {
        provider: this.id,
        rc,
        code,
        message: err.message,
      });
      throw new AppError(
        code === "upstream_timeout"
          ? "Upstream request timed out"
          : "Upstream request failed",
        { status: 502, code, details: { provider: this.id } },
      );
    }

    const durationMs = Date.now() - started;
    const { status, headers, data: html, attempts } = response;

    if (status >= 500) {
      throw new AppError("Upstream server error", {
        status: 502,
        code: "upstream_error",
        details: { provider: this.id, upstreamHttpStatus: status, attempts },
      });
    }

    if (status === 404) {
      throw new AppError("Vehicle page not found", {
        status: 404,
        code: "not_found",
        details: { provider: this.id, rc },
      });
    }

    if (status === 403 || status === 401) {
      throw new AppError("Upstream denied public access", {
        status: 502,
        code: "upstream_forbidden",
        details: { provider: this.id, upstreamHttpStatus: status },
      });
    }

    if (typeof html !== "string" || !html.includes("<")) {
      throw new AppError("Upstream response was not HTML", {
        status: 502,
        code: "invalid_upstream_response",
        details: { provider: this.id, upstreamHttpStatus: status },
      });
    }

    const $ = cheerio.load(html);
    const registrationNumber =
      text($, ".input_vehical_layout_numberPlateContainer__Ug78g p") || rc;
    const makeAndModel = text($, ".input_vehical_layout_vehicalModel__1ABTF");
    const ownerNameMasked = text($, ".input_vehical_layout_ownerName__NHkpi");
    const insuranceNotice = text($, ".input_vehical_layout_notification__PuC1p p");
    const insuranceParsed = parseInsuranceFromNotice(insuranceNotice);

    const sections = extractExpandSections($);
    const rtoSection = pickSection(sections, "rto");
    const ownershipSection = pickSection(sections, "ownership");
    const datesSection = pickSection(sections, "important dates");
    const otherSection = pickSection(sections, "other info");

    const rtoFields = { ...(rtoSection?.fields ?? {}) };
    if (!rtoFields.Number) {
      const publicLabels = collectPublicLabelValues($, sections);
      for (const key of ["Number", "Registered RTO", "State", "Website"]) {
        if (publicLabels[key] && !rtoFields[key]) rtoFields[key] = publicLabels[key];
      }
    }

    const ownershipAvailable =
      ownershipSection && !ownershipSection.locked && Object.keys(ownershipSection.fields).length > 0;
    const datesAvailable =
      datesSection && !datesSection.locked && Object.keys(datesSection.fields).length > 0;
    const otherAvailable =
      otherSection && !otherSection.locked && Object.keys(otherSection.fields).length > 0;

    const fetchedAt = new Date().toISOString();
    const data = normalizeVehicleData(
      {
        registrationNumber,
        makeAndModel,
        ownerNameMasked,
        insurance: {
          expiryDate: insuranceParsed.expiryDate,
          status: insuranceParsed.status,
        },
        rto: {
          code: rtoFields.Number ?? null,
          registeredOffice: rtoFields["Registered RTO"] ?? null,
          state: rtoFields.State ?? null,
          website: rtoFields.Website ?? null,
        },
        ownership: ownershipAvailable
          ? mapOwnershipFromLabels(ownershipSection.fields)
          : mapOwnershipFromLabels({}),
        importantDates: datesAvailable
          ? mapImportantDatesFromLabels(datesSection.fields)
          : mapImportantDatesFromLabels({}),
        otherInfo: otherAvailable
          ? mapOtherInfoFromLabels(otherSection.fields)
          : mapOtherInfoFromLabels({}),
      },
      { source: this.id, fetchedAt },
    );

    const availability = {
      ownership: ownershipAvailable ? AVAILABILITY.PUBLIC : AVAILABILITY.UNAVAILABLE,
      importantDates: datesAvailable ? AVAILABILITY.PUBLIC : AVAILABILITY.UNAVAILABLE,
      otherInfo: otherAvailable ? AVAILABILITY.PUBLIC : AVAILABILITY.UNAVAILABLE,
    };

    logger.info("provider.lookup.ok", {
      provider: this.id,
      rc,
      upstreamHttpStatus: status,
      durationMs,
      attempts,
      hasMakeModel: Boolean(makeAndModel),
    });

    const result = {
      ok: true,
      provider: this.id,
      data,
      availability,
      meta: {
        sourceUrl,
        fetchedAt,
        upstreamHttpStatus: status,
        contentType: headers["content-type"] ?? null,
        durationMs,
        attempts,
        notes: [
          "Public HTML only — no login, cookies, OTP, or payload decryption.",
          "Fields missing from public HTML are null.",
        ],
      },
    };

    if (debug) {
      result.debug = {
        htmlLength: html.length,
        insuranceMessage: insuranceParsed.message,
        publicLabels: collectPublicLabelValues($, sections),
        sectionTitles: sections.map((s) => ({
          title: s.title,
          locked: s.locked,
          fieldCount: Object.keys(s.fields || {}).length,
        })),
        hasNextDataScript: $("script#__NEXT_DATA__").length > 0,
      };
    }

    return result;
  },
};
