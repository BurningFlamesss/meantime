# AGENTS.md — Instructions for AI Coding Agents

This file is the operating manual for any AI agent working in this repository.
Read it before editing code. When in doubt, preserve the product invariants in
§3 over local convenience.

**Read order:** `AGENTS.md` → `PRD.md` → `ARCHITECTURE.md` → `DESIGN-SYSTEM.md` →
`TASKS.md` → the files you intend to change.

---

## 1. Repository at a glance

```
meantime/
├── apps/
│   ├── api/          Fastify 5 API (auth, ads, telemetry, ledger, payouts)
│   ├── web/          TanStack Start + React 19 + Tailwind web app
│   └── extension/    WXT Manifest V3 extension (background + content + popup)
├── packages/
│   └── shared/       Types, zod validators, WebCrypto, Drizzle schema, configs
├── infra/
│   ├── laya-stub/    Offline test double for Laya's /v1/systemone protocol
│   └── laya-host.sh  Run the real Laya server without Docker
├── docker-compose.yml
├── drizzle.config.ts
├── turbo.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

- Package manager: **pnpm 9** (`packageManager` is pinned).
- Node: **>=20** (CI/authoring used Node 26).
- Monorepo runner: **Turborepo**.
- Language: **TypeScript strict** with `noUncheckedIndexedAccess`.
- Module system: ESM (`"type": "module"` in every workspace).

---

## 2. Commands

Run from the repository root unless noted.

```bash
# Install (required after changing package.json)
pnpm install

# Type generation for WXT (required once per clone / after wxt config changes)
pnpm --filter @meantime/extension exec wxt prepare

# Typecheck all workspaces
pnpm typecheck

# Build all workspaces
pnpm build

# Development
pnpm dev                                  # turbo: all workspaces
pnpm --filter @meantime/api dev           # tsx watch, port 3001
pnpm --filter @meantime/web dev           # vite dev, port 3000
pnpm --filter @meantime/extension dev     # WXT dev

# Database
pnpm db:generate                          # drizzle-kit generate
pnpm db:migrate                           # apply migrations
pnpm db:seed                              # demo advertiser + campaigns

