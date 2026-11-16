// Wallet Guard tests — run with `npm test` (node --test). No network, no
// chain access. All addresses are synthetic repeating patterns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { screenTransaction, parseValue, formatEth, MAX_UINT256 } from "../src/screen.js";
import { EXAMPLES, padAddress, padUint, padBool } from "../src/examples.js";
import { createServer } from "../local-server.js";

const TOKEN = "0x1111111111111111111111111111111111111111";
const SPENDER = "0x2222222222222222222222222222222222222222";
const RECIPIENT = "0x3333333333333333333333333333333333333333";
const ZERO = "0x0000000000000000000000000000000000000000";

const call = (selector, words) => "0x" + selector + words.join("");
const codes = (r) => r.flags.map((f) => f.code);

test("unlimited approve is HIGH with unlimited + unverified spender flags", () => {
  const r = screenTransaction({ to: TOKEN, value: "0", data: call("095ea7b3", [padAddress(SPENDER), padUint(MAX_UINT256)]) });
  assert.equal(r.verdict, "high");
  assert.ok(codes(r).includes("UNLIMITED_APPROVAL"));
  assert.ok(codes(r).includes("SPENDER_UNVERIFIED"));
  assert.equal(r.decoded.name, "approve");
  assert.equal(r.decoded.args[0].value, SPENDER);
  assert.equal(r.decoded.args[1].value, MAX_UINT256.toString());
});

test("increaseAllowance to max is HIGH", () => {
  const r = screenTransaction({ to: TOKEN, value: "0", data: call("39509351", [padAddress(SPENDER), padUint(MAX_UINT256)]) });
  assert.equal(r.verdict, "high");
  assert.ok(codes(r).includes("UNLIMITED_APPROVAL"));
});

test("limited approve is CAUTION with capped amount", () => {
  const r = screenTransaction({ to: TOKEN, value: "0", data: call("095ea7b3", [padAddress(SPENDER), padUint(1000n)]) });
  assert.equal(r.verdict, "caution");
  assert.ok(codes(r).includes("LIMITED_APPROVAL"));
  assert.ok(codes(r).includes("SPENDER_UNVERIFIED"));
  assert.ok(!codes(r).includes("UNLIMITED_APPROVAL"));
});

test("zero approve is SAFE (revoke direction)", () => {
  const r = screenTransaction({ to: TOKEN, value: "0", data: call("095ea7b3", [padAddress(SPENDER), padUint(0n)]) });
  assert.equal(r.verdict, "safe");
  assert.ok(codes(r).includes("ZERO_APPROVAL"));
  assert.ok(!codes(r).includes("SPENDER_UNVERIFIED"));
});

test("decreaseAllowance is SAFE", () => {
  const r = screenTransaction({ to: TOKEN, value: "0", data: call("a457c2d7", [padAddress(SPENDER), padUint(5n)]) });
  assert.equal(r.verdict, "safe");
  assert.ok(codes(r).includes("DECREASE_ALLOWANCE"));
});

test("setApprovalForAll(true) is HIGH; (false) is SAFE", () => {
  const on = screenTransaction({ to: TOKEN, value: "0", data: call("a22cb465", [padAddress(SPENDER), padBool(true)]) });
  assert.equal(on.verdict, "high");
  assert.ok(codes(on).includes("APPROVAL_FOR_ALL_ON"));
  const off = screenTransaction({ to: TOKEN, value: "0", data: call("a22cb465", [padAddress(SPENDER), padBool(false)]) });
  assert.equal(off.verdict, "safe");
  assert.ok(codes(off).includes("APPROVAL_FOR_ALL_OFF"));
});

test("plain transfer is CAUTION with wei + ETH amounts", () => {
  const r = screenTransaction({ to: SPENDER, value: "1000000000000000000", data: "0x" });
  assert.equal(r.verdict, "caution");
  assert.ok(codes(r).includes("PLAIN_TRANSFER"));
  assert.equal(r.decoded, null);
  assert.match(r.flags[0].title, /1 ETH/);
});

