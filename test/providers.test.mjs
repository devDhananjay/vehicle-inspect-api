import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as cheerio from "cheerio";
import { AppError } from "../src/lib/errors.mjs";
import {
  bagToVehiclePartial,
  buildPublicDebug,
  extractFromPublicHtml,
  isEncryptedPublicBlob,
} from "../src/lib/public-extract.mjs";
import { validateRc } from "../src/lib/validate.mjs";
import {
  getVehicleDetails as licensedGet,
  mapLicensedResponse,
} from "../src/providers/licensed-provider.mjs";
import { getVehicleDetails as publicGet } from "../src/providers/carinfo-public.mjs";

const readyConfig = {
  baseUrl: "https://api.example.com",
  apiKey: "secret-key-do-not-log",
  requestPath: "/v1/vehicle",
  method: "GET",
  rcParam: "registrationNumber",
  authHeader: "Authorization",
  authScheme: "Bearer",
  timeoutMs: 1000,
  maxRetries: 0,
};

describe("validateRc", () => {
  it("accepts UP26AQ8005", () => {
    assert.equal(validateRc("UP26AQ8005"), "UP26AQ8005");
  });

  it("accepts DL8CBG8852", () => {
    assert.equal(validateRc("dl8cbg8852"), "DL8CBG8852");
  });

  it("rejects invalid registration number", () => {
    assert.throws(() => validateRc("BAD"), (err) => err.code === "INVALID_RC");
  });
});

describe("mapLicensedResponse", () => {
  it("normalizes vendor payload with nulls for missing fields", () => {
    const data = mapLicensedResponse(
      { registrationNumber: "UP26AQ8005", makeAndModel: "X", ownership: { fuelType: "DIESEL" } },
      "UP26AQ8005",
    );
    assert.equal(data.ownership.fuelType, "DIESEL");
    assert.equal(data.ownership.vehicleClass, null);
    assert.equal(data.meta.provider, "licensed");
    assert.equal(data.meta.unavailableFields, undefined);
  });
});

describe("licensed-provider", () => {
  it("missing configuration → PROVIDER_NOT_CONFIGURED", async () => {
    await assert.rejects(
      () =>
        licensedGet("UP26AQ8005", {
          _config: {
            ...readyConfig,
            baseUrl: null,
            apiKey: null,
            requestPath: "",
          },
        }),
      (err) => err.code === "PROVIDER_NOT_CONFIGURED" && err.status === 501,
    );
  });

  it("configured but no request path → PROVIDER_NOT_CONFIGURED", async () => {
    await assert.rejects(
      () =>
        licensedGet("UP26AQ8005", {
          _config: { ...readyConfig, requestPath: "" },
        }),
      (err) => err.code === "PROVIDER_NOT_CONFIGURED",
    );
  });

  it("upstream 401 → PROVIDER_ERROR", async () => {
    await assert.rejects(
      () =>
        licensedGet("UP26AQ8005", {
          _config: readyConfig,
          _request: async () => ({
            status: 401,
            data: {},
            headers: {},
            durationMs: 1,
            attempts: 1,
          }),
        }),
      (err) => err instanceof AppError && err.code === "PROVIDER_ERROR",
    );
  });

  it("upstream 429 → RATE_LIMITED", async () => {
    await assert.rejects(
      () =>
        licensedGet("UP26AQ8005", {
          _config: readyConfig,
          _request: async () => ({
            status: 429,
            data: {},
            headers: {},
            durationMs: 1,
            attempts: 1,
          }),
        }),
      (err) => err.code === "RATE_LIMITED" && err.status === 429,
    );
  });

  it("upstream 500 → PROVIDER_ERROR", async () => {
    await assert.rejects(
      () =>
        licensedGet("UP26AQ8005", {
          _config: readyConfig,
          _request: async () => ({
            status: 500,
            data: {},
            headers: {},
            durationMs: 1,
            attempts: 1,
          }),
        }),
      (err) => err.code === "PROVIDER_ERROR",
    );
  });

  it("timeout → PROVIDER_ERROR", async () => {
    await assert.rejects(
      () =>
        licensedGet("UP26AQ8005", {
          _config: readyConfig,
          _request: async () => {
            const err = new Error("timeout");
            err.code = "ECONNABORTED";
            throw err;
          },
        }),
      (err) => err.code === "PROVIDER_ERROR" && /timed out/i.test(err.message),
    );
  });

  it("success maps response and never returns api key", async () => {
    const data = await licensedGet("UP26AQ8005", {
      _config: readyConfig,
      _request: async (req) => {
        assert.match(req.headers.Authorization, /^Bearer /);
        assert.equal(req.params.registrationNumber, "UP26AQ8005");
        return {
          status: 200,
          data: {
            registrationNumber: "UP26AQ8005",
            makeAndModel: "Mahindra Xuv300",
            ownership: {
              ownerName: "S***A",
              vehicleClass: "Motor Car(LMV)",
              fuelType: "DIESEL",
            },
            importantDates: { registrationDate: "06-Jun-2023" },
          },
          headers: {},
          durationMs: 5,
          attempts: 1,
        };
      },
    });
    assert.equal(data.makeAndModel, "Mahindra Xuv300");
    assert.equal(data.ownership.fuelType, "DIESEL");
    assert.equal(data.importantDates.registrationDate, "06-Jun-2023");
    assert.equal(data.meta.provider, "licensed");
    assert.ok(!JSON.stringify(data).includes("secret-key-do-not-log"));
  });
});

