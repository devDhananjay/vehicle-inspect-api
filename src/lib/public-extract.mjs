/**
 * Thorough PUBLIC-only extraction from CarInfo RC HTML responses.
 *
 * Sources checked (unauthenticated HTTP body only):
 * 1. Raw HTML / expand sections
 * 2. __NEXT_DATA__
 * 3. JSON-LD
 * 4. application/json scripts
 * 5. Other inline scripts with serialized JSON
 * 6. pageProps / public hydration data
 * 7. Meta tags
 * 8. Publicly embedded vehicle sections
 *
 * Never decrypts protected payloads (e.g. CryptoJS "Salted__" / U2FsdGVkX1…).
 */

export const PUBLIC_UNAVAILABLE = "not_available_in_public_response";

/** Canonical field path → accepted public labels / keys (normalized). */
const FIELD_ALIASES = {
  "ownership.ownerName": [
    "Owner Name",
    "ownerName",
    "owner_name",
    "owner",
  ],
  "ownership.registeredRto": [
    "Registered RTO",
    "registeredRto",
    "registered_rto",
  ],
  "ownership.vehicleClass": [
    "Vehicle Class",
    "vehicleClass",
    "vehicle_class",
  ],
  "ownership.fuelType": ["Fuel Type", "fuelType", "fuel_type", "fuel"],
  "ownership.fuelNorms": ["Fuel Norms", "fuelNorms", "fuel_norms"],
  "importantDates.registrationDate": [
    "Registration Date",
    "registrationDate",
    "registration_date",
  ],
  "importantDates.fitnessUpto": ["Fitness Upto", "fitnessUpto", "fitness_upto"],
  "importantDates.vehicleAge": ["Vehicle Age", "vehicleAge", "vehicle_age"],
  "importantDates.pollutionUpto": [
    "Pollution Upto",
    "pollutionUpto",
    "pollution_upto",
  ],
  "importantDates.insuranceUpto": [
    "Insurance Upto",
    "insuranceUpto",
    "insurance_upto",
  ],
  "importantDates.insuranceExpiringIn": [
    "Insurance Expiring In",
    "insuranceExpiringIn",
    "insurance_expiring_in",
  ],
  "otherInfo.registrationNo": [
    "Registration No.",
    "Registration No",
    "registrationNo",
    "registration_no",
    "registrationNumber",
  ],
  "otherInfo.unloadedWeightKg": [
    "Unloaded Weight (Kg)",
    "Unloaded Weight",
    "unloadedWeight",
    "unloadedWeightKg",
    "unloaded_weight",
  ],
  "otherInfo.numberOfSeats": [
    "Number of Seats",
    "numberOfSeats",
    "number_of_seats",
    "seats",
  ],
  "otherInfo.rcStatus": ["RC Status", "rcStatus", "rc_status"],
  "rto.code": ["Number", "RTO Number", "rtoCode", "rto_code", "code"],
  "rto.registeredOffice": [
    "Registered RTO",
    "registeredOffice",
    "registered_office",
  ],
  "rto.state": ["State", "state"],
  "rto.website": ["Website", "website"],
  makeAndModel: [
    "Make And Model",
    "makeAndModel",
    "make_and_model",
    "model",
    "vehicleModel",
  ],
  ownerNameMasked: [
    "Owner Name Masked",
    "ownerNameMasked",
    "maskedOwnerName",
    "owner",
  ],
  "insurance.expiryDate": [
    "Insurance Expiry",
    "insuranceExpiryDate",
    "expiryDate",
  ],
};

const ALIAS_TO_PATH = new Map();
for (const [path, aliases] of Object.entries(FIELD_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_TO_PATH.set(canon(alias), path);
  }
}

const PROTECTED_KEYS = new Set([
  "xdataprops",
  "xdata",
  "encrypted",
  "encrypteddata",
  "ciphertext",
  "cipher",
  "payload",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "cookie",
  "cookies",
  "password",
  "otp",
  "apikey",
]);

