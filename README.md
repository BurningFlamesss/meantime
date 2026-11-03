# MeanTime

Text-only micro-ads shown during the real wait time between submitting an AI
prompt and the AI's response — with 55% of ad spend going to the user.

## Monorepo layout

| Path | What |
|---|---|
| `packages/shared` | TypeScript contracts, zod validators, HMAC lease-token crypto, Drizzle PostgreSQL schema, platform selector configs. |
| `apps/extension` | Manifest V3 browser extension (WXT). The 3-pillar lightweight engine: idle prefetch + local ad registry, event-driven trigger + multi-LLM adapters, cumulative viewport timer + batched telemetry. |
| `apps/api` | Fastify API. Ad prefetch/lease issuance, telemetry batch ingestion, social tasks, payouts, and the 5-layer anti-fraud engine. |
| `apps/web` | TanStack Start web app: user earnings dashboard, transparency log, task center, withdrawal portal, advertiser self-serve portal. |

## Quickstart

```bash
pnpm install

# 1. Local infrastructure: postgres, redis, minio (+ bucket), Laya classifier.
# The first run builds Laya (PyTorch CPU) and downloads its checkpoint.
docker compose up -d

# 2. API environment + database (migrations are committed under apps/api/drizzle)
cp apps/api/.env.example apps/api/.env
pnpm db:migrate
pnpm db:seed

# 3. API (loads apps/api/.env automatically)
pnpm --filter @meantime/api dev

# 4. Web app
pnpm --filter @meantime/web dev

# 5. Extension (loads into Chrome via chrome://extensions -> Load unpacked -> apps/extension/.output/chrome-mv3)
pnpm --filter @meantime/extension build
```

First run is self-service: click the extension icon and create an account (or
sign in) in the popup. No storage edits or devtools are needed. The web app has
the same flow at `/sign-up` and `/sign-in`; both share the API account.

Advertisers use a separate account and token: `/advertiser` shows its own
sign-up/sign-in gate. The seeded demo advertiser is `demo@advertiser.test` /
`demo-advertiser-pass-123`. Referral links (`/r/<code>`) land on sign-up with
the code attached.

## The 3-pillar extension engine

1. **Idle prefetch & local registry.** The background service worker only
   fetches during `chrome.idle` or when the ring-buffer cache drops below 5
   ads. Max 25 ads, ~15KB total in `chrome.storage.local`. Every ad carries a
   single-use, HMAC-signed `lease_token` and frequency-cap metadata, so the
   content script can deduplicate locally with zero network calls.

2. **Event-driven trigger & adapters.** A single passive `keydown`/`pointerdown`
   listener on the composer detects prompt submission (Enter without
   Shift/composition, or a send-button press). The `PlatformAdapter` interface
   keeps each AI platform under 30 lines. Injection goes into a closed Shadow
   DOM, inline beneath the user's prompt bubble, in under 8ms — no layout
   shift.

3. **Cumulative viewport timer & batched telemetry.** `IntersectionObserver`
   (75% threshold) + `document.visibilityState` + window focus feed one
   "actively viewable" signal, integrated with `performance.now()` deltas.
   5,000ms cumulative pays out. Completed impressions queue locally and flush
   as one compressed batch every 15 minutes or 15 items — never one request
   per view.

**Device footprint.** No model ships to the browser — Laya runs entirely on the
API host. The full MV3 bundle is ~186 KB (94 KB content script, 74 KB service
worker, 9 KB popup); the popup is only loaded when opened. The cache is capped
at 25 ads, telemetry at 200 events, and the viewport `requestAnimationFrame`
loop stops whenever the ad is not actively visible. Ads appear only after a
prompt is sent, one per tab, and can be dismissed, snoozed, or switched off;
a signed-out install never shows cached ads.

## Anti-fraud layers

1. **Cryptographic leases** — HMAC-SHA256, single-use, claimed by one atomic `UPDATE ... WHERE consumed_at IS NULL` (correct with or without Redis).
2. **Proof of Human Interaction** — `isTrusted` event scalars and host-DOM
   mutation checks; never reads prompt text.
3. **Temporal entropy** — inter-prompt interval CV flags robotic cadence
   (CV < 0.08 over ≥15 prompts); viewport-duration clustering catches
   "exactly 5001ms" scripts.
4. **Velocity dampening** — pacing tiers (12/hr full, 13–25 throttled, >25
   silent cap) protect advertisers without falsely banning power users.
5. **Pre-withdrawal sybil check** — composite trust score over account age,
   IP/ASN diversity, payout-address uniqueness, PoHI ratio, and cadence.

## Growth & experimentation

