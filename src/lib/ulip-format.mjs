/**
 * ULIP VAHAN-style request/response shaping.
 * Endpoint: POST /ulip/v1.0.0/VAHAN/01
 */

function s(value) {
  if (value == null) return "";
  return String(value);
}

/** Split codes like "DL-08" / "DL08" into state + RTO. */
export function parseRtoCode(code) {
  const raw = s(code).toUpperCase().replace(/\s+/g, "");
  if (!raw) return { stateCd: "", rtoCd: "" };
  const m = raw.match(/^([A-Z]{2})-?(\d{1,2})$/);
  if (m) return { stateCd: m[1], rtoCd: m[2] };
  if (/^[A-Z]{2}$/.test(raw)) return { stateCd: raw, rtoCd: "" };
  return { stateCd: "", rtoCd: raw };
}

export function emptyVehicleDetails(registrationNumber = "") {
  return {
    rc_gvw: "",
    rto_cd: "",
    rc_color: "",
    state_cd: "",
    rc_eng_no: "",
    rc_no_cyl: "",
    rc_noc_dt: "",
    rc_status: "",
    rc_fuel_cd: "",
    rc_pucc_no: "",
    rc_regn_dt: "",
    rc_regn_no: s(registrationNumber),
    rc_unld_wt: "",
    rc_vh_type: "",
    rc_chasi_no: "",
    rc_financer: "",
    rc_fit_upto: "",
    rc_maker_cd: "",
    rc_model_cd: "",
    rc_owner_sr: "",
    rc_sale_amt: "",
    rc_seat_cap: "",
    rc_tax_mode: "",
    rc_tax_upto: "",
    rc_vch_catg: "",
    rc_vh_class: "",
    rc_cubic_cap: "",
    rc_fuel_desc: "",
    rc_goods_tax: "",
    rc_pucc_upto: "",
    rc_regn_upto: "",
    rc_stand_cap: "",
    rc_wheelbase: "",
    rc_maker_desc: "",
    rc_no_of_axle: "",
    rc_norms_desc: "",
    rc_owner_name: "",
    stautsMessage: "OK",
    rc_maker_model: "",
    rc_noc_details: "",
    rc_purchase_dt: "",
    rc_sleeper_cap: "",
    rc_status_as_on: "",
    rc_vhclass_desc: "",
    rc_manu_month_yr: "",
    rc_own_catg_desc: "",
    rc_owner_cd_desc: "",
    rc_owner_history: [],
    rc_passenger_tax: "",
    rc_registered_at: "",
    rc_vch_catg_desc: "",
    rc_vh_class_desc: "",
    rc_body_type_desc: "",
    rc_insurance_comp: "",
    rc_insurance_upto: "",
    rc_insurance_status: "",
    rc_present_address: "",
    rc_blacklist_status: "",
    api_response_message: "",
    rc_permanent_address: "",
    rc_insurance_policy_no: "",
  };
}

/**
 * Map internal provider vehicle data → ULIP VehicleDetails.
 * Missing source fields stay as empty string (ULIP style).
 *
 * Public-field → ULIP key mapping:
 *   registrationNumber          → rc_regn_no
 *   makeAndModel                → rc_maker_model (+ rc_maker_desc when possible)
 *   ownerNameMasked / ownerName → rc_owner_name
 *   insurance.expiryDate        → rc_insurance_upto
 *   insurance.status            → rc_insurance_status
 *   rto.code                    → state_cd + rto_cd
 *   rto.registeredOffice        → rc_registered_at
 *   rto.state                   → rc_present_address (state name)
 *   rto.website                 → rc_noc_details
 *   ownership.registeredRto     → rc_registered_at (fallback)
 *   ownership.fuelType          → rc_fuel_desc
 *   ownership.fuelNorms         → rc_norms_desc
 *   ownership.vehicleClass      → rc_vhclass_desc / rc_vh_class_desc
 */
export function toVehicleDetails(data = {}) {
  const rc = s(data.registrationNumber || data.otherInfo?.registrationNo);
  const { stateCd, rtoCd } = parseRtoCode(data.rto?.code);
  const details = emptyVehicleDetails(rc);

  details.rto_cd = rtoCd;
  details.state_cd = stateCd;

  details.rc_regn_no = rc;
  details.rc_maker_model = s(data.makeAndModel);
  if (details.rc_maker_model) {
    // First token as maker when full model string is present (e.g. "Mahindra Xuv300 ...")
    const maker = details.rc_maker_model.split(/\s+/)[0];
    if (maker) details.rc_maker_desc = maker;
  }

  details.rc_owner_name = s(data.ownership?.ownerName || data.ownerNameMasked);
  details.rc_registered_at = s(
    data.ownership?.registeredRto || data.rto?.registeredOffice || data.rto?.state,
  );
  details.rc_present_address = s(data.rto?.state);
  details.rc_permanent_address = s(data.rto?.state);
  details.rc_noc_details = s(data.rto?.website);

  details.rc_fuel_desc = s(data.ownership?.fuelType);
  details.rc_norms_desc = s(data.ownership?.fuelNorms);
  details.rc_vhclass_desc = s(data.ownership?.vehicleClass);
  details.rc_vh_class_desc = s(data.ownership?.vehicleClass);

  details.rc_regn_dt = s(data.importantDates?.registrationDate);
  details.rc_fit_upto = s(data.importantDates?.fitnessUpto);
  details.rc_pucc_upto = s(data.importantDates?.pollutionUpto);
  details.rc_insurance_upto = s(
    data.importantDates?.insuranceUpto || data.insurance?.expiryDate,
  );
  details.rc_regn_upto = s(data.importantDates?.fitnessUpto);

  const insuranceStatus = s(data.insurance?.status);
  if (insuranceStatus && insuranceStatus.toLowerCase() !== "unknown") {
    details.rc_insurance_status = insuranceStatus;
  }

  details.rc_unld_wt = s(data.otherInfo?.unloadedWeightKg);
  details.rc_seat_cap = s(data.otherInfo?.numberOfSeats);
  details.rc_status = s(data.otherInfo?.rcStatus);

  return details;
}

export function toUlipSuccess(data) {
  return {
    code: "200",
    error: "false",
    message: "Success",
    response: [
      {
        message: null,
        response_json: {
          VehicleDetails: toVehicleDetails(data),
        },
        responseStatus: "SUCCESS",
      },
    ],
  };
}

export function toUlipError(err, { httpStatus = 500 } = {}) {
  const code = String(httpStatus);
  const message =
    err?.message ||
    (httpStatus >= 500 ? "Vehicle data provider unavailable" : "Request failed");
  return {
    code,
    error: "true",
    message,
    response: [],
  };
}