function canon(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function isEncryptedPublicBlob(value) {
  if (typeof value !== "string") return false;
  const v = value.trim();
  // CryptoJS OpenSSL salted ciphertext ("Salted__" → base64 U2FsdGVkX1)
  if (v.startsWith("U2FsdGVkX1")) return true;
  // Opaque long base64 blobs without whitespace — do not return contents
  if (v.length >= 200 && /^[A-Za-z0-9+/=_-]+$/.test(v)) return true;
  return false;
}

function isPlaceholder(value) {
  if (value == null) return true;
  if (typeof value === "number" && Number.isFinite(value)) return false;
  const s = String(value).replace(/\s+/g, " ").trim();
  if (!s) return true;
  if (/^[•·*]+$/.test(s)) return true;
  if (/^[-–—]+$/.test(s)) return true;
  if (/^(n\/?a|null|undefined|unknown|login|sign in|locked)$/i.test(s)) return true;
  return false;
}

function tryParseJson(text) {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** Best-effort extraction of JSON object/array literals from inline script text. */
function extractJsonLiteralsFromScript(text) {
  const out = [];
  if (typeof text !== "string" || text.length < 2) return out;
  const whole = tryParseJson(text);
  if (whole) {
    out.push(whole);
    return out;
  }

  // Match common Next/hydration assignments without executing script.
  const patterns = [
    /__NEXT_DATA__\s*=\s*(\{[\s\S]*?\})\s*(?:;|$)/,
    /pageProps\s*[:=]\s*(\{[\s\S]*?\})\s*(?:;|,|\n)/,
    /webSections\s*[:=]\s*(\[[\s\S]*?\])\s*(?:;|,|\n)/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const parsed = tryParseJson(m[1]);
    if (parsed) out.push(parsed);
  }

  // Scan for balanced {...} / [...] that mention vehicle-ish keys (size-capped).
  const needle =
    /"(?:title|subtitle|heading|messages|webSections|pageProps|Fuel Type|Owner Name|Vehicle Class|fitnessUpto|fuelType)"/;
  if (!needle.test(text)) return out;

  const maxScan = Math.min(text.length, 400_000);
  for (let i = 0; i < maxScan; i++) {
    const ch = text[i];
    if (ch !== "{" && ch !== "[") continue;
    const close = ch === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < Math.min(i + 80_000, maxScan); j++) {
      const c = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === ch) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          const slice = text.slice(i, j + 1);
          if (needle.test(slice)) {
            const parsed = tryParseJson(slice);
            if (parsed) out.push(parsed);
          }
          i = j;
          break;
        }
      }
    }
  }
  return out;
}

function setField(bag, path, value, source, diagnostics) {
  if (isEncryptedPublicBlob(value)) {
    diagnostics.encryptedPayloadPresent = true;
    return;
  }
  if (isPlaceholder(value)) return;
  const normalized = typeof value === "number" ? String(value) : String(value).replace(/\s+/g, " ").trim();
  if (!normalized) return;
  if (bag[path] == null) {
    bag[path] = normalized;
    if (!diagnostics.extractedPublicFields.includes(path)) {
      diagnostics.extractedPublicFields.push(path);
    }
    if (source && !diagnostics.sourcesFound.includes(source)) {
      diagnostics.sourcesFound.push(source);
    }
  }
}

function mapLabelValue(label, value, bag, source, diagnostics) {
  if (typeof label !== "string") return;
  const path = ALIAS_TO_PATH.get(canon(label));
  if (!path) return;
  // Avoid mapping generic "Number" outside RTO context unless source says rto
  if (path === "rto.code" && source && !/rto|html-section|meta/i.test(source)) {
    // still allow when label is clearly RTO Number
    if (canon(label) === "number" && !/rto/i.test(source)) return;
  }
  setField(bag, path, value, source, diagnostics);
}