test("empty call (no value, no data) is SAFE", () => {
  const r = screenTransaction({ to: SPENDER });
  assert.equal(r.verdict, "safe");
  assert.ok(codes(r).includes("EMPTY_CALL"));
});

test("transfer decodes recipient and amount, SAFE", () => {
  const r = screenTransaction({ to: TOKEN, value: "0", data: call("a9059cbb", [padAddress(RECIPIENT), padUint(250n)]) });
  assert.equal(r.verdict, "safe");
  assert.ok(codes(r).includes("TOKEN_TRANSFER"));
  assert.equal(r.decoded.args[0].value, RECIPIENT);
  assert.equal(r.decoded.args[1].value, "250");
});

test("transferFrom decodes three args", () => {
  const r = screenTransaction({ to: TOKEN, value: "0", data: call("23b872dd", [padAddress(SPENDER), padAddress(RECIPIENT), padUint(7n)]) });
  assert.equal(r.decoded.args.length, 3);
  assert.equal(r.decoded.args[1].value, RECIPIENT);
  assert.equal(r.decoded.args[2].value, "7");
});

test("unknown selector is CAUTION, HIGH when value is attached", () => {
  const plain = screenTransaction({ to: TOKEN, value: "0", data: call("deadbeef", [padUint(1n)]) });
  assert.equal(plain.verdict, "caution");
  assert.ok(codes(plain).includes("UNKNOWN_SELECTOR"));
  assert.equal(plain.decoded.name, null);
  const withValue = screenTransaction({ to: TOKEN, value: "1", data: call("deadbeef", [padUint(1n)]) });
  assert.equal(withValue.verdict, "high");
});

test("short calldata is flagged, not an error", () => {
  const r = screenTransaction({ to: TOKEN, value: "0", data: "0x1234" });
  assert.equal(r.verdict, "caution");
  assert.ok(codes(r).includes("SHORT_CALLDATA"));
});

test("truncated approve args are flagged MALFORMED_ARGS", () => {
  const r = screenTransaction({ to: TOKEN, value: "0", data: call("095ea7b3", [padAddress(SPENDER)]) });
  assert.equal(r.verdict, "caution");
  assert.ok(codes(r).includes("MALFORMED_ARGS"));
});

test("swap decodes amountIn and amountOutMin, CAUTION", () => {
  const r = screenTransaction({ to: SPENDER, value: "0", data: call("38ed1739", [padUint(100n), padUint(90n), padUint(160n), padAddress(RECIPIENT), padUint(999n)]) });
  assert.equal(r.verdict, "caution");
  assert.ok(codes(r).includes("SWAP_CALL"));
  assert.match(r.flags.find((f) => f.code === "SWAP_CALL").title, /in 100 base units, minimum out 90/);
});

test("swapExactETHForTokens uses attached value as amountIn", () => {
  const r = screenTransaction({ to: SPENDER, value: "500", data: call("7ff36ab5", [padUint(400n), padUint(128n)]) });
  assert.equal(r.verdict, "caution");
  assert.match(r.flags.find((f) => f.code === "SWAP_CALL").title, /in 500 base units, minimum out 400/);
});

test("execTransaction and execute are HIGH", () => {
  for (const sel of ["6a761202", "b61d27f6"]) {
    const r = screenTransaction({ to: SPENDER, value: "0", data: call(sel, [padAddress(RECIPIENT), padUint(0n)]) });
    assert.equal(r.verdict, "high");
    assert.ok(codes(r).includes("EXECUTOR_CALL"));
  }
});

test("multicall is HIGH", () => {
  const r = screenTransaction({ to: SPENDER, value: "0", data: call("ac9650d8", [padUint(32n)]) });
  assert.equal(r.verdict, "high");
  assert.ok(codes(r).includes("MULTICALL"));
});

