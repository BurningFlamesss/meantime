# MeanTime — Tasks and Roadmap

**Last updated:** 2026-11-04 (multilingual + labelled-benchmark pass)  
**Status legend:** `[x]` done · `[~]` partial · `[ ]` not started · `[!]` blocked  
**Priority:** P0 = required for a testable end-to-end demo · P1 = required for
private beta · P2 = post-launch / polish

---

## 0. Current snapshot

| Area | Status | Evidence |
|---|---|---|
| Shared contracts, schema, crypto, selectors | `[x]` | `pnpm typecheck` + `pnpm build` pass. |
| Fastify API and fraud engine | `[x]` verified | Against PostgreSQL 18: register/login, prefetch, telemetry (verified, replay, forged lease, low PoHI, below threshold), balance, impressions, referrals, tasks presign, payouts threshold, advertiser create/list/variants/stats/analytics/click. |
| TanStack Start web app | `[x]` verified | Production SSR bundle serves all routes with 200. `/sign-up`, `/sign-in`, dashboard, sign-out, and sign-in-again passed 7/7 in Chromium. Advertiser sign-up/sign-in with rotating sessions, and `/r/:code` attribution. |
| API smoke suite | `[x]` verified | `pnpm smoke` passes 30/30 against the real `laya-serve`: advertiser sessions, moderation, the 55% payment, referral attribution + vesting, plus the reviewer queue and campaign/task/payout decisions. It loads `apps/api/.env` for `ADMIN_API_KEY`. |
| WXT extension | `[x]` verified | `.output/chrome-mv3` builds (189.2 KB; 94.5 KB content, 74.4 KB worker, 9.5 KB popup) and was loaded in real Chromium: first-run popup sign-up, prefetch, ad injection, 5 s payment, reload persistence, and sign-out all passed 19/19. |
| Database migrations | `[x]` applied | `apps/api/drizzle/0000`–`0005`, 18 tables, applied to PostgreSQL 16 (compose) and 18. |
| Demo seed | `[x]` run | 1 advertiser + 2 active campaigns inserted; re-runs are idempotent. |
| Docker compose | `[x]` verified | The real pinned `v0.4.21` Laya image builds and runs healthy beside Postgres 16, Redis 7, and s3mock; migrations + seed apply and `pnpm smoke` passes 30/30. `LAYA_MODELS=english,multilingual` preloads both checkpoints; `LAYA_DEFAULT_MODEL=english` keeps undecided short task states off a lazy download. |
| Laya moderation | `[x]` real models | Real `laya-serve` container on `:8000` with the English **and multilingual** checkpoints. `pnpm laya:check` passes 46/46, including real probes: clean ad 82/`needs_review`, crypto scam 10/`auto_rejected`, benign task 93/`needs_review`, phishing task 7/`auto_rejected`; every inference <650 ms. Non-English verdicts are advisory (`non_english_review`). |
| Labelled moderation benchmark | `[x]` | `pnpm laya:bench` runs 26 labelled ads/tasks in English, Spanish, Chinese, Hindi, and Arabic: 0 clean/normal auto-rejects, 11/12 fraud/phishing surfaced (92%, gate 80%), max inference <1.5 s. |
| Automated tests | `[~]` harnesses | No unit suite. `pnpm smoke` (30/30), `pnpm laya:check` (46/46), and `pnpm laya:bench` (26 cases) run against the real API, database, and classifier. |
| Auth/onboarding UX | `[x]` | Web sign-up/sign-in/sign-out and first-run popup onboarding work without manual storage edits. |

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
- [x] First-run popup sign-up/sign-in with a random install id; stores identity
      and refreshes tokens automatically. Sign-out flushes telemetry, clears
      cached ads and frequency history, and signed-out installs never show ads.

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
- [x] `/sign-up` and `/sign-in` with inline errors, token persistence, shell
      sign-out, and redirect to the dashboard.
- [x] Dashboard with balance, threshold progress, and transparency log.
- [x] Task center with screenshot upload and history.
- [x] Referral page with link copy and stats.
- [x] Payouts page with method, destination, and threshold gating.
- [x] Advertiser portal with campaign creation, geo chips, moderation feedback,
      analytics, A/B variants, and geo table.