function walkPublicJson(node, bag, diagnostics, source, depth = 0, sectionHint = null) {
  if (node == null || depth > 48) return;

  if (typeof node === "string") {
    if (isEncryptedPublicBlob(node)) {
      diagnostics.encryptedPayloadPresent = true;
      return;
    }
    const nested = tryParseJson(node);
    if (nested) walkPublicJson(nested, bag, diagnostics, source, depth + 1, sectionHint);
    return;
  }

  if (typeof node === "number" || typeof node === "boolean") return;

  if (Array.isArray(node)) {
    for (const item of node) {
      walkPublicJson(item, bag, diagnostics, source, depth + 1, sectionHint);
    }
    return;
  }

  if (typeof node !== "object") return;

  const headingTitle =
    typeof node.heading === "string"
      ? node.heading
      : typeof node.heading?.title === "string"
        ? node.heading.title
        : typeof node.sectionTitle === "string"
          ? node.sectionTitle
          : null;
  const nextHint = headingTitle || sectionHint;

  // title / subtitle (and common variants)
  const title =
    (typeof node.title === "string" && node.title) ||
    (typeof node.label === "string" && node.label) ||
    (typeof node.name === "string" && node.name) ||
    (typeof node.text === "string" && typeof node.value !== "undefined" ? node.text : null) ||
    headingTitle;

  const subtitleCandidates = [
    node.subtitle,
    node.subTitle,
    node.value,
    node.description,
    typeof node.text === "string" && node.title ? node.text : null,
  ];
  for (const sub of subtitleCandidates) {
    if (sub != null && typeof sub !== "object") {
      if (title) mapLabelValue(title, sub, bag, source, diagnostics);
      break;
    }
  }

  // elements / sections / messages / webSections
  for (const key of [
    "messages",
    "elements",
    "sections",
    "webSections",
    "items",
    "detailItems",
    "fields",
    "data",
  ]) {
    if (node[key] != null) {
      walkPublicJson(node[key], bag, diagnostics, source, depth + 1, nextHint);
    }
  }

  for (const [key, value] of Object.entries(node)) {
    const ck = canon(key);
    if (PROTECTED_KEYS.has(ck)) {
      if (typeof value === "string" && isEncryptedPublicBlob(value)) {
        diagnostics.encryptedPayloadPresent = true;
      } else if (typeof value === "string" && value.length > 40) {
        diagnostics.encryptedPayloadPresent = true;
      }
      // Never recurse into / expose protected payloads
      continue;
    }

    if (isEncryptedPublicBlob(value)) {
      diagnostics.encryptedPayloadPresent = true;
      continue;
    }

    const path = ALIAS_TO_PATH.get(ck);
    if (path && (typeof value === "string" || typeof value === "number")) {
      // Disambiguate Registered RTO: ownership vs rto.registeredOffice by section hint
      if (ck === "registeredrto" || key === "Registered RTO") {
        if (nextHint && /ownership/i.test(nextHint)) {
          setField(bag, "ownership.registeredRto", value, source, diagnostics);
        } else if (nextHint && /rto/i.test(nextHint)) {
          setField(bag, "rto.registeredOffice", value, source, diagnostics);
        } else {
          setField(bag, "rto.registeredOffice", value, source, diagnostics);
          setField(bag, "ownership.registeredRto", value, source, diagnostics);
        }
      } else {
        setField(bag, path, value, source, diagnostics);
      }
    }

    if (value != null && typeof value === "object") {
      walkPublicJson(value, bag, diagnostics, source, depth + 1, nextHint);
    } else if (typeof value === "string") {
      const nested = tryParseJson(value);
      if (nested) walkPublicJson(nested, bag, diagnostics, source, depth + 1, nextHint);
    }
  }
}

function text($, selector) {
  const t = $(selector).first().text().replace(/\s+/g, " ").trim();
  return t || null;
}

function extractExpandSections($) {
  const sections = [];
  $(".expand_component_expandComponentContainer__fCIDc").each((_, el) => {
    const $el = $(el);
    const title =
      $el.find(".expand_component_expandHeader__TAsoW p").first().text().trim() ||
      $el.find("p").first().text().trim() ||
      null;
    const locked = $el.find('img[alt="lock icon"]').length > 0;
    const detailItems = [];
    $el.find(".expand_component_detailItem__V43eh").each((_, item) => {
      const label = $(item).find(".expand_component_itemText__cbigB").text().trim();
      const value = $(item).find(".expand_component_itemSubTitle__ElsYf").text().trim();
      if (label) detailItems.push({ label, value: value || null });
    });
    // Generic fallbacks inside section
    if (detailItems.length === 0) {
      $el.find("li, .detail-item, [class*='detailItem']").each((_, item) => {
        const $item = $(item);
        const label =
          $item.find("[class*='itemText'], [class*='label'], dt").first().text().trim() ||
          null;
        const value =
          $item.find("[class*='itemSubTitle'], [class*='value'], [class*='subTitle'], dd").first().text().trim() ||
          null;
        if (label) detailItems.push({ label, value });
      });
    }
    sections.push({ title, locked, detailItems });
  });
  return sections;
}

