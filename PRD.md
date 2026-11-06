# MeanTime — Product Requirements Document

**Status:** Draft / implementation-aligned  
**Version:** 0.1  
**Last updated:** 2026-11-03  
**Owner:** Product  
**Related docs:** [ARCHITECTURE.md](./ARCHITECTURE.md) · [DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md) · [AGENTS.md](./AGENTS.md) · [TASKS.md](./TASKS.md)

---

## 1. Summary

MeanTime is a text-only micro-advertising product for the moment a user is
already waiting on an AI assistant. When a user submits a prompt to ChatGPT,
Gemini, Claude, Grok, or DeepSeek, the browser extension shows one small,
clearly labelled line of sponsored text in the gap before the answer begins.
The user keeps **55%** of the advertiser's bid for every **verified 5-second
view**. Advertisers pay only for real, viewable human attention.

The product has four surfaces:

1. A Manifest V3 browser extension that displays ads and collects privacy-safe
   engagement telemetry.
2. A Fastify API that issues single-use ad leases, ingests telemetry, runs the
   anti-fraud engine and moderation pipeline, and maintains the ledger.
3. A TanStack Start web app for user earnings, payouts, referrals, social tasks,
   and the advertiser self-serve portal.
4. Shared TypeScript contracts, validators, crypto helpers, and the PostgreSQL
   schema used by every surface.

---

## 2. Problem

AI chat users spend a meaningful amount of time every day staring at a
"Thinking…" indicator. That time is currently monetised only by the AI
provider, if at all, and is usually filled with a spinner or nothing.

Advertisers, meanwhile, have no clean way to reach technical, high-intent users
at a moment when those users are attentive but not yet reading an answer.
Existing display advertising is visually noisy, tracks too much, and pays for
impressions that are easy to fake.

**The opportunity:** turn a low-value waiting moment into a fair, private,
small-format ad slot where the user is paid directly and the advertiser pays
only for verified human attention.

---

## 3. Vision

> **Ads in the meantime — a fair exchange of a few seconds of attention, with
> no surveillance and no interruption.**

MeanTime should feel like a quiet utility, not an ad network:

- One ad at a time, never a feed.
- Text only; no images, video, audio, pop-ups, or layout shift.
- Instantly dismissible and easy to pause.
- Transparent: every impression is visible in the user's own log.
- Privacy-preserving: no prompt content, no raw IP storage, no browsing history.
- Economically honest: 55% to the user, 45% to the platform, verified views only.

---

## 4. Target users

### 4.1 Primary — AI power users

- Students, developers, analysts, writers, and researchers who use an AI chat
  product most days.
- Highly sensitive to intrusive ads and to surveillance.
- Motivated by small, credible earnings and by control over when ads appear.
- Likely to install a browser extension only if it is lightweight, transparent,
  and easy to remove.

**Jobs to be done**

- "Let me earn something from time I already lose waiting."
- "Never interrupt my work or read my prompts."
- "Show me exactly what I earned and why."

### 4.2 Primary — performance-minded advertisers

- Indie SaaS, developer tools, productivity apps, courses, and technical
  products with a small budget.
- Wants qualified attention, not vanity impressions.
- Needs simple self-serve campaign creation, geo targeting, moderation feedback,
  and honest metrics.

**Jobs to be done**

- "Reach technical users at a moment of attention without a big agency."
- "Pay for a real 5-second view, not a bot load."
- "Know which copy and region performed."

### 4.3 Secondary — platform operations and reviewers

- Trust & safety reviewers handling the `needs_review` moderation band.
- Finance/ops staff handling payout requests, frozen accounts, and ledger
  reconciliation.
- Support staff answering earnings and payout questions.

### 4.4 Secondary — growth partners / referrers

- Existing users who invite peers and earn a vested referral bonus.
- Must be resistant to self-referral and throwaway-account farming.

---

## 5. Product principles