- [x] Advertiser register/login (`POST /advertiser/register`, `POST
      /advertiser/login`) with Argon2 and a `kind: "advertiser"` token, plus a
      portal sign-in/up gate that stores the advertiser token separately from
      the viewer token.
- [x] `/r/:code` referral landing that forwards the code to `/sign-up?ref=`
      and attributes it at registration.
- [x] Advertiser sessions: 1-hour access token plus a rotating refresh token
      (`advertiser_sessions`, migration `0003`), `POST /advertiser/refresh`
      (single-use rotation) and `POST /advertiser/logout` (revocation). The
      portal rotates on 401 and revokes on sign-out.
- [x] `scripts/smoke.mjs` (`pnpm smoke`): advertiser auth, token scoping,
      moderation, 55% payment, referral attribution and vesting, plus the
      reviewer queue and campaign/task/payout decisions.
- [x] `docs/VERIFY.md`: how to verify every service plus the money and privacy
      invariants.
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
- [x] Object storage in compose. MinIO's community images are no longer
      published, so the stack uses Adobe `s3mock` (bucket created on boot), and
      presigned uploads were verified against it.
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
- [x] Ran the real Laya `v0.4.21` server both from upstream source (Python
      3.13 venv, `torch==2.15.0+cpu`, `[serve]` extra) and from the pinned
      Docker image, with the English checkpoint (`convaiinnovations/laya`,
      revision `7b928d8`, ~808 MB) and the multilingual checkpoint
      (`convaiinnovations/laya-multilingual`, revision `1720e3e`, ~678 MB).
- [x] Preloaded `english,multilingual` in compose and `infra/laya-host.sh` so
      neither an undecided short task state nor detected non-English content
      triggers a lazy checkpoint download that would exceed the 4 s budget;
      `LAYA_DEFAULT_MODEL=english` is the faster fallback.
- [x] Verified `/health` reports `loaded: ["english","multilingual"]` on CPU and
      that ad, task, and non-English inference all stay well under the 4 s
      budget (<650 ms warm, multilingual <250 ms).
- [x] Made non-English verdicts advisory: the client reads `routing.model` and
      forces `needs_review` with `non_english_review`, because the multilingual
      checkpoint scored most clean Spanish/Chinese/Hindi/Arabic ads as fraud on
      the labelled set. Policy hard-rejects still run first.
- [x] Added `scripts/laya-bench.mjs` + `scripts/laya-bench-cases.json`
      (`pnpm laya:bench`): 26 labelled ads and task links across five languages;
      gates on zero clean auto-rejects, ≥80% unsafe recall, and the 4 s budget.
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
- [x] Added bounded in-process rate limits for register/login/refresh,
      prefetch, telemetry, task submission, payouts, clicks, and reviewer
      routes; verified 429 at the register/login bounds.
- [x] Persisted refresh sessions with single-use rotation and logout
      revocation; verified reuse of a rotated token returns 401.
- [x] Added the reviewer API and `/admin` UI for campaigns, A/B variants,
      tasks, and auditing/frozen payouts. Every decision is written to
      `fraud_logs`; task approval pays once and payout rejection refunds.
- [x] Verified the built extension in real Chromium against a ChatGPT-shaped
      fixture: mount under the new prompt, persist after a completed answer,
      earn at 5 s, flush telemetry, and credit 55% of the bid. Fixed a race
      where a fast model's answer arriving during mount was treated as the
      baseline and rejected as `no_ai_mutation`.
- [x] Task proofs are now verified in object storage at submit time (must
      exist, be PNG/JPEG/WebP, and be ≤5 MB); verified a real presigned PUT,
      plus rejection of missing, non-image, and oversized objects.
- [x] Fixed presigned PUTs carrying an empty-payload CRC32 checksum (which
      made real uploads fail) and allowed both loopback CORS spellings.
- [x] Removed the last raw-IP column: `users.signup_ip` is now
      `signup_ip_hash` (salt + SHA-256), and the trust score and referral check
      compare hashes only.
- [x] Added `pnpm db:check` (ledger reconciliation; exits non-zero unless the
      double-entry books sum to zero) and documented it.
- [x] Prefetch now loads all A/B variants for the selected campaigns in one
      query instead of one query per campaign.
