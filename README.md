# Wallet Guard

A web tool that reads an EVM transaction request **before you sign it** and
explains the risk in plain words: what function is being called, with what
arguments, and which of those facts should make you stop and think.

Built for the zkVerify Agent Games Wildcard track. It screens transaction
requests; it makes no decisions for any competition agent and generates no
proofs.

## The problem behind it

A wallet's signing prompt shows a recipient address, a value, and a wall of
hex. Most people cannot read the hex, so they sign on trust — and the most
expensive mistakes in crypto are approvals: one unlimited `approve()` lets a
spender drain a wallet's full token balance, and one `setApprovalForAll(true)`
hands over an entire NFT collection. Both look like any other signature
request. Wallet Guard decodes the calldata into the sentence the wallet
never shows you: *this approves an unverified spender to move ALL of your
tokens, forever, until you revoke it.*

## What it does

- `POST /api/screen` — accepts `{ to, value, data }` and returns a verdict
  (`safe`, `caution`, `high`), a one-line summary, a list of flags with
  plain-language explanations, and the decoded call.
- `GET /api/examples` — six presets covering the main risk shapes.
- `GET /` — single-page UI: paste the three fields, pick a preset, get the
  verdict with a per-flag breakdown.
- `GET /health` — liveness probe.

### Flags

- **Unlimited approval** (high): `approve` / `increaseAllowance` with
  `type(uint256).max` — the spender can drain the full balance, now and
  later, until revoked.
- **Unverified spender** (medium): every approval spender, because this tool
  ships with no address list — the user is told to verify the spender
  independently.
- **Plain transfer** (medium): native value with no calldata — irreversible,
  so the recipient address is everything.
- **Approval for all** (high): `setApprovalForAll(true)` — one operator for
  every token in a collection.
- **Risky selectors** (high/medium): executor calls (`execTransaction`,
  `execute`), `multicall` batches, swaps (route/slippage not checked),
  mints, and unknown selectors — plus a higher verdict when an unknown
  function also moves value.
- **Malformed input** (medium / HTTP 400): calldata too short for a selector
  or for its declared arguments, invalid addresses, bad hex.

## Key decisions

- **Read-only by construction.** Zero dependencies, no signing library, no
  key handling, no chain RPC, no external network calls at all. There is
  nothing in the code that *could* send a transaction.
- **No address allowlist.** A baked-in list of "known" contracts would go
  stale and teach users to trust the list instead of checking. Every
  spender is reported unverified, and the flag text says how to verify.
- **Raw base units for tokens.** The tool does not know a token's decimals,
  so it reports the raw amount and never claims a human token count. Native
  value is shown in wei and ETH (always 18 decimals).
- **Only leading fixed arguments are decoded.** Functions with dynamic
  arguments (arrays, bytes) get their leading fixed words decoded and an
  explicit note that the rest is not unpacked. The tool says what it did
  not read.
- **No logging of request contents.** The access log records method, path,
  status, and duration only. Pasted addresses and calldata are never
  logged, and nothing is persisted. Body cap: 64 KB.

## Limits (read before trusting a "safe" verdict)

- A "safe" verdict means *no flag was raised by these checks* — it is not a
  guarantee. The known-selector list is small; a legitimate function outside
  it is reported as unknown, and a malicious function that reuses a known
  selector shape is still only judged by its arguments.
- The tool cannot tell whether an address is a contract or an externally
  owned account, cannot check token balances or allowances, and cannot
  verify what a contract actually does — it reads the request, not the
  chain. Nothing here replaces checking the contract on a block explorer.
- Swap routing, slippage, deadlines, and multicall/executor inner calls are
  not unpacked; those flags say so explicitly.
- Selectors were verified with `cast sig` (Foundry). The list covers the
  common ERC-20/ERC-721 and router functions; anything else is "unknown"
  by design.

## Run it

```sh
npm test     # test suite (no network needed)
npm start    # serves on $PORT (default 3000)
```

Deployed on Railway from this public repo with no environment variables.

## License

MIT.
