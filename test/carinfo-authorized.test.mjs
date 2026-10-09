import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppError } from "../src/lib/errors.mjs";
import { validateRc } from "../src/lib/validate.mjs";
import {
  getVehicleDetails,
  isCarInfoAuthorizedConfigured,
  normalizeCarInfoAuthorizedResponse,
} from "../src/providers/carinfo-authorized.mjs";

const readyConfig = {
  baseUrl: "https://api.example-carinfo.invalid",
  vehicleEndpoint: "/v1/rc/details",
  method: "GET",
  rcParam: "registrationNumber",
  apiKey: "test-api-key-do-not-log",
  clientId: null,
  clientSecret: null,
  accessToken: null,
  tokenUrl: null,
  authHeader: "Authorization",
  authScheme: "Bearer",
  timeoutMs: 1000,
  maxRetries: 0,
};

const fullAuthorizedBody = {
  registrationNumber: "UP26AQ8005",
  makeAndModel: "Mahindra Xuv300 W6 Ds Bs6 Mt",
  ownerNameMasked: "S***A P****P S***H",
  insurance: { expiryDate: "30-May-2026", status: "expired" },
  rto: {
    code: "UP-26",
    registeredOffice: "Pilibhit, Uttar Pradesh - 262001",
    state: "Uttar Pradesh",
    website: "http://uptransport.upsdc.gov.in/",
  },
  ownership: {
    ownerName: "S***A P****P S***H",
    registeredRto: "Pilibhit, Uttar Pradesh - 262001",
    vehicleClass: "Motor Car(LMV)",
    fuelType: "DIESEL",
    fuelNorms: "BHARAT STAGE VI",
  },
  importantDates: {
    registrationDate: "06-Jun-2023",
    fitnessUpto: "05-Jun-2038",
    vehicleAge: "3 years , 4 months & 1 day",
    pollutionUpto: "13-Sep-2024 Expired",
    insuranceUpto: "30-May-2026 Expired",
    insuranceExpiringIn: "Expired",
  },
  otherInfo: {
    registrationNo: "UP26AQ8005",
    unloadedWeightKg: "1405",
    numberOfSeats: null,
    rcStatus: "ACTIVE",
  },
};

describe("validateRc (authorized suite)", () => {
  it("accepts UP26AQ8005", () => {
    assert.equal(validateRc("UP26AQ8005"), "UP26AQ8005");
  });

  it("accepts DL8CBG8852", () => {
    assert.equal(validateRc("DL8CBG8852"), "DL8CBG8852");
  });

  it("rejects invalid registration number", () => {
    assert.throws(() => validateRc("!!"), (err) => err.code === "INVALID_RC");
  });
});

describe("normalizeCarInfoAuthorizedResponse", () => {
  it("maps successful authorized full response", () => {
    const data = normalizeCarInfoAuthorizedResponse(fullAuthorizedBody, "UP26AQ8005");
    assert.equal(data.meta.provider, "carinfo-authorized");
    assert.equal(data.ownership.fuelType, "DIESEL");
    assert.equal(data.importantDates.registrationDate, "06-Jun-2023");
    assert.equal(data.otherInfo.rcStatus, "ACTIVE");
    assert.equal(data.otherInfo.unloadedWeightKg, "1405");
    assert.ok(!JSON.stringify(data).includes("test-api-key"));
  });

  it("keeps ownership null when missing", () => {
    const data = normalizeCarInfoAuthorizedResponse(
      { registrationNumber: "UP26AQ8005", makeAndModel: "X" },
      "UP26AQ8005",
    );
    assert.equal(data.ownership.ownerName, null);
    assert.equal(data.ownership.fuelType, null);
  });

  it("keeps importantDates null when missing", () => {
    const data = normalizeCarInfoAuthorizedResponse(
      { registrationNumber: "DL8CBG8852", ownership: { fuelType: "PETROL" } },
      "DL8CBG8852",
    );
    assert.equal(data.importantDates.registrationDate, null);
    assert.equal(data.importantDates.fitnessUpto, null);
  });

  it("keeps otherInfo null when missing", () => {
    const data = normalizeCarInfoAuthorizedResponse(
      {
        registrationNumber: "UP26AQ8005",
        importantDates: { registrationDate: "01-Jan-2020" },
      },
      "UP26AQ8005",
    );
    assert.equal(data.otherInfo.rcStatus, null);
    assert.equal(data.otherInfo.unloadedWeightKg, null);
  });
});