test("mint is CAUTION, burn is SAFE, wrap calls are SAFE", () => {
  const mint = screenTransaction({ to: TOKEN, value: "0", data: call("40c10f19", [padAddress(RECIPIENT), padUint(10n)]) });
  assert.equal(mint.verdict, "caution");
  assert.ok(codes(mint).includes("MINT_CALL"));
  const burn = screenTransaction({ to: TOKEN, value: "0", data: call("42966c68", [padUint(10n)]) });
  assert.equal(burn.verdict, "safe");
  assert.ok(codes(burn).includes("BURN_CALL"));
  const dep = screenTransaction({ to: TOKEN, value: "1000", data: call("d0e30db0", []) });
  assert.equal(dep.verdict, "safe");
  assert.ok(codes(dep).includes("WRAP_CALL"));
  const wd = screenTransaction({ to: TOKEN, value: "0", data: call("2e1a7d4d", [padUint(1000n)]) });
  assert.equal(wd.verdict, "safe");
});

test("zero-address recipient is HIGH", () => {
  const r = screenTransaction({ to: ZERO, value: "1", data: "0x" });
  assert.equal(r.verdict, "high");
  assert.ok(codes(r).includes("ZERO_ADDRESS_RECIPIENT"));
});

test("value attached to a token call is flagged", () => {
  const r = screenTransaction({ to: TOKEN, value: "100", data: call("a9059cbb", [padAddress(RECIPIENT), padUint(1n)]) });
  assert.equal(r.verdict, "caution");
  assert.ok(codes(r).includes("VALUE_WITH_TOKEN_CALL"));
});

test("malformed input throws: bad address, bad hex, negative value, odd hex", () => {
  assert.throws(() => screenTransaction({ to: "not-an-address", value: "0" }), /to must be/);
  assert.throws(() => screenTransaction({ to: TOKEN, value: "0", data: "0xzz" }), /data must be/);
  assert.throws(() => screenTransaction({ to: TOKEN, value: "0", data: "0x123" }), /data must be/);
  assert.throws(() => screenTransaction({ to: TOKEN, value: "-5" }), /value must be/);
  assert.throws(() => screenTransaction({ to: TOKEN, value: "1.5" }), /value must be/);
  assert.throws(() => screenTransaction(null), /JSON object/);
});

test("value parsing: hex, decimal, number, missing", () => {
  assert.equal(parseValue("0x10"), 16n);
  assert.equal(parseValue("42"), 42n);
  assert.equal(parseValue(7), 7n);
  assert.equal(parseValue(undefined), 0n);
  assert.equal(formatEth(1500000000000000000n), "1.5 ETH");
  assert.equal(formatEth(0n), "0 ETH");
});

test("every shipped example screens to its expected verdict", () => {
  assert.ok(EXAMPLES.length >= 6);
  for (const ex of EXAMPLES) {
    const r = screenTransaction(ex.input);
    assert.equal(r.verdict, ex.expectedVerdict, `example ${ex.id} should be ${ex.expectedVerdict}, got ${r.verdict}`);
  }
});

test("HTTP: /health 200, /api/screen round-trips, bad input 400, bad JSON 400", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: "wallet-guard", version: "1.0.0" });

    const ok = await fetch(`${base}/api/screen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(EXAMPLES[0].input),
    });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).verdict, "high");

    const bad = await fetch(`${base}/api/screen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "nope", value: "0" }),
    });
    assert.equal(bad.status, 400);

    const badJson = await fetch(`${base}/api/screen`, { method: "POST", body: "{oops" });
    assert.equal(badJson.status, 400);

    const examples = await fetch(`${base}/api/examples`);
    assert.equal(examples.status, 200);
    assert.equal((await examples.json()).examples.length, EXAMPLES.length);

    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /Wallet Guard/);

    const missing = await fetch(`${base}/nope`);
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