- [x] Early-answer handling: in `persist_until_5s` (the default) an AI answer
      that finishes before 5 s no longer tears the ad down early; only
      `wait_time_only` closes with the wait.
- [x] Extension popup: a one-time "How MeanTime works" explainer (what shows,
      the 5 s rule, the 55% share, prompt privacy, and why each permission is
      needed) plus an explicit "Ads paused" banner with a one-click resume that
      reflects both the enable toggle and a snooze started in the page widget.
- [x] Docker compose actually executed: Postgres 16, Redis 7, s3mock, and the
      real `laya-serve` run healthy; migrations, seed, and `pnpm smoke` (30/30)
      pass against the compose stack.

---

## 2. P0 — Make the system testable end-to-end

### T-01 · Web authentication screens · done

- [x] `/sign-in` and `/sign-up` routes.
- [x] Call `POST /auth/login` / `POST /auth/register`.
- [x] Persist `accessToken` in `localStorage["mt_token"]`.
- [x] Redirect to `/dashboard` after auth.
- [x] Show signed-in state in the shell; add sign-out.
- [x] Surface API errors inline (invalid credentials, email taken).
- [x] Capture `?ref=` / `/r/:code` into signup (T-04).

**Acceptance:** met — verified 7/7 in Chromium: sign-up lands on the dashboard
with the $1.00 pending balance, sign-out clears the token, and sign-in restores
the session.

### T-02 · Extension onboarding and identity bootstrap · done

- [x] Popup signed-out state with email/password.
- [x] Generate/persist a random install id; derive a fingerprint hash without
      canvas/hardware fingerprinting.
- [x] Call `/auth/register` or `/auth/login` with `deviceId` +
      `fingerprintHash`.
- [x] Store `identity` (`userId`, `deviceId`, `accessToken`, `refreshToken`,
      `tokenExpiresAt`, `email`) in `chrome.storage.local`.
- [x] Configure the API base URL (`api_config`) from the popup, defaulting to
      `http://localhost:3001` for local setup.
- [x] Trigger prefetch immediately after sign-in and rotate refresh tokens on
      401.

**Acceptance:** met — verified 19/19 in Chromium: a fresh profile signs up in
the popup, stores identity, prefetches 25 ads, earns on a prompt, survives a
popup reload, and sign-out clears the session and cache.

### T-03 · Advertiser authentication · done

- [x] `POST /advertiser/register` and `POST /advertiser/login`.
- [x] Argon2 verification and `kind: "advertiser"` token.
- [x] Web advertiser sign-in/up form.
- [x] Persist the advertiser session separately from the viewer token
      (`localStorage["mt_advertiser_session"]`), rotate the 1-hour access token
      with the stored refresh token, and revoke the session on sign-out.
- [x] Gate `/advertiser` behind advertiser auth; a rejected token returns to
      the form.

**Acceptance:** the seeded advertiser (`demo@advertiser.test` /
`demo-advertiser-pass-123`) can sign in and list campaigns.

### T-04 · Referral landing and attribution · done

- [x] `/r/:code` route that redirects to `/sign-up?ref=<code>`.
- [x] Sign-up reads the code from the URL search params (bounded to 32 chars).
- [x] Pass `referralCode` to `/auth/register`; self-referral checks unchanged.
- [x] Show a clear "bonus vests after $1.00 verified earnings" explanation on
      the sign-up form when a code is present.

**Acceptance:** two distinct users can complete referral attribution, and the
referrer sees a pending referral in `/me/referrals`.

### T-05 · Run and validate Docker compose

- [x] Compose file defines Postgres, Redis, s3mock, and the real Laya
      `laya-serve` service with healthchecks.
- [x] Laya integration uses upstream's `POST /v1/systemone` contract.
- [x] Offline test double under `--profile stub` speaks the same contract.
- [x] `docker compose up -d` starts Postgres, Redis, s3mock, and the real
      `laya-serve` healthy (verified on a Docker-capable host).
- [x] `pnpm db:migrate` and `pnpm db:seed` succeed against the compose
      PostgreSQL 16 instance, and `pnpm smoke` passes 30/30 against it.
- [x] The pinned `v0.4.21` Laya container image builds (PyTorch CPU) and serves
      both the English and multilingual checkpoints; preloading both avoids a
      lazy download for undecided task states or non-English content, and
      `pnpm laya:bench` gates the decision bands on a labelled set.
