// Preset examples for Wallet Guard. All addresses are synthetic repeating
// patterns (0x1111..., 0x2222..., 0x3333...) — placeholders, not real
// wallets. Calldata is built here with the same ABI word layout the screener
// decodes, so the examples double as fixtures for the test suite.

const A_TOKEN = "0x1111111111111111111111111111111111111111";
const B_SPENDER = "0x2222222222222222222222222222222222222222";
const C_RECIPIENT = "0x3333333333333333333333333333333333333333";

export function padAddress(addr) {
  return "0".repeat(24) + addr.slice(2).toLowerCase();
}

export function padUint(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

export function padBool(b) {
  return (b ? "1" : "0").padStart(64, "0");
}

function build(selector, words) {
  return "0x" + selector + words.join("");
}

const MAX_U256 = (1n << 256n) - 1n;

export const EXAMPLES = [
  {
    id: "unlimited-approval",
    name: "Unlimited approval — HIGH",
    description: "approve() with the maximum uint256 amount. The classic drain setup.",
    input: {
      to: A_TOKEN,
      value: "0",
      data: build("095ea7b3", [padAddress(B_SPENDER), padUint(MAX_U256)]),
    },
    expectedVerdict: "high",
  },
  {
    id: "plain-transfer",
    name: "Plain transfer of 1 ETH — CAUTION",
    description: "Native currency with no calldata. Irreversible; the recipient is everything.",
    input: { to: B_SPENDER, value: "1000000000000000000", data: "0x" },
    expectedVerdict: "caution",
  },
  {
    id: "normal-transfer",
    name: "Ordinary token transfer — SAFE",
    description: "transfer() of a fixed amount to a named recipient. No risk flags.",
    input: {
      to: A_TOKEN,
      value: "0",
      data: build("a9059cbb", [padAddress(C_RECIPIENT), padUint(250n * 10n ** 18n)]),
    },
    expectedVerdict: "safe",
  },
  {
    id: "approval-for-all",
    name: "setApprovalForAll(true) — HIGH",
    description: "One operator approved for every token in a collection.",
    input: {
      to: A_TOKEN,
      value: "0",
      data: build("a22cb465", [padAddress(B_SPENDER), padBool(true)]),
    },
    expectedVerdict: "high",
  },
  {
    id: "unknown-selector",
    name: "Unknown function — CAUTION",
    description: "A selector the tool does not recognize. If you cannot read it, do not sign it.",
    input: {
      to: A_TOKEN,
      value: "0",
      data: build("deadbeef", [padAddress(C_RECIPIENT), padUint(1n)]),
    },
    expectedVerdict: "caution",
  },
  {
    id: "swap",
    name: "Token swap — CAUTION",
    description: "swapExactTokensForTokens with a minimum-out amount. Route and slippage are not checked.",
    input: {
      to: B_SPENDER,
      value: "0",
      data: build("38ed1739", [padUint(100n * 10n ** 18n), padUint(90n * 10n ** 18n), padUint(160n), padAddress(C_RECIPIENT), padUint(1794800000n)]),
    },
    expectedVerdict: "caution",
  },
];