| Principle | What it means in practice |
|---|---|
| **Wait time only** | Ads appear only after a prompt is submitted and before/while the answer arrives. Never on page load or while browsing. |
| **One at a time** | A single active ad per tab. No stacking, carousels, or takeovers. |
| **Text only** | Headline, one short body line, CTA, and controls. No media. |
| **User agency** | Dismiss, snooze 10/15/60 minutes, pause indefinitely, choose placement and display mode. |
| **Transparency** | Every impression, duration, eligibility decision, and earning appears in the user's log. |
| **Privacy by design** | Never read prompt text. Hash IPs for equality checks; store only coarse geo clusters. |
| **Pay for proof** | Payout requires 5,000 ms of cumulative active viewport time, a valid single-use lease, and credible human signals. |
| **Fail safe** | If moderation is unavailable, content goes to review — never auto-approved. If the API is down, the extension uses its local cache or stays silent. |
| **No dark patterns** | No fake urgency, no hidden close button, no confusing opt-in, no forced watch. |

---

## 6. Core user journeys

### 6.1 User installs and earns

1. User installs the extension and creates an account.
2. The extension prefetches up to 15 ads while idle and keeps at most 25
   locally (~15 KB target).
3. User sends a prompt on a supported AI site.
4. A single ad appears in the thinking bubble (default placement) or above the
   prompt box, in a closed Shadow DOM, with dismiss/pause controls.
5. The viewport timer accrues only while the ad is at least 75% visible, the
   page is visible, and the window is focused.
6. At 5,000 ms cumulative, the ad fades out. In `wait_time_only` mode it
   disappears the moment the AI starts streaming. In either mode, an active
   hover keeps the ad (and its hover clock) alive until the pointer leaves, so
   a reader is never interrupted; that extra hover time is reported as a
   campaign metric.
7. The impression is queued locally and flushed in a compressed batch every
   15 minutes or 15 impressions.
8. The server validates the lease, human signals, pacing, and cadence; credits
   the user's ledger; and returns a per-event result.
9. The user sees balance and a full transparency log in the dashboard.
10. At $5.00 available, the user can request a payout after a trust audit.

### 6.2 Advertiser launches a campaign

1. Advertiser creates an account and funds a balance (deposit flow is not yet
   implemented end-to-end).
2. Advertiser writes a headline (≤70 chars), body (≤140), CTA (≤24), target URL,
   daily budget, view duration (2s–15s, default 5s), bid per verified view (minimum
   $0.002/s, e.g. $0.010 for 5s), platforms, and optional geo clusters.
   Users can configure their maximum acceptable ad duration (2s–15s, default 15s).
3. Deterministic policy checks run first (blocked terms, malformed URL,
   suspicious TLDs, character repetition).
4. A local non-chat classifier scores the copy. Score ≥85 auto-approves,
   <40 auto-rejects, and the middle band routes to human review. Campaigns
   below the auto-approve band are never shown to the advertiser as an error:
   they appear in the portal under a collapsible "Under review" section while
   an operator reviews them. Development builds surface the raw verdict to make
   classifier tuning faster.
5. An approved campaign becomes active and enters the prefetch pool.
6. The advertiser sees views, verified views, completion rate, intentional
   hovers, hover rate (intentional hovers ÷ views), clicks, CTR, spend, and a
   per-geo-cluster breakdown.
7. Up to two additional creative variants (B, C) can be submitted; each is
   moderated independently and shares the campaign budget and bid.

### 6.3 Referral

1. Every user gets a deterministic referral link (`.../r/<code>`).
2. A new user signs up with the code.
3. The referral is rejected if the new account shares a device fingerprint or
   salted IP hash with the referrer.
4. The bonus remains `pending` until the referred user earns **$1.00** in
   verified ad views.
5. When the threshold is crossed, the referrer receives **$0.50** from the
   platform's promotional liability account and the referral is marked paid.

### 6.4 Social task