# Production-shaped local run
pnpm --filter @meantime/api start
pnpm --filter @meantime/web start
```

### Command gotchas

- `wxt prepare` creates `apps/extension/.wxt/tsconfig.json`; without it the
  extension typecheck fails with `TS5083`.
- `pnpm build` builds `@meantime/shared` first. The shared package's `exports`
  point at `dist/`; production `node` cannot execute the raw TypeScript source.
- `pnpm dev` uses Turbo `dependsOn: ["^build"]`, so shared is built before dev
  servers start. A standalone `tsx` invocation that ignores package exports may
  still work, but do not rely on it.
- The web `start` script uses `srvx`:
  `srvx serve --prod --entry dist/server/server.js --static ../client`.
  The static path is resolved relative to the server entry directory. Do not
  change it back to `.output/server/index.mjs`; that path is not produced.
- `drizzle-kit` runs with its own bundled drizzle-orm. Use `import { sql } from
  "drizzle-orm"` (not from `drizzle-orm/pg-core`) for SQL defaults.
- Docker is not guaranteed to be installed in the agent environment. If it is
  missing, report it clearly instead of pretending compose ran.

---

## 3. Non-negotiable product invariants

Do not change these without an explicit product decision and corresponding doc
updates.

1. **Revenue split is 55% user / 45% platform** (`REVENUE_SHARE`).
2. **A verified view is 5,000 ms of cumulative active viewport time**
   (`MIN_VIEWABLE_MS`).
3. **An ad must be ≥75% visible, the page visible, and the window focused** to
   accrue time (`VIEWABILITY_THRESHOLD`).
4. **Prompt text is never read, stored, or transmitted.** PoHI may count trusted
   keystrokes/pastes but must not inspect values.
5. **Raw IPs are never stored or returned.** Resolve to a coarse geo cluster in
   memory; hash for equality checks only. (`users.signupIp` is a known legacy
   violation — do not add more.)
6. **Every paid impression needs a valid, single-use HMAC lease.** Never trust a
   client-reported `earned` flag.
7. **Money is integer micro-dollars** (`$1 = 1_000_000`). Never use floats for
   ledger amounts.
8. **The ledger is double-entry.** Every credit has a matching debit; balances
   are sums, not mutable columns.
9. **Moderation fails closed.** Classifier unavailable ⇒ `needs_review`, never
   `auto_approved`.
10. **Policy checks run before the classifier** and can hard-reject clear abuse.
11. **A/B variants share the campaign budget and bid.** Maximum 3 creatives
    total (base A + B + C).
12. **One ad at a time per tab.** No stacking.
13. **Ads are text-only and always labelled.** No images, video, audio, or
    disguised native placement.
14. **The extension must fail silent** when it cannot mount an ad or reach the
    API. Never show a broken container.
15. **Referral bonuses vest only after $1.00 of verified earnings** by the
    referred user.

---

## 4. Coding conventions

### TypeScript

- Strict mode is on. Do not add `any`, `@ts-ignore`, or non-null assertions to
  silence real errors. Prefer narrowing, zod parsing, or explicit guards.
- Respect `noUncheckedIndexedAccess`: array/record access returns `T | undefined`.
- Keep ESM imports explicit. In `apps/api` and `packages/shared`, relative
  imports use the `.js` extension (NodeNext build). In web/extension, follow the
  local style (extension also uses `.js`-less relative imports because WXT
  bundles them).
- Export types from `packages/shared` rather than duplicating contracts.
- Validate untrusted input with zod at HTTP boundaries (`*.parse(req.body)`).

### Package boundaries

- `packages/shared` must not import from `apps/*`.
- `apps/web` and `apps/api` must not import each other.
- The extension may import `@meantime/shared`; keep the content-script bundle
  free of Node-only dependencies.
- Do not add a runtime dependency to the extension content script unless the
  bundle-size and MV3 constraints are explicitly considered.

### Database

- The schema source of truth is `packages/shared/src/db/schema.ts`.
- After schema changes: `pnpm db:generate`, inspect the generated SQL in
  `apps/api/drizzle/`, then `pnpm db:migrate`.
- Never hand-edit generated migration snapshots.
- Use `bigint(..., { mode: "bigint" })` for money and SQL defaults
  (`.default(sql\`0\`)`) rather than BigInt literals (`0n`), which break
  drizzle-kit serialization.
- Add indexes for new query paths; follow existing naming
  (`<table>_<purpose>_idx` / `_uidx`).
- Transactions for any multi-row financial or state change.

### API

- Register routes in `src/index.ts`; keep route modules focused.
- Use `requireUser` / `requireAdvertiser` for auth; never read a user id from
  the request body.
- Return typed shapes from `@meantime/shared` where they exist.
- Use `ctx.db.transaction` for ledger + state updates together.
- Log fraud signals through `logFraud` with a stable `rule` name.
- Never log secrets, raw IPs, prompt text, or bearer tokens.
- Error handler: zod errors → 400 `validation_failed`; everything else → 500
  `internal_error`. Do not leak stack traces to clients.

### Web

- Routes are file-based in `src/routes`; `routeTree.gen.ts` is generated by
  TanStack Router — **do not hand-edit it**.
- Use the primitives in `src/lib/ui.tsx` and the shell in `src/lib/shell.tsx`
  before creating new visual patterns.
- Follow `DESIGN-SYSTEM.md`: neutral palette, one accent, borders over shadows,
  tabular money, sentence case.
- API calls go through `src/lib/api.ts`; do not scatter raw `fetch` calls.
- Add a loading placeholder (`—`) and an inline error; do not add a toast system
  for v0.1.
- Client-only state is fine; the app is SSR-rendered but data loads in
  `useEffect`.

### Extension

- Content-script code runs in an isolated world; use `textContent`, never
  `innerHTML`, for ad copy.
- Keep the widget in a **closed** Shadow DOM.
- Trigger listeners must be passive and capture-only; do not prevent default.
- Do not add a document-wide `MutationObserver`. The generation observer is
  scoped to the response region and must always be torn down (3-minute hard
  cap).
- The widget timer must survive tab switches by pausing, not resetting.
- All persistent state goes through `lib/storage.ts`; keys are centralized in
  `STORAGE_KEYS`.
- Bound every cache/queue. The ad cache max is 25; the telemetry queue restore
  cap is 200.
- The service worker may be suspended at any time; do not keep critical state
  only in memory.
- Never add permissions beyond `storage`, `alarms`, `idle` without a product
  decision and doc update.

### Moderation

- Policy checks are deterministic and must run before any network call.
- Keep the 4s classifier timeout.
- A non-OK response, malformed body, timeout, or exception must return `null`
  and route to `needs_review`.
- Reputation adjustments are capped and must not rescue hard-rejected content.
- The real classifier is open-source Laya (`laya-serve`, TypeSafe Jev
  `/v1/systemone`), not a chat model. Keep the request/response mapping in
  `apps/api/src/moderation/laya.ts` aligned with upstream.
- Ask one neutral `choice` question: ads over `legitimate_ad` / `low_quality` /
  `deceptive` / `fraud`, tasks over `normal` / `promo` / `phishing` / `fraud`.
  Do not reintroduce per-offence `noul` questions; the real checkpoint scores
  essentially every ad as spam.
- Laya is text-only. It can judge ad copy and links, not task screenshots; do
  not auto-approve a screenshot-bearing task on a text-only verdict.
- The local `infra/laya-stub` is an offline test double, not a production
  classifier. Do not describe it as a real ML model.

### Style

- Prettier is available; match surrounding formatting (2-space indent, double
  quotes, semicolons, trailing commas).
- Prefer small, pure functions for fraud/cadence logic.
- Name booleans positively (`eligible`, `verified`), and use domain terms from
  the shared types.
- Keep comments for *why*, not *what*. Existing comments explain invariants and
  trade-offs; preserve that style.

---

## 5. What not to touch

| Path | Reason |
|---|---|
| `apps/web/src/routeTree.gen.ts` | Generated by TanStack Router. |
| `apps/extension/.wxt/**` | Generated by WXT. |
| `apps/api/drizzle/**` | Generated by drizzle-kit (safe to regenerate, not to hand-edit). |
| `dist/**`, `.output/**`, `.turbo/**` | Build artifacts. |
| `pnpm-lock.yaml` | Only change via pnpm; never hand-edit. |
| `package-lock.json` | Not the project lockfile; do not add it to the workflow. |
| `.env` / `.env.*` | Never commit secrets. Update `.env.example` instead. |

---

## 6. Workflow for a change

1. **Understand the surface.** Read the relevant route/module and the shared
   contract it uses. Check `TASKS.md` for known gaps.
2. **Decide whether shared types change.** If yes, update
   `packages/shared/src` first and rebuild.
3. **Implement in the owning workspace.** Keep cross-workspace edits minimal.
4. **Update docs** when behaviour, scope, API shape, or design tokens change:
   `PRD.md` (requirements), `ARCHITECTURE.md` (system/data flow),
   `DESIGN-SYSTEM.md` (visual rules), `TASKS.md` (status).
5. **Run the checks:**
   ```bash
   pnpm --filter @meantime/extension exec wxt prepare   # first time only
   pnpm typecheck
   pnpm build
   ```
6. **If the DB changed:** `pnpm db:generate`, inspect SQL, then migrate against
   a disposable database.
7. **If UI changed:** run the web dev server and check desktop + narrow widths.
   If the extension changed: rebuild and load
   `apps/extension/.output/chrome-mv3` unpacked.
8. **Report what you verified** and what you could not (e.g. no Docker).
9. **Commit** with a focused message. Do not mix refactors with behaviour
   changes.

---

## 7. Testing expectations

There is currently **no automated test suite**. Do not claim tests pass unless
you added and ran them.

When adding tests, prefer:

- **Unit:** pure fraud/cadence math, lease crypto, validators, formatting.
- **Integration:** API routes against a disposable Postgres, with Redis optional
  (the code has a DB fallback).
- **E2E:** web routes with Playwright; extension with Chrome loaded unpacked
  (harder — start with unit tests for cache/dedup/timer logic).

Minimum manual smoke test for API changes:

```bash
curl -s http://localhost:3001/health
# register
curl -s -X POST http://localhost:3001/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"test@example.com","password":"correct-horse-battery"}'
# use the returned accessToken as Authorization: Bearer <token>
curl -s http://localhost:3001/me/balance -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://localhost:3001/ads/prefetch \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"deviceId":"device-12345678","count":5,"platforms":["openai"]}'
```

---

## 8. Security and privacy rules for agents

- Never print, commit, or transmit real secrets. Use `.env.example` placeholders.
- Do not weaken token verification, lease signing, timing-safe comparison, or
  single-use enforcement.
- Do not add third-party analytics, pixels, or telemetry SDKs.
- Do not add prompt-text capture "for debugging".
- Do not store raw IPs or user agents beyond what the schema already has.
- Do not add a path that auto-approves moderation on network failure.
- Do not bypass the payout threshold, trust score, or address-uniqueness check.
- If a task requires a security trade-off, stop and document it in `TASKS.md`
  and `ARCHITECTURE.md` rather than silently choosing.

---

## 9. Known gaps (do not build on broken assumptions)

These are real gaps in the current repository. Check whether they still apply
before relying on the related flow:

- Reviewer access is a shared operator key, not per-reviewer accounts.
- No payout processor settlement.
- No unit/integration test suite. `scripts/smoke.mjs` (`pnpm smoke`) covers the
  API surface end to end (advertiser sessions, moderation, payment, referral
  vesting); web and extension checks are still manual.
- Task-proof image contents are not analysed by the text-only Laya model; only
  upload existence/type/size is validated, so approval still needs a human.
- `users.signupIp` stores a raw IP (legacy).
- Prefetch performs N+1 variant queries.
- `@meantime/shared` must be built before production start.

If you fix one of these, update `TASKS.md` and the relevant docs in the same
change.

---

## 10. Definition of done

A change is done when:

- [ ] It preserves every invariant in §3.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm build` passes.
- [ ] New untrusted input is validated.
- [ ] Financial changes are transactional and balanced.
- [ ] Privacy boundaries are intact.
- [ ] UI follows `DESIGN-SYSTEM.md`.
- [ ] Relevant docs and `TASKS.md` are updated.
- [ ] The final response states exactly what was run, what passed, and what
      could not be verified.
