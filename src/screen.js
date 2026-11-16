// Wallet Guard — read-only screening of an EVM transaction request.
//
// This module NEVER signs, sends, or simulates a transaction, never touches
// funds, never asks for keys, and makes no network calls. It only reads the
// three fields a wallet shows before signing (to, value, calldata) and
// explains what they mean in plain words.
//
// Design notes:
// - No address allowlist ships with this tool on purpose: every spender is
//   reported as unverified, and the caller is told to check it independently.
//   A baked-in list would go stale and would teach users to trust the list
//   instead of checking.
// - Token amounts are reported in raw base units. The tool does not know a
//   token's decimals, so it never claims "250 tokens" — only the raw number.
//   Native value is reported in wei and in ETH (native currency always has
//   18 decimals).
// - Only leading fixed-size arguments are decoded. Functions with dynamic
//   arguments (arrays, bytes) get their leading fixed words decoded and a
//   note that the rest is not unpacked.

export const MAX_UINT256 = (1n << 256n) - 1n;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_RE = /^0x(?:[0-9a-fA-F]{2})*$/;

// Selectors verified with `cast sig` (Foundry) 2026-11-16. `args` lists the
// fixed-size arguments decoded from the leading calldata words, in order.
// `rest: "dynamic"` means further arguments exist but are not decoded.
export const SELECTORS = {
  "095ea7b3": { name: "approve", signature: "approve(address,uint256)", kind: "approval", args: ["address", "uint256"] },
  "39509351": { name: "increaseAllowance", signature: "increaseAllowance(address,uint256)", kind: "approval", args: ["address", "uint256"] },
  "a457c2d7": { name: "decreaseAllowance", signature: "decreaseAllowance(address,uint256)", kind: "approval-decrease", args: ["address", "uint256"] },
  "a9059cbb": { name: "transfer", signature: "transfer(address,uint256)", kind: "transfer", args: ["address", "uint256"] },
  "23b872dd": { name: "transferFrom", signature: "transferFrom(address,address,uint256)", kind: "transfer", args: ["address", "address", "uint256"] },
  "a22cb465": { name: "setApprovalForAll", signature: "setApprovalForAll(address,bool)", kind: "approval-all", args: ["address", "bool"] },
  "40c10f19": { name: "mint", signature: "mint(address,uint256)", kind: "mint", args: ["address", "uint256"] },
  "42966c68": { name: "burn", signature: "burn(uint256)", kind: "burn", args: ["uint256"] },
  "38ed1739": { name: "swapExactTokensForTokens", signature: "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)", kind: "swap", args: ["uint256", "uint256"], rest: "dynamic" },
  "18cbafe5": { name: "swapExactTokensForETH", signature: "swapExactTokensForETH(uint256,uint256,address[],address,uint256)", kind: "swap", args: ["uint256", "uint256"], rest: "dynamic" },
  "7ff36ab5": { name: "swapExactETHForTokens", signature: "swapExactETHForTokens(uint256,address[],address,uint256)", kind: "swap", args: ["uint256"], rest: "dynamic" },
  "d0e30db0": { name: "deposit", signature: "deposit()", kind: "wrap", args: [] },
  "2e1a7d4d": { name: "withdraw", signature: "withdraw(uint256)", kind: "wrap", args: ["uint256"] },
  "6a761202": { name: "execTransaction", signature: "execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)", kind: "executor", args: ["address", "uint256"], rest: "dynamic" },
  "b61d27f6": { name: "execute", signature: "execute(address,uint256,bytes)", kind: "executor", args: ["address", "uint256"], rest: "dynamic" },
  "ac9650d8": { name: "multicall", signature: "multicall(bytes[])", kind: "multicall", args: [], rest: "dynamic" },
};

function flag(level, code, title, detail) {
  return { level, code, title, detail };
}

