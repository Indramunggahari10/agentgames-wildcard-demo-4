// Vercel serverless function: POST /api/screen.
// Same request/response contract as the /api/screen route in server.js:
// the body is read raw (Vercel's automatic body parsing is disabled below)
// with the same 64 KB cap, the same 400/413 error strings, and the same
// screening logic from src/screen.js, unchanged.
import { screenTransaction } from "../src/screen.js";

const MAX_BODY_BYTES = 64 * 1024;

export const config = { api: { bodyParser: false } };

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  let raw;
  try {
    raw = await readBody(req);
  } catch (err) {
    if (err.code === "TOO_LARGE") {
      sendJson(res, 413, { error: "body too large (64 KB cap)" });
      return;
    }
    sendJson(res, 500, { error: "internal error" });
    return;
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
}