- [x] `docs/VERIFY.md` describes how to verify each service.
- [x] Object upload path verified end to end against s3mock: presigned PUT,
      HeadObject validation, and task submit.
- [x] MinIO replaced: its community images are no longer published
      (`docker.io/minio/minio` reports the repository does not exist, and
      `quay.io/minio/minio` answers 401).

**Acceptance:** from a clean machine with Docker, the documented commands bring
up infra and seed data without manual edits.

### T-06 · End-to-end smoke script · partial

- [x] `scripts/smoke.mjs` (`pnpm smoke`): registers accounts, prefetches a real
      lease, submits a real telemetry batch, and asserts the 55% payment.
- [x] Covers advertiser register/login/refresh/logout, token scoping, campaign
      creation through moderation, referral attribution and vesting.
- [x] Covers the reviewer surface: operator-key rejection, the queue buckets,
      the advertiser self-activation guard, and campaign/task/payout decisions
      (including the reward credit and payout debit). `ADMIN_API_KEY` is read
      from `apps/api/.env` when present, so a plain `pnpm smoke` exercises it.
- [ ] Playwright coverage for the web flow; the extension stays manual.

**Acceptance:** met for the API surface. `pnpm smoke` reports pass/fail per
check and exits non-zero on failure; an environment limit (the register rate
limit) is reported as `SKIP`, never as a pass.

### T-07 · Privacy cleanup

- [x] Removed `users.signup_ip`; the signup IP is now stored only as a salted
      SHA-256 (`users.signup_ip_hash`, migration `0005`) used for equality
      checks. The referral overlap check and the trust score read the hash.
- [x] Redact `req.remoteAddress`, `req.remotePort`, authorization, and cookie
      values from Fastify request logs.
- [x] Added a data-retention section to `ARCHITECTURE.md` §10.
- [x] Documented `IP_HASH_SALT` rotation implications in `ARCHITECTURE.md` §10.

**Acceptance:** a database dump contains no raw IP addresses and logs contain no
raw IPs.

### T-08 · Make `pnpm dev` reliable from a fresh clone

- [x] Turbo `dev` builds shared first.
- [x] Root `postinstall` runs `wxt prepare`, so a fresh `pnpm install` generates
      the extension types with no extra step.
- [ ] Verify `pnpm dev` starts API + web without a prior manual build (needs a
      migrated database and `apps/api/.env`; not run in this pass).

**Acceptance:** clean clone → `pnpm install` → `pnpm dev` works.

---

## 3. P1 — Private beta hardening

### Security

- [x] Rate limiting on auth, prefetch, telemetry, tasks, payouts, clicks, and
      reviewer routes.
- [x] Persist and rotate refresh tokens; logout revokes the session.
- [ ] Revoke all sessions on password change (no password-change flow yet).
- [ ] Add email verification and password reset.
- [x] Verify the lease signature in `POST /ads/click` before recording a click.
- [x] Use the verified lease payload in `persist()` instead of re-parsing the
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
- [x] Campaign budget enforcement at telemetry time under a campaign row lock.
- [ ] Handle campaign exhaustion (`spentTodayMicro >= dailyBudgetMicro`) by
      pausing/exhausting status.
- [ ] Use `bigint`/string in prefetch `cpiMicro` to avoid future precision loss.
- [x] Campaign/variant moderation status transitions after human review.
- [x] Uniqueness/idempotency for task submissions (one live reward per post URL).

### Trust and safety

- [x] Reviewer/admin UI and API for campaigns (`needs_review` → active/rejected),
      variants, and tasks (`pending` → approved/rejected).
- [x] Payout review queue for `auditing` and `frozen` requests, with refund on
      rejection and debit-on-approval for frozen requests.
- [ ] Appeal flow for rejected tasks and frozen payouts.
- [x] Store reviewer notes and timestamps. Per-reviewer accounts and a shared
      operator key's member identity remain open.
- [x] Audit log for manual decisions (`fraud_logs`).
- [ ] Document fraud-rule thresholds and tuning process.

### Extension