**Referrals.** Every user gets a referral link (`/referrals`). A $0.50 bonus
vests for the referrer only when the referred user earns **$1.00 in verified
ad views** — an account that signs up and never genuinely uses the product
pays nothing, which makes bonus-farming unprofitable. Self-referrals are
blocked by salted-IP-hash overlap and device-fingerprint match.

**A/B creative testing.** Campaigners can add up to 2 extra variants (A/B/C)
per campaign from the advertiser portal. Each variant is moderated by Laya
independently and rotates in only once approved; all variants share the
campaign's budget and bid, so an experiment can never overspend. The portal
shows per-variant views, completion rate, and retention.

## Laya auto-moderation

Campaigns and social-task links are moderated by
[Laya](https://github.com/NandhaKishorM/laya), an open-source, non-autoregressive
decision engine. It is not a chat model: it takes a state plus typed questions
(`choice`, `score`, `noul`) and returns calibrated answers in one forward pass —
nothing is sent to a third-party API.

`docker-compose.yml` builds the pinned upstream `v0.4.21` image and runs
`laya-serve` on `http://localhost:8000`, the same HTTP server as upstream's
`compose.http.yaml`. The API calls `POST {LAYA_ENDPOINT}/v1/systemone` with the
ad copy (headline, body, CTA, destination URL) and one `choice` question over
four categories — legitimate ad, low quality, deceptive, fraud — plus an
ordinal severity. Risk is `P(fraud) + 0.5·P(deceptive)`; that becomes the
0–100 score used by the rest of the pipeline, which then blends in lightweight
reputation signals. Task links use a second `choice` over normal / promo /
phishing / fraud, with risk `1.15·(P(phishing) + P(fraud))`; a clean link still
stops at human review because Laya cannot see the screenshot.

Above the auto-approve threshold a submission goes live instantly; below the
auto-reject floor it's refused; the middle band routes to a human reviewer.

The category question is deliberate. The checkpoint over-fires on yes/no
phrasing: asked "is this advertisement spam?" it answers ~1.0 for any ad at all,
and "is this a scam?" scores ordinary copy around 0.7. Loading the prompt with
the words "scam" or "deceptive" also shifts every option toward suspicion. A
single choice with neutral option labels is what the checkpoint actually
separates, so the client uses that shape and the offline stub mirrors it.

The first `docker compose up` builds a PyTorch CPU image and the first run
downloads the English checkpoint (~800 MB). For a fast offline loop,
`docker compose --profile stub up -d` starts `infra/laya-stub`, a deterministic
test double that speaks the same `/v1/systemone` protocol but is **not** a
model; point `LAYA_ENDPOINT` at `http://localhost:8080` for that.

### Running Laya without Docker

If Docker is unavailable, `infra/laya-host.sh` installs the pinned upstream
package into a Python virtualenv and runs the same `laya-serve` on CPU:

```bash
./infra/laya-host.sh
curl -s http://127.0.0.1:8000/health
```

It requires Python >=3.10, caches the checkpoint under
`~/.local/share/meantime/hf`, and takes a few minutes on first run. Override
`LAYA_PORT`, `LAYA_DEVICE`, or `HF_HOME` through the environment.

Laya is text-only, so social-task screenshot contents are not analysed. The
upload itself is checked first (the object must exist, be PNG/JPEG/WebP, and be
at most 5 MB), but a clean task link still goes to `needs_review`
(`screenshot_unverified`) rather than being auto-approved; a scam or phishing
link is rejected before review.

Security boundary: deterministic policy checks (blocked terms, malformed
URLs) run *before* Laya and can hard-reject clear-cut abuse without consulting
the model — and if Laya is slow or unreachable, the service fails safe to
**"needs_review"**, never to auto-approve. A Laya outage can never push bad
content live.

Manual review lives at `/admin` in the web app. Set `ADMIN_API_KEY` on the API
and enter it in the page; the queue covers campaigns, A/B variants, task proofs,
and `auditing`/`frozen` payouts. Reviewer decisions are recorded in
`fraud_logs`. Auth, ad, telemetry, task, payout, and reviewer endpoints are
rate-limited, and refresh sessions rotate on every use.

## Geo targeting & analytics

The server resolves each request's IP to a coarse geo cluster (e.g.
`NA-EAST`, `EU-WEST`) in memory and discards the IP — impressions and click
events store only the cluster label. Advertisers target campaigns by cluster
and see a per-cluster breakdown (unique users, views, verified views,
intentional hovers, clicks, average retention). **The raw IP is never returned
to the client and is not stored for impressions or clicks.** One legacy
exception remains: `users.signup_ip` still stores the registration IP and is
tracked for removal in `TASKS.md` (T-07).

Hover is tracked only when intentional: a contiguous hover must last at least
500ms before it accrues time, so the advertiser metric reflects real attention
rather than pass-throughs on the way to a control.