1. User chooses a task type (X, LinkedIn, Reddit, Chrome Web Store, other),
   submits a post URL, and uploads a screenshot proof.
2. The screenshot is uploaded via a presigned S3/MinIO URL.
3. Policy checks validate the URL shape; the URL is classified for
   scam/phishing signals. Laya is text-only, so the screenshot is not analysed.
4. A clearly fraudulent link is rejected. Because the screenshot is unverified,
   a clean link still goes to a human reviewer rather than auto-approving.
   Rejected proofs earn nothing.

### 6.5 Payout

1. User requests any amount at or above the **$5.00** minimum, up to their
   available balance (for example $7.00 of a $10.00 balance).
2. The system checks balance, frozen state, and payout-address uniqueness.
3. A composite trust score is computed from account age, network diversity,
   payout uniqueness, proof-of-human-interaction ratio, and prompt cadence.
4. ≥80 auto-approves, 50–79 goes to audit, <50 freezes the request.
5. The ledger debits the user and unlocks any pending welcome bonus.
6. A payment processor integration is required to actually settle funds; it is
   not yet implemented.

---

## 7. Features and requirements

### 7.1 Extension

| ID | Requirement | Priority |
|---|---|---|
| EXT-01 | Support ChatGPT, Claude, Gemini, DeepSeek, and Grok with host-scoped content scripts; Grok is path-scoped to `x.com/i/grok`. | P0 |
| EXT-02 | Detect prompt submission via Enter (without Shift/composition) or send-button pointerdown using passive capture listeners. | P0 |
| EXT-03 | Prefetch ads only while idle or when the local cache is below the low-water mark. | P0 |
| EXT-04 | Cache at most 25 ads; prefetch in batches of 15; drop expired, malformed, and duplicate leases on read so stale entries never inflate the cache or block the low-water refill. | P0 |
| EXT-05 | Deduplicate locally by lease id using lease expiry, per-day cap, and cooldown metadata without network calls. | P0 |
| EXT-06 | Render the ad in a closed Shadow DOM beneath the prompt, without layout shift. | P0 |
| EXT-07 | Provide dismiss, snooze (10/15/60 min), and pause-indefinitely controls. | P0 |
| EXT-08 | Offer `wait_time_only` and `persist_until_5s` display modes. | P0 |
| EXT-09 | Offer exactly two placements: `thinking_indicator` ("In the thinking bubble") and `above_composer` ("Above prompt box"). | P0 |
| EXT-10 | Accrue viewport time only when ≥75% visible, page visible, and window focused. | P0 |
| EXT-11 | Show a bottom-edge view-progress bar that fills from 0% to 100% as active view time accrues; do not add a separate earned badge. | P1 |
| EXT-12 | Track intentional hover only after 500 ms of continuous hover. | P1 |
| EXT-13 | Queue impressions locally and flush in batches every 15 min or 15 events. | P0 |
| EXT-14 | Compress batches with `deflate` when payload is >1 KB, if supported. | P1 |
| EXT-15 | Never read or transmit prompt text. Collect only behavioral scalars. | P0 |
| EXT-16 | Show cache, pending-sync, and earned balance in the popup. | P1 |
| EXT-17 | Persist settings locally and survive service-worker restarts. | P0 |
| EXT-18 | Fail silently when the API is unreachable, keeping the existing cache. | P0 |
| EXT-19 | Onboarding/login flow inside the extension. | P0 |
| EXT-20 | Show an ad-only rate-limit exhaustion bar in the popup for both server 429 cooldowns and local pacing. It must distinguish "rate limited" from "not working" and state that AI chats are never throttled. | P1 |

### 7.2 API and anti-fraud