/** Parse the native value field into wei (BigInt). Accepts decimal or 0x hex strings, safe integers, or undefined (= 0). */
export function parseValue(value) {
  if (value === undefined || value === null || value === "") return 0n;
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error("value must not be negative");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("value must be a non-negative safe integer or string");
    return BigInt(value);
  }
  if (typeof value === "string") {
    const s = value.trim();
    try {
      if (/^0x[0-9a-fA-F]+$/.test(s)) return BigInt(s);
      if (/^\d+$/.test(s)) return BigInt(s);
    } catch {
      // fall through to error
    }
    throw new Error("value must be a decimal or 0x-hex integer string");
  }
  throw new Error("value must be a decimal or 0x-hex integer string");
}

/** Validate and normalize calldata. Returns "" for no calldata, else lowercase 0x-hex. */
export function parseData(data) {
  if (data === undefined || data === null || data === "") return "";
  if (typeof data !== "string") throw new Error("data must be a 0x-hex string");
  const s = data.trim().toLowerCase();
  if (s === "0x") return "";
  if (!HEX_RE.test(s)) throw new Error("data must be a 0x-hex string with an even number of hex digits");
  return s;
}

export function parseTo(to) {
  if (typeof to !== "string" || !ADDRESS_RE.test(to.trim())) {
    throw new Error("to must be an EVM address (0x followed by 40 hex characters)");
  }
  return to.trim().toLowerCase();
}