const KNOWN_LABEL_PATTERN =
  /(Owner Name|Registered RTO|Vehicle Class|Fuel Type|Fuel Norms|Registration Date|Fitness Upto|Vehicle Age|Pollution Upto|Insurance Upto|Insurance Expiring In|Registration No\.?|Unloaded Weight(?:\s*\(Kg\))?|Number of Seats|RC Status|Make And Model|RTO Number|Website|State)\s*[:\-]?\s*([^\n\r|]{1,120})/gi;

function extractLabelValuePairsFromText(rawText, bag, source, diagnostics) {
  if (!rawText) return;
  const textNorm = String(rawText).replace(/\s+/g, " ");
  KNOWN_LABEL_PATTERN.lastIndex = 0;
  let match;
  while ((match = KNOWN_LABEL_PATTERN.exec(textNorm)) !== null) {
    const label = match[1];
    let value = (match[2] || "").trim();
    // Stop value at next known label if glued
    value = value.replace(
      /\s+(Owner Name|Registered RTO|Vehicle Class|Fuel Type|Fuel Norms|Registration Date|Fitness Upto|Vehicle Age|Pollution Upto|Insurance Upto|Insurance Expiring In|Registration No\.?|Unloaded Weight|Number of Seats|RC Status)\b.*$/i,
      "",
    ).trim();
    if (!isPlaceholder(value)) {
      mapLabelValue(label, value, bag, source, diagnostics);
    }
  }
}

function extractGenericDomPairs($, root, bag, diagnostics, source) {
  // dt/dd
  $(root)
    .find("dt")
    .each((_, el) => {
      const label = $(el).text().replace(/\s+/g, " ").trim();
      const value = $(el).next("dd").text().replace(/\s+/g, " ").trim();
      if (label && !isPlaceholder(value)) {
        mapLabelValue(label, value, bag, source, diagnostics);
      }
    });
  // th/td pairs in tables
  $(root)
    .find("tr")
    .each((_, el) => {
      const cells = $(el).find("th, td");
      if (cells.length >= 2) {
        const label = $(cells[0]).text().replace(/\s+/g, " ").trim();
        const value = $(cells[1]).text().replace(/\s+/g, " ").trim();
        if (label && !isPlaceholder(value)) {
          mapLabelValue(label, value, bag, source, diagnostics);
        }
      }
    });
}