describe("public-extract", () => {
  it("detects CryptoJS salted blobs without returning contents", () => {
    assert.equal(isEncryptedPublicBlob("U2FsdGVkX18oVeHbUyohPgEbh/QAxghLovvJWnNEpcyWtDUGgEHY"), true);
    assert.equal(isEncryptedPublicBlob("DIESEL"), false);
  });

  it("recursively extracts title/subtitle and pageProps public fields", () => {
    const html = `<!doctype html><html><head>
      <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: {
          pageProps: {
            rc: "UP26AQ8005",
            xdataprops: "U2FsdGVkX18oVeHbUyohPgEbh/QAxghLovvJWnNEpcyWtDUGgEHYJTGF+tjtuI6fOZFRc+/6zSbsZ5PV",
            webSections: [
              {
                heading: { title: "Ownership Details" },
                messages: [
                  { title: "Fuel Type", subtitle: "DIESEL" },
                  { title: "Vehicle Class", subtitle: "Motor Car(LMV)" },
                ],
              },
              {
                heading: { title: "Important Dates" },
                messages: [{ title: "Registration Date", subtitle: "06-Jun-2023" }],
              },
            ],
          },
        },
      })}</script>
      </head><body>
        <div class="input_vehical_layout_numberPlateContainer__Ug78g"><p>UP26AQ8005</p></div>
        <div class="input_vehical_layout_vehicalModel__1ABTF">Mahindra Xuv300</div>
        <div class="input_vehical_layout_ownerName__NHkpi">S***A</div>
        <div class="expand_component_expandComponentContainer__fCIDc">
          <div class="expand_component_expandHeader__TAsoW"><p>RTO Details</p></div>
          <div class="expand_component_detailItem__V43eh">
            <div class="expand_component_itemText__cbigB">Number</div>
            <div class="expand_component_itemSubTitle__ElsYf">UP-26</div>
          </div>
          <div class="expand_component_detailItem__V43eh">
            <div class="expand_component_itemText__cbigB">State</div>
            <div class="expand_component_itemSubTitle__ElsYf">Uttar Pradesh</div>
          </div>
        </div>
        <div class="expand_component_expandComponentContainer__fCIDc">
          <div class="expand_component_expandHeader__TAsoW"><p>Ownership Details</p></div>
          <img alt="lock icon" />
        </div>
      </body></html>`;

    const { bag, diagnostics } = extractFromPublicHtml(html, {
      cheerio,
      registrationNumber: "UP26AQ8005",
    });
    const partial = bagToVehiclePartial(bag);
    const debug = buildPublicDebug(diagnostics);

    assert.equal(partial.registrationNumber, "UP26AQ8005");
    assert.equal(partial.makeAndModel, "Mahindra Xuv300");
    assert.equal(partial.ownership.fuelType, "DIESEL");
    assert.equal(partial.ownership.vehicleClass, "Motor Car(LMV)");
    assert.equal(partial.importantDates.registrationDate, "06-Jun-2023");
    assert.equal(partial.rto.code, "UP-26");
    assert.equal(partial.rto.state, "Uttar Pradesh");
    assert.equal(debug.nextDataFound, true);
    assert.equal(debug.encryptedPayloadPresent, true);
    assert.ok(!JSON.stringify(debug).includes("U2FsdGVkX1"));
    assert.ok(debug.extractedPublicFields.includes("ownership.fuelType"));
    assert.ok(debug.sourcesFound.some((s) => /NEXT_DATA/i.test(s)));
  });

  it("does not invent locked-section values from labels alone", () => {
    const html = `<html><body>
      <div class="expand_component_expandComponentContainer__fCIDc">
        <div class="expand_component_expandHeader__TAsoW"><p>Ownership Details</p></div>
        <img alt="lock icon" />
        <div class="expand_component_detailItem__V43eh">
          <div class="expand_component_itemText__cbigB">Fuel Type</div>
          <div class="expand_component_itemSubTitle__ElsYf"></div>
        </div>
      </div>
    </body></html>`;
    const { bag } = extractFromPublicHtml(html, { cheerio });
    assert.equal(bag["ownership.fuelType"], undefined);
  });
});

