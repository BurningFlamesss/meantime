# MeanTime — Tasks and Roadmap

**Last updated:** 2026-11-03 (verification run)  
**Status legend:** `[x]` done · `[~]` partial · `[ ]` not started · `[!]` blocked  
**Priority:** P0 = required for a testable end-to-end demo · P1 = required for
private beta · P2 = post-launch / polish

---

## 0. Current snapshot

| Area | Status | Evidence |
|---|---|---|
| Shared contracts, schema, crypto, selectors | `[x]` | `pnpm typecheck` + `pnpm build` pass. |
| Fastify API and fraud engine | `[x]` verified | Against PostgreSQL 18: register/login, prefetch, telemetry (verified, replay, forged lease, low PoHI, below threshold), balance, impressions, referrals, tasks presign, payouts threshold, advertiser create/list/variants/stats/analytics/click. |
| TanStack Start web app | `[x]` code / `[~]` auth | Production SSR bundle serves all routes with 200. Authenticated routes still need a manually set token (T-01). |
| WXT extension | `[x]` build | `.output/chrome-mv3` builds (169.56 KB). Not loaded in Chrome. |
| Database migrations | `[x]` applied | `apps/api/drizzle/0000_uneven_tag.sql`, 17 tables, applied to PostgreSQL 18. |
| Demo seed | `[x]` run | 1 advertiser + 2 active campaigns inserted. |
| Docker compose | `[!]` not run | Docker is not installed in the authoring environment (no root, no Docker socket). Verified with an embedded PostgreSQL + host-run Laya instead. |
| Laya moderation | `[x]` real model | The pinned upstream `v0.4.21` `laya-serve` was run from source with CPU torch and the English checkpoint on `:8000`. Clean copy → 92/`auto_approved`, crypto/prize scams → 0–36/`auto_rejected`, clean task link → `needs_review`. The Docker image itself is still unbuilt. |
| Automated tests | `[ ]` | No test suite exists. |
| Auth/onboarding UX | `[ ]` | Blocks a true end-to-end demo. |

---

## 1. Completed

### Phase 1 — Database schema and shared contracts

- [x] 17-table Drizzle schema with enums, indexes, and foreign keys.
- [x] Money as `bigint` micro-dollars.
- [x] zod validators for auth, prefetch, telemetry, campaigns, tasks, payouts,
      and clicks.
- [x] HMAC-SHA256 lease signing/verification on WebCrypto.
- [x] Shared constants for revenue split, viewability, pacing, cadence, trust,
      cache, telemetry, and moderation.
- [x] Platform selector configs for five AI platforms.
- [x] Double-entry ledger helpers.

### Phase 2 — Extension core and multi-LLM adapters

- [x] WXT MV3 background service worker.
- [x] Idle/startup prefetch with ring-buffer cache and low-water mark.
- [x] Local deduplication (expiry, per-day cap, cooldown).
- [x] Passive Enter/send-button trigger detection.
- [x] Five platform adapters plus scoped Grok `x.com/i/grok` matching.
- [x] Closed Shadow DOM ad widget with progress, earned badge, CTA, dismiss,
      snooze menu, and placement options.
- [x] Cumulative viewport timer (IntersectionObserver + visibility + focus).
- [x] Intentional hover tracking (500 ms gate).
- [x] PoHI keystroke/paste counters (no prompt text).
- [x] Batched telemetry queue with deflate compression.
- [x] Popup settings, cache/pending/balance stats.

### Phase 3 — Backend API and anti-fraud engine

- [x] Fastify bootstrap, CORS, compression, error handling, `/health`.
- [x] Environment validation.
- [x] Register/login with Argon2 and HMAC bearer tokens.
- [x] Prefetch with pacing, platform/geo targeting, budget filtering, A/B
      rotation, and lease issuance.
- [x] Telemetry batch ingestion with lease verification and single-use checks.
- [x] PoHI, viewport threshold, cadence, and pacing enforcement.
- [x] 55/45 revenue share through the ledger.
- [x] Campaign spend counters and lease consumption in one transaction.
- [x] Referral self-dealing checks and $1.00 vesting.
- [x] Composite trust score and payout verdicts.
- [x] Payout address uniqueness and frozen-state checks.
- [x] S3 presigned task-proof uploads.
- [x] Policy-first moderation with fail-safe classifier fallback.
- [x] Campaign analytics, per-geo breakdown, click tracking, A/B variant stats.

### Phase 4 — Web app