function extractFromHtmlDom($, bag, diagnostics) {
  const heroRc = text($, ".input_vehical_layout_numberPlateContainer__Ug78g p");
  const makeAndModel = text($, ".input_vehical_layout_vehicalModel__1ABTF");
  const ownerNameMasked = text($, ".input_vehical_layout_ownerName__NHkpi");
  const insuranceNotice = text($, ".input_vehical_layout_notification__PuC1p p");

  if (heroRc) {
    setField(bag, "registrationNumber", heroRc, "html-hero", diagnostics);
    setField(bag, "otherInfo.registrationNo", heroRc, "html-hero", diagnostics);
  }
  if (makeAndModel) setField(bag, "makeAndModel", makeAndModel, "html-hero", diagnostics);
  if (ownerNameMasked) {
    setField(bag, "ownerNameMasked", ownerNameMasked, "html-hero", diagnostics);
    // Same masked owner string is public on the unauthenticated page
    setField(bag, "ownership.ownerName", ownerNameMasked, "html-hero", diagnostics);
  }
  if (insuranceNotice) {
    setField(bag, "insurance.notice", insuranceNotice, "html-hero", diagnostics);
    const dateMatch = insuranceNotice.match(/(\d{1,2}-[A-Za-z]{3}-\d{4})/);
    if (dateMatch) {
      setField(bag, "insurance.expiryDate", dateMatch[1], "html-hero", diagnostics);
      setField(bag, "importantDates.insuranceUpto", dateMatch[1], "html-hero", diagnostics);
    }
    const lower = insuranceNotice.toLowerCase();
    let status = "unknown";
    if (lower.includes("expired")) status = "expired";
    else if (lower.includes("expiring")) status = "expiring";
    else if (dateMatch) status = "active";
    setField(bag, "insurance.status", status, "html-hero", diagnostics);
    if (status === "expired") {
      setField(bag, "importantDates.insuranceExpiringIn", "Expired", "html-hero", diagnostics);
    }
  }

  const sections = extractExpandSections($);
  for (const section of sections) {
    if (section.title) {
      diagnostics.publicSectionTitles.push({
        title: section.title,
        locked: Boolean(section.locked),
        fieldCount: section.detailItems.filter((d) => !isPlaceholder(d.value)).length,
      });
    }
    if (section.locked) continue;
    if (section.title && /rto|ownership|important dates|other info/i.test(section.title)) {
      if (!diagnostics.sourcesFound.includes("public RC section")) {
        diagnostics.sourcesFound.push("public RC section");
      }
    }
    for (const { label, value } of section.detailItems) {
      if (section.title && /ownership/i.test(section.title) && canon(label) === "registeredrto") {
        setField(bag, "ownership.registeredRto", value, "html-section", diagnostics);
      } else if (section.title && /rto/i.test(section.title) && canon(label) === "registeredrto") {
        setField(bag, "rto.registeredOffice", value, "html-section", diagnostics);
        // Public RTO "Registered RTO" value is available unauthenticated
        setField(bag, "ownership.registeredRto", value, "html-section", diagnostics);
      } else if (section.title && /rto/i.test(section.title) && canon(label) === "number") {
        setField(bag, "rto.code", value, "html-section", diagnostics);
      } else {
        mapLabelValue(label, value, bag, "html-section", diagnostics);
      }
    }
  }

  // Generic public DOM pairs (outside locked expand containers)
  $("body")
    .find(".expand_component_detailItem__V43eh, [class*='detailItem'], dl, table")
    .each((_, el) => {
      const $el = $(el);
      if (
        $el
          .closest(".expand_component_expandComponentContainer__fCIDc")
          .find('img[alt="lock icon"]').length
      ) {
        return;
      }
      extractGenericDomPairs($, el, bag, diagnostics, "html-dom");
      const label = $el.find("[class*='itemText'], [class*='label']").first().text().trim();
      const value = $el
        .find("[class*='itemSubTitle'], [class*='value'], [class*='subTitle']")
        .first()
        .text()
        .trim();
      if (label && !isPlaceholder(value)) {
        mapLabelValue(label, value, bag, "html-dom", diagnostics);
      }
    });

  // Meta tags
  $("meta").each((_, el) => {
    const name = $(el).attr("property") || $(el).attr("name") || $(el).attr("itemprop");
    const content = $(el).attr("content");
    if (!name || isPlaceholder(content)) return;
    mapLabelValue(name, content, bag, "meta", diagnostics);
  });

  // Raw body text label:value pairs (public text only; locked sections usually have empty values)
  extractLabelValuePairsFromText($("body").text(), bag, "html-text", diagnostics);

  return sections;
}

/**
 * Parse publicly delivered HTML and return normalized field bag + diagnostics.
 * Never returns cookies, tokens, API keys, or encrypted payload contents.
 */