| ID | Requirement | Priority |
|---|---|---|
| API-01 | Issue HMAC-SHA256 signed, single-use, 12-hour ad leases. | P0 |
| API-02 | Enforce one lease use via Redis `SET NX` with a database fallback. | P0 |
| API-03 | Validate user identity and lease ownership on every telemetry event. | P0 |
| API-04 | Reject impressions below 5,000 ms cumulative visible time. | P0 |
| API-05 | Require credible proof-of-human-interaction signals. | P0 |
| API-06 | Analyse inter-prompt coefficient of variation and viewport-duration clustering. | P0 |
| API-07 | Apply pacing tiers (≤12/hour full, 13–25 throttled, >25 silent cap). | P0 |
| API-08 | Credit 55% of the bid to the user and 45% to platform revenue via a balanced ledger. | P0 |
| API-09 | Compute a composite trust score before withdrawals. | P0 |
| API-10 | Log fraud signals with severity, rule, and structured detail. | P0 |
| API-11 | Resolve IPs to coarse geo clusters in memory and discard the raw IP. | P0 |
| API-12 | Serve `/health` for orchestration liveness. | P0 |
| API-13 | Rate-limit auth, prefetch, telemetry, and payout endpoints; return `Retry-After` and `x-ratelimit-*` headers so clients can back off naturally. | P1 |
| API-14 | Refresh-token rotation and session revocation. | P1 |

### 7.3 Web app

| ID | Requirement | Priority |
|---|---|---|
| WEB-01 | Landing page explaining the value proposition. | P0 |
| WEB-02 | Earnings dashboard with available, pending, lifetime, and threshold progress. | P0 |
| WEB-03 | Transparency log of impressions with platform, ad, view time, status, earning. | P0 |
| WEB-04 | Task center with submission form, screenshot upload, and task history. | P0 |
| WEB-05 | Referral page with copyable link and pending/paid/earned stats. | P0 |
| WEB-06 | Withdrawal portal with method, destination, threshold gating, and trust result. | P0 |
| WEB-07 | Advertiser portal for campaign creation, moderation feedback, analytics, geo breakdown, and A/B variants. | P0 |
| WEB-08 | Sign-up / sign-in screens and session handling. | P0 |
| WEB-09 | Referral landing route `/r/:code` that stores the code for signup. | P1 |
| WEB-10 | Advertiser authentication screens. | P0 |
| WEB-11 | Admin/reviewer queue for `needs_review` campaigns and tasks. | P1 |
| WEB-12 | Email verification flow via Nodemailer with `/verify-email` screen and banner. | P1 |

### 7.4 Moderation

| ID | Requirement | Priority |
|---|---|---|
| MOD-01 | Run deterministic policy checks before the model. | P0 |
| MOD-02 | Hard-reject blocked terms and malformed URLs. | P0 |
| MOD-03 | Auto-approve at score ≥85; auto-reject below 40; otherwise review. | P0 |
| MOD-04 | Use a stricter ≥90 threshold for cash-paying social tasks. | P0 |
| MOD-05 | Never auto-approve when the classifier is unavailable. | P0 |
| MOD-06 | Moderate each A/B variant independently. | P0 |
| MOD-07 | Provide a human review queue and audit trail. | P1 |

### 7.5 Referrals and tasks

| ID | Requirement | Priority |
|---|---|---|
| REF-01 | Generate a stable referral code/link per user. | P0 |
| REF-02 | Block self-referrals by device fingerprint and salted IP hash. | P0 |
| REF-03 | Vest the $0.50 bonus only after $1.00 in verified views. | P0 |
| REF-04 | Show total/pending/paid/earned referral stats. | P0 |
| REF-05 | Social task reward of $0.10 on approval. | P0 |
| REF-06 | Presigned screenshot upload with 15-minute expiry. | P0 |

### 7.6 Data and privacy

