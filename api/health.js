// Vercel serverless function: GET /api/health.
// Also reachable as GET /health via the rewrite in vercel.json.
// Returns exactly the same JSON as the /health route in local-server.js.
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
