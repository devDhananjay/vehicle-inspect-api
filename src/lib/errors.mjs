export class AppError extends Error {
  constructor(message, { status = 500, code = "PROVIDER_ERROR", details = null } = {}) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Public-safe error body — never leaks secrets or stacks. */
export function toErrorResponse(err, { includeDetails = false } = {}) {
  if (err instanceof AppError) {
    const safeMessage =
      err.code === "INVALID_RC" || err.code === "MISSING_RC" || err.code === "RATE_LIMITED"
        ? err.message
        : err.status >= 500 ||
            err.code === "PROVIDER_ERROR" ||
            err.code === "PROVIDER_UNAVAILABLE" ||
            err.code === "PROVIDER_NOT_CONFIGURED"
          ? err.message || "Vehicle data provider unavailable"
          : err.message;

    return {
      status: err.status,
      body: {
        ok: false,
        error: {
          code: err.code,
          message: safeMessage,
          ...(includeDetails && err.details
            ? { details: sanitizeDetails(err.details) }
            : {}),
        },
      },
    };
  }

  return {
    status: 502,
    body: {
      ok: false,
      error: {
        code: "PROVIDER_ERROR",
        message: "Vehicle data provider unavailable",
      },
    },
  };
}

function sanitizeDetails(details) {
  if (!details || typeof details !== "object") return undefined;
  const clone = { ...details };
  delete clone.apiKey;
  delete clone.headers;
  delete clone.authorization;
  delete clone.emptySchema;
  return clone;
}
