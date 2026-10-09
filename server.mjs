import http from "node:http";
import { URL } from "node:url";
import { AppError, toErrorResponse } from "./src/lib/errors.mjs";
import { logger } from "./src/lib/logger.mjs";
import { toUlipError, toUlipSuccess } from "./src/lib/ulip-format.mjs";
import { vehicleRateLimiter } from "./src/lib/rate-limit.mjs";
import {
  getActiveProviderName,
  getHealthProviders,
  getProviderStatus,
} from "./src/providers/index.mjs";
import { lookupVehicle } from "./src/service.mjs";

const PORT = Number(process.env.PORT || 3010);
const HOST = process.env.HOST || "0.0.0.0";
const ULIP_PATH = "/ulip/v1.0.0/VAHAN/01";

function clientKey(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.trim()) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body, null, 2));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("Invalid JSON body", {
      status: 400,
      code: "INVALID_BODY",
    });
  }
}

async function handleRequest(req, res) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  logger.info("http.request", { requestId, method: req.method, path: url.pathname });

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      providers: getHealthProviders(),
      activeProvider: getActiveProviderName(),
      providerStatus: getProviderStatus(),
      rateLimit: vehicleRateLimiter.stats(),
    });
    return;
  }

  if (url.pathname === ULIP_PATH || url.pathname === `${ULIP_PATH}/`) {
    if (req.method !== "POST") {
      sendJson(res, 405, toUlipError(new Error("Method not allowed"), { httpStatus: 405 }));
      return;
    }

    try {
      const body = await readJsonBody(req);
      const rawRc = body.vehiclenumber ?? body.vehicleNumber ?? body.vehicle_number;
      if (rawRc == null || String(rawRc).trim() === "") {
        sendJson(
          res,
          400,
          toUlipError(new Error("vehiclenumber is required"), { httpStatus: 400 }),
        );
        return;
      }

      const result = await lookupVehicle(rawRc, {
        rateLimitKey: `ip:${clientKey(req)}`,
        timeoutMs: url.searchParams.get("timeoutMs") || undefined,
        provider: url.searchParams.get("provider") || undefined,
      });
      sendJson(res, 200, toUlipSuccess(result.data));
    } catch (err) {
      const { status } = toErrorResponse(err);
      logger.warn("http.ulip_lookup_failed", {
        requestId,
        status,
        message: err.message,
      });
      const headers = {};
      if (status === 429) headers["Retry-After"] = "60";
      sendJson(res, status, toUlipError(err, { httpStatus: status }), headers);
    }
    return;
  }

  // Legacy GET routes (previous response shape)
  if (req.method === "GET") {
    const vehicleMatch = url.pathname.match(/^\/api\/(?:vehicle|rc)\/([^/]+)\/?$/i);
    const isVehicleQuery = url.pathname === "/api/vehicle" || url.pathname === "/api/rc";

    if (isVehicleQuery || vehicleMatch) {
      const rawRc =
        vehicleMatch?.[1] != null
          ? decodeURIComponent(vehicleMatch[1])
          : url.searchParams.get("rc") ?? url.searchParams.get("vehicle");

      try {
        const result = await lookupVehicle(rawRc, {
          rateLimitKey: `ip:${clientKey(req)}`,
          timeoutMs: url.searchParams.get("timeoutMs") || undefined,
          provider: url.searchParams.get("provider") || undefined,
          debug: url.searchParams.get("debug") === "1",
        });
        sendJson(res, 200, result);
      } catch (err) {
        const { status, body } = toErrorResponse(err, {
          includeDetails: url.searchParams.get("debug") === "1",
        });
        const headers = {};
        if (status === 429) headers["Retry-After"] = "60";
        logger.warn("http.lookup_failed", {
          requestId,
          status,
          code: body.error?.code,
          message: err.message,
        });
        sendJson(res, status, body, headers);
      }
      return;
    }
  }

  if (req.method !== "GET" && req.method !== "POST") {
    sendJson(res, 405, {
      ok: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
    });
    return;
  }

  sendJson(res, 404, {
    ok: false,
    error: { code: "NOT_FOUND", message: "Not found" },
    routes: [
      "GET /health",
      "POST /ulip/v1.0.0/VAHAN/01",
      "GET /api/vehicle/UP26AQ8005",
    ],
  });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    logger.error("http.unhandled", { message: err.message });
    sendJson(res, 500, toUlipError(err, { httpStatus: 500 }));
  });
});

server.listen(PORT, HOST, () => {
  logger.info("server.listen", {
    host: HOST,
    port: PORT,
    activeProvider: getActiveProviderName(),
  });
});