- [x] Landing page.
- [x] Dashboard with balance, threshold progress, and transparency log.
- [x] Task center with screenshot upload and history.
- [x] Referral page with link copy and stats.
- [x] Payouts page with method, destination, and threshold gating.
- [x] Advertiser portal with campaign creation, geo chips, moderation feedback,
      analytics, A/B variants, and geo table.
- [x] Shared UI primitives and design tokens.

### Build, tooling, and docs

- [x] `pnpm install` succeeds.
- [x] `wxt prepare` generates extension types.
- [x] `pnpm typecheck` passes all four workspaces.
- [x] `pnpm build` passes all four workspaces.
- [x] Fixed API production build (`ioredis` named import).
- [x] Fixed shared package exports to point at `dist/` so production Node runs.
- [x] Added Turbo `dev` `dependsOn: ["^build"]`.
- [x] Fixed web production start with `srvx` (SSR + static).
- [x] Fixed Drizzle config to use absolute paths.
- [x] Replaced BigInt literal defaults with SQL defaults so `db:generate` works.
- [x] Generated initial migration for 17 tables.
- [x] API production bundle boots and serves `/health`.
- [x] Web production bundle serves the landing page (HTTP 200).
- [x] Wrote `PRD.md`, `ARCHITECTURE.md`, `DESIGN-SYSTEM.md`, `AGENTS.md`,
      `TASKS.md`.
- [x] Added `apps/api/.env.example`.
- [x] Integrated the real open-source Laya classifier (`laya-serve`,
      `POST /v1/systemone`) into the moderation client and Docker compose,
      pinned to upstream `v0.4.21`.
- [x] Reworked `infra/laya-stub` into an offline test double that speaks the
      same `/v1/systemone` protocol (it is not a model).
