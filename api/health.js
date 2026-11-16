// Vercel serverless function: GET /api/health.
// Returns exactly the same JSON as the /health route in server.js.
// (No rewrite: in this project's Node server mode, server.js routes
// /health directly, so a /health -> /api/health rewrite would 404.)
// No dependencies, no I/O beyond the response.
export default function handler(req, res) {
  if (req.method !== "GET") {
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true, service: "wallet-guard", version: "1.0.0" }));
}
