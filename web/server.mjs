import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import next from "next";
import { contentSecurityPolicy, hostAllowed } from "./policy.mjs";

const port = Number(process.env.PORT || 4185);
const apiBase = process.env.API_INTERNAL_URL || "http://127.0.0.1:8080";
const secret = process.env.PROXY_SHARED_SECRET || "";
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, hostname: "0.0.0.0", port });
const handle = app.getRequestHandler();
const JSON_LIMIT = 65_536;
const MEDIA_LIMIT = 8 * 1024 * 1024 + 65_536;
const VIDEO_LIMIT = 40 * 1024 * 1024 + 65_536;

function clientIp(req) {
  const raw = req.socket?.remoteAddress || "unknown";
  return raw.startsWith("::ffff:") ? raw.slice(7) : raw;
}

function sign(ip) {
  return createHmac("sha256", secret).update(ip).digest("hex");
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function readBody(req, limit) {
  const declared = Number(req.headers["content-length"] || 0);
  if (declared > limit) {
    const err = new Error("too_large");
    err.statusCode = 413;
    throw err;
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limit) {
        const err = new Error("too_large");
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function proxy(req, res) {
  if (!secret) {
    sendJson(res, 500, { error: { code: "config", message: "The local proxy secret is not set.", fields: null } });
    return;
  }
  const host = req.headers.host || "127.0.0.1";
  const url = new URL(req.url || "/", `http://${host}`);
  const limit = url.pathname === "/api/videos" ? VIDEO_LIMIT : url.pathname === "/api/media" ? MEDIA_LIMIT : JSON_LIMIT;
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req, limit);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    const lower = key.toLowerCase();
    if (["host", "connection", "content-length", "transfer-encoding", "x-real-ip", "x-real-ip-sign", "x-forwarded-for"].includes(lower)) continue;
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else headers.set(key, value);
  }
  const ip = clientIp(req);
  headers.set("x-real-ip", ip);
  headers.set("x-real-ip-sign", sign(ip));
  if (body && body.length) headers.set("content-length", String(body.length));
  const upstream = await fetch(apiBase + url.pathname + url.search, {
    method: req.method,
    headers,
    body: body && body.length ? body : undefined,
  });
  const out = {};
  upstream.headers.forEach((value, key) => {
    if (["set-cookie", "transfer-encoding", "content-encoding", "content-length"].includes(key)) return;
    out[key] = value;
  });
  const cookies = typeof upstream.headers.getSetCookie === "function" ? upstream.headers.getSetCookie() : [];
  if (cookies.length) out["set-cookie"] = cookies;
  res.writeHead(upstream.status, out);
  if (!upstream.body) {
    res.end();
    return;
  }
  Readable.fromWeb(upstream.body).pipe(res);
}

app.prepare().then(() => {
  createServer(async (req, res) => {
    try {
      if (!hostAllowed(req.headers.host)) {
        sendJson(res, 421, { error: { code: "host", message: "This host is not allowed.", fields: null } });
        return;
      }
      const url = req.url || "/";
      if (url === "/api" || url.startsWith("/api/") || url.startsWith("/api?")) {
        await proxy(req, res);
        return;
      }
      const policy = contentSecurityPolicy();
      const writeHead = res.writeHead;
      res.writeHead = function (status, reason, headers) {
        if (typeof reason === "string") {
          return writeHead.call(this, status, reason, { ...(headers || {}), "content-security-policy": policy });
        }
        return writeHead.call(this, status, { ...(reason || {}), "content-security-policy": policy });
      };
      await handle(req, res);
    } catch (err) {
      const path = req.url || "";
      const message = path.startsWith("/api/videos") ? "Clips must be 40 MB or smaller." : path.startsWith("/api/media") ? "Images must be 8 MB or smaller." : "Request is too large.";
      if (err && err.statusCode === 413) {
        sendJson(res, 413, { error: { code: "too_large", message, fields: null } });
        return;
      }
      if (!res.headersSent) sendJson(res, 502, { error: { code: "unavailable", message: "Spekup can't reach its local service.", fields: null } });
      else res.end();
    }
  }).listen(port, "0.0.0.0", () => {
    console.log(`common-voice web listening on ${port}`);
  });
});