export function extractFromPublicHtml(html, { cheerio, registrationNumber } = {}) {
  if (!cheerio) {
    throw new Error("cheerio is required");
  }

  const diagnostics = {
    htmlLength: typeof html === "string" ? html.length : 0,
    nextDataFound: false,
    pagePropsFound: false,
    jsonLdFound: false,
    jsonLdCount: 0,
    applicationJsonScripts: 0,
    inlineScriptJsonCount: 0,
    publicSectionTitles: [],
    extractedPublicFields: [],
    sourcesFound: [],
    encryptedPayloadPresent: false,
  };

  const bag = Object.create(null);
  if (registrationNumber) {
    bag.registrationNumber = registrationNumber;
  }

  if (typeof html !== "string" || !html.includes("<")) {
    return { bag, diagnostics, sections: [] };
  }

  const $ = cheerio.load(html);
  const sections = extractFromHtmlDom($, bag, diagnostics);

  // __NEXT_DATA__ + pageProps / public hydration
  const nextEl = $("script#__NEXT_DATA__");
  if (nextEl.length) {
    diagnostics.nextDataFound = true;
    loggerSource(diagnostics, "NEXT_DATA found");
    const parsed = tryParseJson(nextEl.html() || "");
    if (parsed) {
      walkPublicJson(parsed, bag, diagnostics, "NEXT_DATA");
      const pageProps = parsed?.props?.pageProps;
      if (pageProps && typeof pageProps === "object") {
        diagnostics.pagePropsFound = true;
        loggerSource(diagnostics, "pageProps found");
        walkPublicJson(pageProps, bag, diagnostics, "pageProps");
        if (typeof pageProps.rc === "string" && !isPlaceholder(pageProps.rc)) {
          setField(bag, "registrationNumber", pageProps.rc, "pageProps", diagnostics);
          setField(bag, "otherInfo.registrationNo", pageProps.rc, "pageProps", diagnostics);
        }
        if (pageProps.initialState) {
          loggerSource(diagnostics, "public Next.js hydration/initialState found");
          walkPublicJson(pageProps.initialState, bag, diagnostics, "hydration");
        }
      }
    }
  }

  // JSON-LD
  $("script[type='application/ld+json']").each((_, el) => {
    diagnostics.jsonLdFound = true;
    diagnostics.jsonLdCount += 1;
    loggerSource(diagnostics, "JSON-LD found");
    const parsed = tryParseJson($(el).html() || "");
    if (parsed) walkPublicJson(parsed, bag, diagnostics, "JSON-LD");
  });

  // application/json scripts
  $("script[type='application/json']").each((_, el) => {
    diagnostics.applicationJsonScripts += 1;
    loggerSource(diagnostics, "application/json scripts found");
    if ($(el).attr("id") === "__NEXT_DATA__") return;
    const parsed = tryParseJson($(el).html() || "");
    if (parsed) walkPublicJson(parsed, bag, diagnostics, "application/json");
  });

  // Other inline scripts containing serialized JSON / public objects
  $("script:not([src])").each((_, el) => {
    const id = $(el).attr("id");
    const type = ($(el).attr("type") || "").toLowerCase();
    if (id === "__NEXT_DATA__") return;
    if (type === "application/ld+json" || type === "application/json") return;
    const body = $(el).html() || "";
    if (!body || body.length < 8) return;
    if (
      !/webSections|pageProps|Fuel Type|Owner Name|title|subtitle|vehicleClass|fitnessUpto|__NEXT_DATA__|registrationNumber/i.test(
        body,
      )
    ) {
      return;
    }
    const literals = extractJsonLiteralsFromScript(body);
    if (literals.length) {
      diagnostics.inlineScriptJsonCount += literals.length;
      loggerSource(diagnostics, "inline script JSON found");
      for (const lit of literals) {
        walkPublicJson(lit, bag, diagnostics, "inline-script");
      }
    }
  });

  // Apply public cross-maps only from values already present in the unauthenticated bag
  applyPublicCrossMaps(bag, diagnostics);

  return { bag, diagnostics, sections };
}

/**
 * Mirror values that are already present in the public response into related schema fields.
 * Does not invent values that were never found.
 */