- [x] Add `aria-label` to icon-only controls and Escape/outside-click menu close.
- [ ] Add a focus trap for the menu.
- [x] Add a first-run explainer and permissions rationale.
- [ ] Add an options page for API base, frequency, and placement.
- [ ] Add a "report this ad" control.
- [ ] Harden selector fallbacks and log adapter breakage (locally only).
- [x] Add an explicit "ads paused" indicator.
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
| B-01 | ~~Web has no auth screens.~~ Fixed: `/sign-up` / `/sign-in`, token persistence, shell sign-out. | — | — |
| B-02 | ~~Extension never writes `identity`.~~ Fixed: first-run popup onboarding, automatic prefetch, refresh rotation, sign-out cleanup. | — | — |
| B-03 | ~~No advertiser auth route.~~ Fixed: advertiser register/login with a
separate token kind, plus a portal sign-in gate. | — | — |
| B-04 | ~~Referral link `/r/:code` 404s.~~ Fixed: the route forwards to
`/sign-up?ref=` and registration attributes the code. | — | — |
| B-05 | ~~`POST /ads/click` parses the lease without verifying the HMAC.~~ Fixed: verifies the lease, requires a verified impression owned by the caller, and dedupes per impression. | — | — |
| B-06 | ~~`persist()` extracts the lease id by re-parsing the token.~~ Fixed: the verified `lease.lid` is passed through. | — | — |
| B-07 | ~~`users.signupIp` stores a raw IP.~~ Fixed: only a salted hash is stored (`signup_ip_hash`). | — | — |
| B-08 | ~~Advertiser could activate a `needs_review` draft.~~ Fixed: `/activate` now returns `409 moderation_required` unless moderation was `auto_approved`. | — | Covered by `pnpm smoke`; reviewer queue and `/admin` UI exist. |
| B-09 | No tests. | Regressions likely. | P1 testing. |
| B-10 | ~~`referralCodeFor` is duplicated.~~ Fixed: one implementation in `referrals.ts`. | — | — |
| B-11 | ~~Referrer lookup used `pgcrypto.digest`.~~ Fixed: uses core `sha256(convert_to(...))`. | — | — |
| B-12 | `@meantime/shared` exports build output, so a fresh production start requires a build. | Confusing failure if run directly. | Documented; keep Turbo ordering. |
| B-13 | ~~No Docker available in the authoring environment.~~ Resolved: compose ran on a Docker-capable host (Postgres, Redis, s3mock, real Laya) and the smoke suite passed. | — | — |
| B-14 | Referral attribution rejects same-IP signups (`ip_overlap_with_referrer`). | A referral cannot be exercised from a single client IP — by design. | Testable without weakening it: `pnpm smoke` binds a distinct loopback source address (`localAddress`), because the kernel otherwise always picks 127.0.0.1 as the source. |
| B-15 | Laya is text-only; task screenshots are never analysed. | Task proofs always need a human (`screenshot_unverified`). | Add an image-capable classifier or a reviewer UI. |
| B-16 | ~~Real Laya was run from source, but the container image is still unbuilt.~~ Resolved: the pinned image builds and serves both the English and multilingual checkpoints; the compose volume is seeded from the cached checkpoints. | — | — |
| B-17 | The real checkpoint is poorly calibrated for yes/no moderation questions; the original `noul` set scored every ad as spam. Fixed with a `choice` category question (see §1). | Clean copy can still land in `needs_review` (e.g. copy that mentions earning money, or an advertiser with prior rejections). | Covered by `pnpm laya:bench`; tune the 85/40 bands against a larger labelled set. |
| B-18 | The multilingual checkpoint is badly calibrated for the ad/task prompts: most clean non-English ads score as fraud. | Automatic decisions would reject legitimate non-English advertisers. | Mitigated: non-English verdicts are advisory and forced to `needs_review` (`non_english_review`). A better prompt or a language-specific calibration set is still needed before trusting them. |

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
- [x] An advertiser can sign in, create a campaign, and see analytics.
- [x] A referral link lands on sign-up with the code and is attributed at
      registration (subject to the self-referral network check). Verified by
      `pnpm smoke`: attribution, $1.00 vesting, and the $0.50 bonus posted.
- [ ] A payout request is gated by $5.00 and returns a trust verdict.
- [ ] No raw IP or prompt text is stored.
- [ ] `pnpm typecheck` and `pnpm build` pass.