- [x] Added MinIO bucket initializer.
- [x] Applied migrations and seed to a real PostgreSQL 18 instance.
- [x] Fixed API 500 when serializing BigInt money columns (global string
      serializer; matches the web client's `string` types).
- [x] Replaced `pgcrypto`'s `digest()` in the referral lookup with core
      `sha256(convert_to(...))` so registration works on a stock Postgres.
- [x] Blocked advertiser self-activation of `needs_review` / rejected campaigns
      (`409 moderation_required`); preserves the fail-closed invariant.
- [x] Silenced unhandled `ioredis` error events when Redis is absent.
- [x] Verified fraud layers: forged lease → `lease_bad_signature`, lease replay
      → `lease_already_consumed`, <5s view → `below_threshold`, low PoHI →
      `no_trusted_input`.
- [x] Verified ledger is balanced after a verified view (user credit + platform
      revenue = advertiser debit) and that replay does not credit twice.
- [x] Verified moderation over Laya's real `/v1/systemone` protocol: classifier
      down → `needs_review`/`draft`; clean copy → Laya verdict + reputation
      adjustment; crypto/prize scams → `auto_rejected`; suspicious TLD →
      `needs_review` with a `suspicious_tld` reason; blocked term →
      `auto_rejected` without network.
- [x] Ran the real Laya `v0.4.21` server from upstream source (Python 3.13
      venv, `torch==2.15.0+cpu`, `[serve]` extra) and downloaded the English
      checkpoint (`convaiinnovations/laya`, revision `7b928d8`, ~808 MB).
- [x] Verified `/health` reports `loaded: ["english"]` on CPU and inference
      answers in ~1.1 s after preload.
- [x] Replaced the per-offence `noul` questions with one `choice` over
      legitimate/low-quality/deceptive/fraud: against the real checkpoint the
      old questions scored **every** ad as spam (~1.0), so all campaigns were
      auto-rejected. Clean ad copy now scores 92 → `auto_approved`.
- [x] Switched task links to a neutral `normal`/`promo`/`phishing`/`fraud`
      choice and dropped the severity head from task risk; the previous
      `legitimate`/`spam` prompt labelled ordinary X and Chrome Web Store links
      as spam. Clean links now stay in `needs_review`; prize/phishing URLs are
      rejected.
- [x] Added `infra/laya-host.sh` so the real server can be run without Docker.
- [x] Updated `infra/laya-stub` to answer the same choice protocol with
      deterministic probabilities.
- [x] Hardening pass: payout requests are transactional under a user-row lock
      (concurrent withdrawals debit once); telemetry claims leases with one
      conditional UPDATE, inserts the impression as an idempotency gate, and
      enforces the campaign daily budget under a row lock; clicks require a
      valid HMAC lease and a verified impression owned by the caller; task
      rewards are unique per (user, post URL).
- [x] Added http(s)-only validation for campaign/task URLs, a global payout
      destination uniqueness index, and a screenshot-key ownership check.
- [x] Extension: stable document-level passive listeners across SPA nav,
      in-flight/mount/watchdog guards, pagehide flush, platform-targeted ads,
      and a bounded peek/ack telemetry queue with a flush lock and poison-batch
      handling.
- [x] 22/22 adversarial checks pass (replay, forged lease, duplicate
      impression, budget exhaustion, click forgery, concurrent payouts, task
      duplicates, URL/key validation, zero-sum ledger).
- [ ] Docker compose actually executed (blocked: no Docker binary/root).

---

## 2. P0 — Make the system testable end-to-end

### T-01 · Web authentication screens

- [ ] `/sign-in` and `/sign-up` routes.
- [ ] Call `POST /auth/login` / `POST /auth/register`.
- [ ] Persist `accessToken` in `localStorage["mt_token"]`.
- [ ] Redirect to `/dashboard` after auth.
- [ ] Show signed-in state in the shell; add sign-out.
- [ ] Surface API errors inline (invalid credentials, email taken).
- [ ] Capture `?ref=` / `/r/:code` into signup.

**Acceptance:** a new user can register in the web app, land on the dashboard,
and see a $1.00 pending balance without touching devtools.

### T-02 · Extension onboarding and identity bootstrap

- [ ] Popup signed-out state with email/password (or "Open web sign-in").
- [ ] Generate/persist a device id and fingerprint hash.
- [ ] Call `/auth/register` or `/auth/login` with `deviceId` +
      `fingerprintHash`.
- [ ] Store `identity` (`userId`, `deviceId`, `accessToken`, `refreshToken`,
      `tokenExpiresAt`) in `chrome.storage.local`.
- [ ] Configure the API base URL (`api_config`) for local development.
- [ ] Trigger an initial prefetch after sign-in.

**Acceptance:** a fresh extension install can sign in and receive ads without
manually editing `chrome.storage.local`.

### T-03 · Advertiser authentication

- [ ] `POST /advertiser/register` and `POST /advertiser/login`.
- [ ] Argon2 verification and `kind: "advertiser"` token.
- [ ] Web advertiser sign-in/up form.
- [ ] Persist advertiser token separately from the user token.
- [ ] Gate `/advertiser` behind advertiser auth.

**Acceptance:** the seeded advertiser (`demo@advertiser.test` /
`demo-advertiser-pass-123`) can sign in and list campaigns.

### T-04 · Referral landing and attribution

- [ ] `/r/:code` route and redirect to sign-up with code prefilled.
- [ ] Store the code in `sessionStorage`/state until registration.
- [ ] Pass `referralCode` to `/auth/register`.
- [ ] Show a clear "bonus vests after $1.00 verified earnings" explanation.

**Acceptance:** two distinct users can complete referral attribution, and the
referrer sees a pending referral in `/me/referrals`.

### T-05 · Run and validate Docker compose

- [x] Compose file defines Postgres, Redis, MinIO, bucket init, and the real
      Laya `laya-serve` service with healthchecks.
- [x] Laya integration uses upstream's `POST /v1/systemone` contract.
- [x] Offline test double under `--profile stub` speaks the same contract.
- [ ] `docker compose up -d` starts all services healthy.
- [!] The Laya container image was not built; the same upstream tag was
      installed and run natively instead (see above).
- [x] `pnpm db:migrate` succeeds against a real PostgreSQL 18 instance
      (embedded fallback, not compose).
- [x] `pnpm db:seed` inserts the demo advertiser and two campaigns.
- [ ] A document exists describing how to verify each service.
- [~] MinIO upload path only verified as far as presigned URL generation; no
      object was uploaded because MinIO was not running.

**Acceptance:** from a clean machine with Docker, the documented commands bring
up infra and seed data without manual edits.

### T-06 · End-to-end smoke script

- [ ] `scripts/smoke.mjs` (or shell) that:
  - registers a user with a device,
  - prefetches ads,
  - crafts a signed lease test event? *No — do not hand-craft production
    telemetry; use the extension.*
  - verifies `/me/balance` and `/me/impressions`,
  - creates an advertiser via seeded login (after T-03),
  - creates a campaign and reads analytics.
- [ ] Prefer a Playwright test for the web flow and a manual checklist for the
      extension.

**Acceptance:** one command reports pass/fail for the API + web surfaces.

### T-07 · Privacy cleanup

- [ ] Remove or hash `users.signupIp`; migrate existing rows.
- [x] Redact `req.remoteAddress`, `req.remotePort`, authorization, and cookie
      values from Fastify request logs.
- [ ] Add a short data-retention section to the docs.
- [ ] Document the `IP_HASH_SALT` rotation implications.

**Acceptance:** a database dump contains no raw IP addresses and logs contain no
raw IPs.

### T-08 · Make `pnpm dev` reliable from a fresh clone

- [x] Turbo `dev` builds shared first.
- [ ] Add a root `postinstall` or documented `prepare` that runs `wxt prepare`.
- [ ] Verify `pnpm dev` starts API + web without a prior manual build.

**Acceptance:** clean clone → `pnpm install` → `pnpm dev` works.

---

## 3. P1 — Private beta hardening

### Security

- [ ] Rate limiting (`@fastify/rate-limit`) on auth, prefetch, telemetry,
      payouts, and clicks.
- [ ] Persist and rotate refresh tokens; revoke sessions on password change.
- [ ] Add email verification and password reset.
- [ ] Verify the lease signature in `POST /ads/click` before recording a click.
- [ ] Use the verified lease payload in `persist()` instead of re-parsing the
      token.
- [ ] Add request-size limits and stricter schema bounds.
- [ ] Add CSRF strategy if cookies are introduced (bearer-only today).
- [ ] Add secret rotation runbook.
- [ ] Consider per-IP/per-user throttles on registration.

### Correctness and money

- [ ] Reconciliation job: assert every ledger transaction sums to zero.
- [ ] Payout processor integration with idempotency keys and compensating
      entries on failure.
- [ ] Payout state machine transitions (`requested → auditing → approved → paid`
      or `rejected/frozen`) with audit log.
- [ ] Campaign budget enforcement at telemetry time, not just prefetch.
- [ ] Handle campaign exhaustion (`spentTodayMicro >= dailyBudgetMicro`) by
      pausing/exhausting status.
- [ ] Use `bigint`/string in prefetch `cpiMicro` to avoid future precision loss.
- [ ] Fix campaign/variant moderation status transitions after human review.
- [ ] Add uniqueness/idempotency for task submissions (one reward per post URL).

### Trust and safety

- [ ] Reviewer/admin UI for campaigns (`needs_review` → active/rejected) and
      tasks (`pending` → approved/rejected).
- [ ] Payout review queue for `auditing` and `frozen` requests.
- [ ] Appeal flow for rejected tasks and frozen payouts.
- [ ] Store reviewer identity, notes, and timestamps.
- [ ] Add an audit log for manual decisions.
- [ ] Document fraud-rule thresholds and tuning process.

### Extension

- [ ] Add `aria-label` to icon-only controls and a focus trap for the menu.
- [ ] Add a first-run explainer and permissions rationale.
- [ ] Add an options page for API base, frequency, and placement.
- [ ] Add a "report this ad" control.
- [ ] Harden selector fallbacks and log adapter breakage (locally only).
- [ ] Add an explicit "ads paused" indicator.
- [ ] Add unit tests for `filterEligible`, `takeAd`, `ViewportTimer`, and
      `HoverTracker`.
- [ ] Consider Firefox MV3 support (out of scope for v0.1).

### Web

- [ ] Add error/loading states to all routes.
- [ ] Add form validation messages and disabled states.
- [ ] Add pagination or virtualisation for the transparency log.
- [ ] Add a dedicated campaign detail page.
- [ ] Add per-variant stats for the base creative (A).
- [ ] Add accessible table captions and sortable columns.
- [ ] Add a mobile nav treatment.
- [ ] Add `aria-live` for async results.

### Observability

- [ ] Add structured request IDs to client errors.
- [ ] Add metrics for prefetch, telemetry acceptance, fraud flags, and payout
      verdicts.
- [ ] Add tracing across API → DB/Redis/moderation.
- [ ] Add alerting for ledger imbalance and moderation outage.
- [ ] Redact sensitive fields in logs.

### Testing

- [ ] Unit tests (Vitest) for shared crypto, validators, cadence, trust, and
      formatting.
- [ ] API integration tests against a disposable Postgres.
- [ ] Playwright tests for landing, dashboard, tasks, referrals, payouts, and
      advertiser flows.
- [ ] Extension test harness for cache/dedup/timer logic.
- [ ] CI workflow: install, typecheck, build, test, migration check.

---

## 4. P2 — Post-launch / polish

- [ ] Real classifier integration and model evaluation harness.
- [ ] GeoIP dataset (MaxMind/DB-IP) behind `resolveGeo`.
- [ ] Config endpoint for platform selectors so DOM changes can be patched
      without an extension release.
- [ ] Advertiser billing: deposits, invoices, spend caps, receipts.
- [ ] More payout methods and jurisdiction handling.
- [ ] Campaign scheduling and dayparting.
- [ ] Frequency-cap UI and per-user controls.
- [ ] Referral leaderboard (privacy-safe, opt-in).
- [ ] Localisation and multi-currency.
- [ ] Dark mode for the web app.
- [ ] Account deletion and data export.
- [ ] Admin analytics dashboard.
- [ ] Load testing for prefetch and telemetry.
- [ ] Improve N+1 variant queries and pre-filter campaigns in SQL.
- [ ] Materialised ledger balances if `SUM` becomes a bottleneck.

---

## 5. Known bugs / inconsistencies

| # | Issue | Impact | Suggested fix |
|---|---|---|---|
| B-01 | Web has no auth screens; dashboard always calls `/me/*` without a token. | Cannot demo earnings without devtools. | T-01. |
| B-02 | Extension never writes `identity`. | Cannot prefetch or report telemetry after install. | T-02. |
| B-03 | No advertiser auth route, yet seeded advertiser exists. | Portal cannot be used. | T-03. |
| B-04 | Referral link `/r/:code` 404s. | Referral loop is broken. | T-04. |
| B-05 | ~~`POST /ads/click` parses the lease without verifying the HMAC.~~ Fixed: verifies the lease, requires a verified impression owned by the caller, and dedupes per impression. | — | — |
| B-06 | ~~`persist()` extracts the lease id by re-parsing the token.~~ Fixed: the verified `lease.lid` is passed through. | — | — |
| B-07 | `users.signupIp` stores a raw IP. | Privacy violation. | T-07. |
| B-08 | ~~Advertiser could activate a `needs_review` draft.~~ Fixed: `/activate` now returns `409 moderation_required` unless moderation was `auto_approved`. | No reviewer UI yet, so review-blocked campaigns stay off. | Build the reviewer queue. |
| B-09 | No tests. | Regressions likely. | P1 testing. |
| B-10 | `referralCodeFor` is duplicated in `auth-ads.ts` and `users-advertisers.ts`. | Divergence risk. | Move to `referrals.ts`. |
| B-11 | ~~Referrer lookup used `pgcrypto.digest`.~~ Fixed: uses core `sha256(convert_to(...))`. | — | — |
| B-12 | `@meantime/shared` exports build output, so a fresh production start requires a build. | Confusing failure if run directly. | Documented; keep Turbo ordering. |
| B-13 | No Docker available in the authoring environment. | Compose unverified. | Run T-05 on a Docker-capable machine. |
| B-14 | Referral attribution rejects same-IP signups (`ip_overlap_with_referrer`). | Cannot exercise a successful referral on a single machine. | Test with distinct egress IPs, or add an explicit dev override. |
| B-15 | Laya is text-only; task screenshots are never analysed. | Task proofs always need a human (`screenshot_unverified`). | Add an image-capable classifier or a reviewer UI. |
| B-16 | Real Laya was run from source, but the container image is still unbuilt (no Docker). | Compose and the `laya-models` volume are unverified. | Run T-05 on a Docker-capable machine. |
| B-17 | The real checkpoint is poorly calibrated for yes/no moderation questions; the original `noul` set scored every ad as spam. Fixed with a `choice` category question (see §1). | Clean copy can still land in `needs_review` (e.g. copy that mentions earning money, or an advertiser with prior rejections). | Build the evaluation harness in P2 before tuning the 85/40 bands. |

---

## 6. Definition of done for the demo

A demo is considered working when:

- [ ] `docker compose up -d` is healthy.
- [ ] `pnpm db:migrate && pnpm db:seed` succeeds.
- [ ] API `/health` is 200.
- [ ] Web landing + dashboard render.
- [ ] A user can register/sign in (web + extension), receive an ad, and earn a
      verified impression.
- [ ] The dashboard shows the impression and the balance increases.
- [ ] An advertiser can sign in, create an approved campaign, and see analytics.
- [ ] A referral can be attributed and shows `pending`.
- [ ] A payout request is gated by $5.00 and returns a trust verdict.
- [ ] No raw IP or prompt text is stored.
- [ ] `pnpm typecheck` and `pnpm build` pass.
