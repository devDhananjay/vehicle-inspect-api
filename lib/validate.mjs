import { AppError } from "./errors.mjs";

/** Indian RC: state(2) + district(1-2) + series(1-3) + number(1-4) */
const RC_NUMBER = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{1,4}$/;

export function normalizeRc(input) {
  return String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "");
}

export function validateRc(input) {
  if (input == null || String(input).trim() === "") {
    throw new AppError("Missing registration number. Use ?rc=UP26AQ8005 or /api/vehicle/UP26AQ8005", {
      status: 400,
      code: "missing_rc",
    });
  }

  const rc = normalizeRc(input);

  if (rc.length < 6 || rc.length > 11) {
    throw new AppError("Invalid registration number length", {
      status: 400,
      code: "invalid_rc",
      details: { rc },
    });
  }

  if (!RC_NUMBER.test(rc)) {
    throw new AppError("Invalid registration number format", {
      status: 400,
      code: "invalid_rc",
      details: { rc, expected: "e.g. UP26AQ8005" },
    });
  }

  return rc;
}