/** Format wei as an ETH decimal string (native currency always has 18 decimals). */
export function formatEth(wei) {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const whole = abs / 10n ** 18n;
  const frac = (abs % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${frac ? "." + frac : ""} ETH`;
}

function readWord(hex, wordIndex) {
  // hex includes the 0x prefix (2 chars) and the 4-byte selector (8 chars):
  // word i starts at 10 + i*64.
  const start = 10 + wordIndex * 64;
  return hex.slice(start, start + 64);
}

function decodeArgs(hex, spec) {
  const args = [];
  const wordsAvailable = Math.floor((hex.length - 10) / 64);
  for (let i = 0; i < spec.args.length; i++) {
    if (i >= wordsAvailable) return { args, truncated: true };
    const word = readWord(hex, i);
    const type = spec.args[i];
    if (type === "address") {
      args.push({ type, value: "0x" + word.slice(24) });
    } else if (type === "uint256") {
      args.push({ type, value: BigInt("0x" + word).toString() });
    } else if (type === "bool") {
      args.push({ type, value: BigInt("0x" + word) !== 0n });
    }
  }
  return { args, truncated: false };
}

/**
 * Screen a transaction request. Input: { to, value, data }.
 * Returns { verdict: "safe"|"caution"|"high", summary, flags, decoded }.
 * Throws Error on malformed input (caller maps to HTTP 400).
 */
export function screenTransaction(input) {
  if (typeof input !== "object" || input === null) throw new Error("body must be a JSON object");
  const to = parseTo(input.to);
  const value = parseValue(input.value);
  const data = parseData(input.data);

  const flags = [];
  let decoded = null;

  if (to === ZERO_ADDRESS) {
    flags.push(flag("high", "ZERO_ADDRESS_RECIPIENT", "Recipient is the zero address",
      "Anything sent to the zero address is unrecoverable. No contract or wallet controls it, so funds or tokens sent here are lost forever."));
  }

  if (data === "") {
    if (value > 0n) {
      flags.push(flag("medium", "PLAIN_TRANSFER", `Plain transfer of ${value.toString()} wei (${formatEth(value)})`,
        "This sends native currency with no contract call attached. The recipient gets the funds directly, and the transfer cannot be reversed. Double-check the recipient address character by character before signing."));
    } else {
      flags.push(flag("info", "EMPTY_CALL", "Empty call — sends nothing, calls nothing",
        "No value and no calldata. Signing this does nothing on-chain except spend gas."));
    }
    return finish(value, flags, decoded);
  }

  const byteLen = (data.length - 2) / 2;
  if (byteLen < 4) {
    flags.push(flag("medium", "SHORT_CALLDATA", "Calldata is too short to name a function",
      "The first 4 bytes of calldata name the function being called. This calldata is shorter than 4 bytes, so the call cannot be identified. Do not sign what cannot be read."));
    return finish(value, flags, decoded);
  }

  const selector = data.slice(2, 10);
  const spec = SELECTORS[selector];
  if (!spec) {
    const level = value > 0n ? "high" : "medium";
    flags.push(flag(level, "UNKNOWN_SELECTOR", `Unknown function 0x${selector}`,
      "This function selector is not in the known list, so the call cannot be explained. It may be perfectly legitimate — or it may not. " +
      (value > 0n ? "It also moves native currency, which raises the stakes. " : "") +
      "Do not sign a call you cannot read; check the function on a block explorer first."));
    decoded = { selector: "0x" + selector, name: null, signature: null, args: [], note: "Selector not recognized; arguments not decoded." };
    return finish(value, flags, decoded);
  }

  const { args, truncated } = decodeArgs(data, spec);
  decoded = {
    selector: "0x" + selector,
    name: spec.name,
    signature: spec.signature,
    args: args.map((a, i) => ({ name: `arg${i}`, ...a })),
    ...(spec.rest ? { note: "Only the leading fixed-size arguments are decoded; dynamic arguments (arrays/bytes) are not unpacked." } : {}),
  };
  if (truncated) {
    flags.push(flag("medium", "MALFORMED_ARGS", `${spec.name} calldata ends before all arguments`,
      `The call names ${spec.name}, but the calldata is too short to hold every argument of ${spec.signature}. A well-formed wallet request would not look like this.`));
    return finish(value, flags, decoded);
  }

  const arg = (i) => args[i].value;

  switch (spec.kind) {
    case "approval": {
      const spender = arg(0);
      const amount = BigInt(arg(1));
      if (amount === MAX_UINT256) {
        flags.push(flag("high", "UNLIMITED_APPROVAL", "UNLIMITED approval — spender can drain your full balance",
          `This approves ${spender} to move ALL of your tokens of this kind — your entire current balance and anything you receive later — until you revoke it. Unlimited approvals are the single most common way wallets get drained. Prefer an exact amount, and revoke afterwards if you proceed.`));
      } else if (amount === 0n) {
        flags.push(flag("info", "ZERO_APPROVAL", "Approval set to zero (revoke)",
          `This sets ${spender}'s allowance to zero, removing its permission to move your tokens. This is the safe direction.`));
      } else {
        flags.push(flag("medium", "LIMITED_APPROVAL", `Approval of ${amount.toString()} base units`,
          `This lets ${spender} move up to ${amount.toString()} base units of this token on your behalf. The amount is capped, but the permission stays until spent or revoked.`));
      }
      if (amount > 0n) {
        flags.push(flag("medium", "SPENDER_UNVERIFIED", "Spender is unverified",
          "This tool ships with no list of known contracts, so every spender is unverified by design. Confirm the spender address independently — on the project's own docs or a block explorer — before signing any approval."));
      }
      break;
    }
    case "approval-decrease": {
      flags.push(flag("info", "DECREASE_ALLOWANCE", "Allowance decreased",
        `This lowers ${arg(0)}'s allowance by ${arg(1)} base units. Reducing a permission is the safe direction.`));
      break;
    }
    case "approval-all": {
      const approved = arg(1);
      if (approved === true) {
        flags.push(flag("high", "APPROVAL_FOR_ALL_ON", "Operator approved for ALL your tokens of this collection",
          `${arg(0)} would be allowed to move every token you hold in this collection — not one item, all of them — until you revoke it. This is the approval behind most NFT thefts. Only approve operators you fully trust.`));
        flags.push(flag("medium", "SPENDER_UNVERIFIED", "Operator is unverified",
          "This tool ships with no list of known contracts, so every operator is unverified by design. Confirm the operator address independently before signing."));
      } else {
        flags.push(flag("info", "APPROVAL_FOR_ALL_OFF", "Operator approval revoked",
          `This removes ${arg(0)}'s permission to move your tokens in this collection. This is the safe direction.`));
      }
      break;
    }
    case "transfer": {
      const recipient = spec.name === "transfer" ? arg(0) : arg(1);
      const amount = spec.name === "transfer" ? arg(1) : arg(2);
      flags.push(flag("info", "TOKEN_TRANSFER", `Moves ${amount} base units to ${recipient}`,
        "A direct token move. The amount is fixed and the recipient is named in the call — verify the recipient, then this is an ordinary transfer."));
      break;
    }
    case "mint": {
      flags.push(flag("medium", "MINT_CALL", `Mints ${arg(1)} base units to ${arg(0)}`,
        "This creates new tokens out of nothing and assigns them to the named address. Only the token's minter should ever be able to call this — if you did not expect a mint, stop."));
      break;
    }
    case "burn": {
      flags.push(flag("info", "BURN_CALL", `Burns ${arg(0)} base units permanently`,
        "Burned tokens are destroyed and cannot be recovered. The amount is fixed, so check it once and this is an ordinary burn."));
      break;
    }
    case "swap": {
      const amountIn = spec.name === "swapExactETHForTokens" ? value : BigInt(arg(0));
      const minOut = spec.name === "swapExactETHForTokens" ? BigInt(arg(0)) : BigInt(arg(1));
      flags.push(flag("medium", "SWAP_CALL", `Token swap: in ${amountIn.toString()} base units, minimum out ${minOut.toString()} base units`,
        "A swap exchanges one asset for another through a router. This tool does not check the route, the slippage, or the deadline — the minimum-out amount is your only protection against a bad price, so read it carefully. The routing path is not decoded here."));
      break;
    }
    case "wrap": {
      if (spec.name === "deposit") {
        flags.push(flag("info", "WRAP_CALL", `Wraps ${value.toString()} wei (${formatEth(value)}) into wrapped native currency`,
          "Wrapping locks native currency and mints the same amount of its wrapped token to you. Reversible via withdraw."));
      } else {
        flags.push(flag("info", "WRAP_CALL", `Unwraps ${arg(0)} base units back to native currency`,
          "Unwrapping burns wrapped tokens and releases the same amount of native currency to you."));
      }
      break;
    }
    case "executor": {
      flags.push(flag("high", "EXECUTOR_CALL", "Arbitrary execution — this call can do almost anything",
        `${spec.name} executes an inner call chosen by its arguments, which this tool does not unpack. The inner call could move funds, change permissions, or anything else the calling contract is allowed to do. Never sign an executor call unless you have read the inner call yourself.`));
      break;
    }
    case "multicall": {
      flags.push(flag("high", "MULTICALL", "Batched calls — several actions in one transaction",
        "Multicall runs a list of inner calls in one transaction. This tool does not unpack that list, so the real actions are hidden behind this single call. Read every inner call before signing."));
      break;
    }
  }

  if (value > 0n && (spec.kind === "approval" || spec.kind === "transfer" || spec.kind === "approval-decrease")) {
    flags.push(flag("medium", "VALUE_WITH_TOKEN_CALL", `Sends ${value.toString()} wei (${formatEth(value)}) along with a token call`,
      "Token approvals and transfers normally move no native currency. Sending value at the same time is unusual — check why this call needs native currency before signing."));
  }

  return finish(value, flags, decoded);
}

function finish(_value, flags, decoded) {
  const verdict = flags.some((f) => f.level === "high")
    ? "high"
    : flags.some((f) => f.level === "medium")
      ? "caution"
      : "safe";
  const summary =
    verdict === "high"
      ? "HIGH RISK — at least one flag needs your full attention before signing."
      : verdict === "caution"
        ? "CAUTION — read the flags below before signing."
        : "No risk flags raised by the checks in this tool. That is not a guarantee — see the limits in the README.";
  return { verdict, summary, flags, decoded };
}
