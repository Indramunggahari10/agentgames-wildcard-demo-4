// Vercel serverless function: GET /api/examples.
// Returns exactly the same JSON as the /api/examples route in server.js.
// The preset list itself lives in src/examples.js and is unchanged.
import { EXAMPLES } from "../src/examples.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ examples: EXAMPLES }));
}