| ID | Requirement | Priority |
|---|---|---|
| PRIV-01 | Do not collect, store, or transmit prompt content. | P0 |
| PRIV-02 | Do not store raw IP addresses; hash with a deploy salt for equality only. | P0 |
| PRIV-03 | Store only coarse geo clusters (`NA-EAST`, `EU-WEST`, etc.). | P0 |
| PRIV-04 | Keep extension storage small (≤25 ads) and bounded telemetry queue. | P0 |
| PRIV-05 | Clearly label every ad as an ad. | P0 |
| PRIV-06 | Publish a retention/deletion policy and account deletion flow. | P1 — **not implemented** |

---

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| **Performance** | Ad injection budget <8 ms after trigger; extension bundle <200 KB; no main-thread polling while idle; ad render must not shift layout. |
| **Reliability** | API health endpoint; extension keeps serving cached ads during outages; telemetry retries via bounded local queue; moderation fails closed to review. |
| **Security** | HMAC-signed leases; signed bearer tokens; single-use enforcement; parameterized SQL via Drizzle; secrets only from environment; no raw PII in logs. |
| **Privacy** | Data minimisation as described in PRIV-01…05; no third-party analytics or ad-tech SDKs. |
| **Scalability** | Stateless API behind a load balancer; Postgres for durable state; Redis for lease replay protection and pacing cache; object storage for proofs. |
| **Accessibility** | Keyboard-reachable controls, visible focus rings, semantic buttons, no motion required to understand state; contrast target WCAG AA. |
| **Compatibility** | Current Chrome/Chromium with Manifest V3. Firefox/Safari are out of scope for v0.1. |
| **Localisation** | English-only for v0.1; all money rendered in USD. |
| **Observability** | Structured Fastify logs with IP/authorization redaction, fraud logs in Postgres, `/health`. Metrics/tracing are not yet implemented. |

---

## 9. Success metrics

### User

- Extension install → first verified impression conversion.
- 7-day and 30-day retention of users with ≥1 verified view/day.
- Median verified views per active user per day.
- Dismiss/snooze rate (lower is better, but agency is a feature).
- Time from $0 to first $5 withdrawal.
- Payout dispute/failure rate.

### Advertiser

- Campaign approval rate and time to first impression.
- Verified-view completion rate (target: ≥60% of shown views).
- Intentional-hover rate and CTR.
- Repeat campaign rate after first spend.
- Median spend per active campaign.

### Platform

- Fraud rejection rate and false-positive appeals.
- Ledger imbalance incidents (must be zero).
- API p95 latency for prefetch and telemetry.
- Telemetry batch acceptance rate.
- Cost per verified impression vs. revenue.

---

## 10. Scope

### 10.1 In scope for v0.1

- Chrome/Chromium extension for five AI platforms.
- Prefetch + local cache + single-use leases.
- Two display modes and two placements (thinking bubble, above prompt box).
- Viewport timing, hover intent, batched compressed telemetry.
- Five-layer anti-fraud engine.
- Double-entry ledger and $5 payout workflow (request + audit; no processor).
- Welcome bonus, referral program, social tasks.
- Advertiser campaign creation, Laya-style moderation, geo analytics, A/B variants.
- User dashboard, task center, referral page, payouts page, advertiser portal.
- Postgres schema and migrations, seed data, Docker-based local infra.

### 10.2 Out of scope for v0.1

- Firefox, Safari, mobile browsers, or a standalone mobile app.
- Image/video/audio ads.
- Real-time bidding, auctions, or demand-side integrations.
- Self-serve advertiser funding and invoicing (deposits are seeded/manual).
- Automated payout processor integration (PayPal/Stripe/Wise/crypto).
- Human reviewer UI and admin console.
- Multi-language support and multi-currency.
- Native mobile/desktop clients.
- Advanced attribution, conversion tracking, or third-party pixels.
- Enterprise SSO, teams, or role-based access control.

### 10.3 Assumptions

- Users install browser extensions and accept a small wait-time ad format.
- 5 seconds of active attention is a fair unit of value.
- A 55/45 split is sustainable at the target bid levels.
- Coarse geo clusters are sufficient for early advertiser targeting.
- The local text classifier can moderate ad copy and task links with acceptable
  accuracy; humans handle the middle band and verify proof screenshots.