function applyPublicCrossMaps(bag, diagnostics) {
  if (bag.registrationNumber && !bag["otherInfo.registrationNo"]) {
    setField(
      bag,
      "otherInfo.registrationNo",
      bag.registrationNumber,
      "public-crossmap",
      diagnostics,
    );
  }
  if (bag.ownerNameMasked && !bag["ownership.ownerName"]) {
    setField(
      bag,
      "ownership.ownerName",
      bag.ownerNameMasked,
      "public-crossmap",
      diagnostics,
    );
  }
  if (bag["rto.registeredOffice"] && !bag["ownership.registeredRto"]) {
    setField(
      bag,
      "ownership.registeredRto",
      bag["rto.registeredOffice"],
      "public-crossmap",
      diagnostics,
    );
  }
  if (bag["insurance.expiryDate"] && !bag["importantDates.insuranceUpto"]) {
    setField(
      bag,
      "importantDates.insuranceUpto",
      bag["insurance.expiryDate"],
      "public-crossmap",
      diagnostics,
    );
  }
  if (
    bag["insurance.status"] === "expired" &&
    !bag["importantDates.insuranceExpiringIn"]
  ) {
    setField(
      bag,
      "importantDates.insuranceExpiringIn",
      "Expired",
      "public-crossmap",
      diagnostics,
    );
  }
}

function loggerSource(diagnostics, label) {
  if (!diagnostics.sourcesFound.includes(label)) {
    diagnostics.sourcesFound.push(label);
  }
}

function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function setPath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Convert flat bag paths into the nested vehicle partial used by normalizeVehicleData.
 */
export function bagToVehiclePartial(bag) {
  const partial = {
    registrationNumber: bag.registrationNumber ?? null,
    makeAndModel: bag.makeAndModel ?? null,
    ownerNameMasked: bag.ownerNameMasked ?? null,
    insurance: {
      expiryDate: bag["insurance.expiryDate"] ?? null,
      status: bag["insurance.status"] ?? "unknown",
    },
    rto: {
      code: bag["rto.code"] ?? null,
      registeredOffice: bag["rto.registeredOffice"] ?? null,
      state: bag["rto.state"] ?? null,
      website: bag["rto.website"] ?? null,
    },
    ownership: {
      ownerName: bag["ownership.ownerName"] ?? null,
      registeredRto: bag["ownership.registeredRto"] ?? null,
      vehicleClass: bag["ownership.vehicleClass"] ?? null,
      fuelType: bag["ownership.fuelType"] ?? null,
      fuelNorms: bag["ownership.fuelNorms"] ?? null,
    },
    importantDates: {
      registrationDate: bag["importantDates.registrationDate"] ?? null,
      fitnessUpto: bag["importantDates.fitnessUpto"] ?? null,
      vehicleAge: bag["importantDates.vehicleAge"] ?? null,
      pollutionUpto: bag["importantDates.pollutionUpto"] ?? null,
      insuranceUpto: bag["importantDates.insuranceUpto"] ?? null,
      insuranceExpiringIn: bag["importantDates.insuranceExpiringIn"] ?? null,
    },
    otherInfo: {
      registrationNo: bag["otherInfo.registrationNo"] ?? null,
      unloadedWeightKg: bag["otherInfo.unloadedWeightKg"] ?? null,
      numberOfSeats: bag["otherInfo.numberOfSeats"] ?? null,
      rcStatus: bag["otherInfo.rcStatus"] ?? null,
    },
  };
  return partial;
}

/** Safe debug payload — never includes secrets or encrypted blobs. */
export function buildPublicDebug(diagnostics) {
  return {
    htmlLength: diagnostics.htmlLength,
    nextDataFound: diagnostics.nextDataFound,
    pagePropsFound: Boolean(diagnostics.pagePropsFound),
    jsonLdFound: diagnostics.jsonLdFound,
    jsonLdCount: diagnostics.jsonLdCount || 0,
    applicationJsonScripts: diagnostics.applicationJsonScripts,
    jsonScriptsCount: diagnostics.applicationJsonScripts,
    inlineScriptJsonCount: diagnostics.inlineScriptJsonCount || 0,
    publicSectionTitles: diagnostics.publicSectionTitles,
    extractedPublicFields: [...diagnostics.extractedPublicFields],
    extractedFieldNames: [...diagnostics.extractedPublicFields],
    sourcesFound: [...diagnostics.sourcesFound],
    encryptedPayloadPresent: Boolean(diagnostics.encryptedPayloadPresent),
  };
}

export { getPath, setPath, canon as canonicalizeLabel };