describe("carinfo-public integration", () => {
  it("fetches UP26AQ8005 public HTML shape", async () => {
    const data = await publicGet("UP26AQ8005");
    assert.equal(data.registrationNumber, "UP26AQ8005");
    assert.ok(data.makeAndModel);
    assert.equal(data.meta.provider, "carinfo-public");
    // Masked owner appears in public hero — map into ownership.ownerName when present
    assert.ok(data.ownerNameMasked);
    assert.equal(data.ownership.ownerName, data.ownerNameMasked);
    assert.equal(data.otherInfo.registrationNo, "UP26AQ8005");
    // Locked sections remain unavailable in unauthenticated response
    assert.equal(data.ownership.vehicleClass, null);
    assert.equal(data.ownership.fuelType, null);
    assert.equal(data.importantDates.registrationDate, null);
    assert.equal(data.otherInfo.rcStatus, null);
    assert.equal(data.meta.unavailableFields, undefined);
  });

  it("debug mode returns public diagnostics without secrets", async () => {
    const data = await publicGet("UP26AQ8005", { debug: true });
    assert.ok(data._debug);
    assert.equal(typeof data._debug.htmlLength, "number");
    assert.equal(typeof data._debug.nextDataFound, "boolean");
    assert.equal(typeof data._debug.pagePropsFound, "boolean");
    assert.equal(typeof data._debug.jsonScriptsCount, "number");
    assert.equal(typeof data._debug.jsonLdCount, "number");
    assert.ok(Array.isArray(data._debug.extractedPublicFields));
    assert.ok(Array.isArray(data._debug.extractedFieldNames));
    assert.ok(Array.isArray(data._debug.publicSectionTitles));
    const dumped = JSON.stringify(data._debug);
    assert.ok(!dumped.includes("U2FsdGVkX1"));
    assert.ok(!/api[_-]?key|cookie|authorization|password/i.test(dumped));
  });

  it("fetches DL8CBG8852 or returns structured provider/not-found error", async () => {
    try {
      const data = await publicGet("DL8CBG8852");
      assert.equal(data.registrationNumber, "DL8CBG8852");
      assert.equal(data.meta.provider, "carinfo-public");
      assert.equal(data.ownership.fuelType, null);
      assert.equal(data.importantDates.fitnessUpto, null);
      assert.equal(data.meta.unavailableFields, undefined);
    } catch (err) {
      assert.ok(err instanceof AppError);
      assert.ok(["NOT_FOUND", "PROVIDER_ERROR"].includes(err.code));
    }
  });
});
