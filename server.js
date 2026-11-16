// Wallet Guard — zero-framework HTTP server (Node built-ins only).
// No persistence, no external network calls, no logging of request bodies
// (only method, path, status, and coarse byte size).
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { screenTransaction } from "./src/screen.js";
import { EXAMPLES } from "./src/examples.js";

const MAX_BODY_BYTES = 64 * 1024;

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(ROOT, "public", "index.html");

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("body too large"), { code: "TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const started = Date.now();
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && url.pathname === "/health") {
        sendJson(res, 200, { ok: true, service: "wallet-guard", version: "1.0.0" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true, service: "wallet-guard", version: "1.0.0" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/") {
        const html = await readFile(INDEX_PATH, "utf8");
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/examples") {
        sendJson(res, 200, { examples: EXAMPLES });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/screen") {
        let raw;
        try {
          raw = await readBody(req);
        } catch (err) {
          if (err.code === "TOO_LARGE") {
            sendJson(res, 413, { error: "body too large (64 KB cap)" });
            return;
          }
          throw err;
        }
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          sendJson(res, 400, { error: "body must be valid JSON" });
          return;
        }
        try {
          sendJson(res, 200, screenTransaction(body));
        } catch (err) {
          sendJson(res, 400, { error: err.message });
        }
        return;
      }
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: "internal error" });
      console.error("request failed", err.message);
    } finally {
      // Coarse access log only: no bodies, no addresses, no calldata.
      console.log(`${req.method} ${new URL(req.url, "http://localhost").pathname} -> ${res.statusCode} (${Date.now() - started}ms)`);
    }
  });
}

// Default export: Vercel's Node.js runtime requires the server entrypoint's
// default export to be a function or a server. Exporting the created server
// lets Vercel route requests through it; running `node server.js` directly
// still listens on $PORT as before.
const server = createServer();
export default server;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => {
    console.log(`wallet-guard listening on :${port}`);
  });
}