- Advertisers will fund campaigns manually until billing is built.

### 10.4 Dependencies

- Chrome Manifest V3 extension APIs (`storage`, `alarms`, `idle`).
- PostgreSQL 16, Redis 7, S3-compatible object storage (s3mock locally, since
  MinIO's community images are no longer published).
- A moderation classifier reachable at `LAYA_ENDPOINT`: open-source Laya,
  served by `laya-serve` over TypeSafe Jev's `POST /v1/systemone`
  (a deterministic offline test double is included for development).
- A payout processor for actual settlement (not yet integrated).
- AI platform DOM selectors, which change without notice.

---

## 11. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| AI platforms change DOM or block extensions | Ads stop appearing | Selector config lives in shared code; additive adapters; server-patchable config is a planned follow-up. |
| Users perceive ads as intrusive | Uninstall/churn | One ad, wait-time only, text only, instant dismiss, pause, transparent log. |
| Fraud / bot farms | Advertiser distrust, losses | Signed leases, single-use enforcement, PoHI, cadence, pacing, trust score, payout-address uniqueness. |
| False fraud positives punish power users | Support load, churn | Pacing throttles instead of bans; trust score reviews context; manual review band; appeals process (planned). |
| Advertiser bid too low to pay users | Weak earnings | Minimum bid validation, transparency, budget/bid controls, campaign performance feedback. |
| Moderation outage | Queue backlog or bad content | Fail closed to `needs_review`; deterministic policy rejects clear abuse first. |
| Privacy incident | Reputational/legal harm | No prompt text, no raw IP storage, coarse geo only, minimal extension permissions. |
| Ledger drift | Financial loss | Double-entry postings, derived balances, no mutable balance columns; reconciliation job planned. |
| Payout fraud / money laundering | Financial and legal risk | $5 threshold, trust audit, address uniqueness, frozen state, manual review for mid-band. |

---

## 12. Release criteria for v0.1 demo

- [x] `pnpm install`, `pnpm typecheck`, and `pnpm build` pass from a clean clone.
- [x] `docker compose up -d` starts Postgres, Redis, and S3-compatible storage
      (s3mock, bucket created on boot).
- [x] The real Laya `laya-serve` container image builds and serves `/health`.
- [x] Migrations apply and demo campaigns seed successfully.
- [x] API `/health` returns 200.
- [x] Web app renders the landing page and all five routes.
- [x] Extension builds and loads unpacked in Chrome.
- [x] A signed-in user can prefetch an ad, earn a verified impression, and see
      it in the dashboard.
- [x] An advertiser can create a campaign and see analytics.
- [x] Referral and payout request paths return sensible results.
- [x] No raw IP or prompt text appears in the database or logs.

> **Current status:** build, typecheck, unit tests (`pnpm test`), and smoke suite
> (`pnpm smoke`) pass; compose stack (Postgres, Redis, s3mock, real Laya) verified
> healthy; auth/onboarding and moderation flows verified end-to-end. See [TASKS.md](./TASKS.md).

---

## 13. Open questions

1. How should task screenshots be verified, given Laya is text-only? Is a
   second image classifier or a human reviewer the right answer?
2. What is the latency/cost envelope of running Laya checkpoints in production
   (cold start, checkpoint size, CPU vs GPU)?
3. Should the 55% share be fixed or vary by campaign tier?
4. What is the minimum viable payout processor, and in which jurisdictions?
5. Is a server-patchable selector config endpoint worth the added attack surface?
6. Should power users be able to opt into a higher ad frequency for more
   earnings, or does that undermine the "quiet" promise?
7. How long should impression and fraud data be retained?
8. What is the appeal path for a frozen payout or rejected task?
9. Do advertisers need impression-level reporting, or are aggregates sufficient?