describe("carinfo-authorized provider", () => {
  it("missing API configuration → PROVIDER_NOT_CONFIGURED", async () => {
    await assert.rejects(
      () =>
        getVehicleDetails("UP26AQ8005", {
          _config: {
            ...readyConfig,
            baseUrl: null,
            apiKey: null,
            accessToken: null,
            clientId: null,
            clientSecret: null,
            vehicleEndpoint: "",
          },
        }),
      (err) => err.code === "PROVIDER_NOT_CONFIGURED" && err.status === 501,
    );
  });

  it("configured but missing vehicle endpoint → PROVIDER_NOT_CONFIGURED", async () => {
    await assert.rejects(
      () =>
        getVehicleDetails("UP26AQ8005", {
          _config: { ...readyConfig, vehicleEndpoint: "" },
        }),
      (err) =>
        err.code === "PROVIDER_NOT_CONFIGURED" &&
        err.details?.vehicleEndpointConfigured === false,
    );
  });

  it("successful authorized response maps full schema", async () => {
    const data = await getVehicleDetails("UP26AQ8005", {
      _config: readyConfig,
      _request: async (req) => {
        assert.match(req.headers.Authorization, /^Bearer /);
        assert.ok(!JSON.stringify(req).includes("Cookie"));
        assert.equal(req.params.registrationNumber, "UP26AQ8005");
        return {
          status: 200,
          data: fullAuthorizedBody,
          headers: {},
          durationMs: 12,
          attempts: 1,
        };
      },
    });
    assert.equal(data.ownership.vehicleClass, "Motor Car(LMV)");
    assert.equal(data.importantDates.fitnessUpto, "05-Jun-2038");
    assert.equal(data.otherInfo.rcStatus, "ACTIVE");
    assert.equal(data.meta.provider, "carinfo-authorized");
    assert.ok(!JSON.stringify(data).includes("test-api-key-do-not-log"));
  });

  it("provider 401 → PROVIDER_UNAVAILABLE", async () => {
    await assert.rejects(
      () =>
        getVehicleDetails("UP26AQ8005", {
          _config: readyConfig,
          _request: async () => ({
            status: 401,
            data: {},
            headers: {},
            durationMs: 1,
            attempts: 1,
          }),
        }),
      (err) => err.code === "PROVIDER_UNAVAILABLE",
    );
  });

  it("provider 403 → PROVIDER_UNAVAILABLE", async () => {
    await assert.rejects(
      () =>
        getVehicleDetails("UP26AQ8005", {
          _config: readyConfig,
          _request: async () => ({
            status: 403,
            data: {},
            headers: {},
            durationMs: 1,
            attempts: 1,
          }),
        }),
      (err) => err.code === "PROVIDER_UNAVAILABLE",
    );
  });

  it("provider 429 → RATE_LIMITED", async () => {
    await assert.rejects(
      () =>
        getVehicleDetails("UP26AQ8005", {
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

  it("provider 500 → PROVIDER_UNAVAILABLE", async () => {
    await assert.rejects(
      () =>
        getVehicleDetails("UP26AQ8005", {
          _config: readyConfig,
          _request: async () => ({
            status: 500,
            data: {},
            headers: {},
            durationMs: 1,
            attempts: 1,
          }),
        }),
      (err) => err.code === "PROVIDER_UNAVAILABLE",
    );
  });

  it("timeout → PROVIDER_UNAVAILABLE", async () => {
    await assert.rejects(
      () =>
        getVehicleDetails("UP26AQ8005", {
          _config: readyConfig,
          _request: async () => {
            const err = new Error("timeout");
            err.code = "ECONNABORTED";
            throw err;
          },
        }),
      (err) =>
        err instanceof AppError &&
        err.code === "PROVIDER_UNAVAILABLE" &&
        /timed out/i.test(err.message),
    );
  });

  it("malformed provider response → PROVIDER_UNAVAILABLE", async () => {
    await assert.rejects(
      () =>
        getVehicleDetails("UP26AQ8005", {
          _config: readyConfig,
          _request: async () => ({
            status: 200,
            data: "not-json-object",
            headers: {},
            durationMs: 1,
            attempts: 1,
          }),
        }),
      (err) =>
        err.code === "PROVIDER_UNAVAILABLE" &&
        err.details?.reason === "malformed_response",
    );
  });

  it("debug mode returns safe field availability only", async () => {
    const data = await getVehicleDetails("UP26AQ8005", {
      debug: true,
      _config: readyConfig,
      _request: async () => ({
        status: 200,
        data: fullAuthorizedBody,
        headers: {},
        durationMs: 9,
        attempts: 1,
      }),
    });
    assert.ok(data._debug);
    assert.equal(data._debug.provider, "carinfo-authorized");
    assert.equal(data._debug.upstreamHttpStatus, 200);
    assert.ok(Array.isArray(data._debug.fieldAvailability));
    const dumped = JSON.stringify(data._debug);
    assert.ok(!dumped.includes("test-api-key-do-not-log"));
    assert.ok(!/cookie|authorization|client.secret/i.test(dumped));
  });

  it("isCarInfoAuthorizedConfigured reflects env-like config", () => {
    assert.equal(isCarInfoAuthorizedConfigured(readyConfig), true);
    assert.equal(
      isCarInfoAuthorizedConfigured({
        ...readyConfig,
        baseUrl: null,
        apiKey: null,
      }),
      false,
    );
  });
});
