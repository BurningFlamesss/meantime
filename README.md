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

# 1. Local infrastructure: postgres, redis, minio (+ bucket), moderation stub
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

## Anti-fraud layers

1. **Cryptographic leases** — HMAC-SHA256, single-use, Redis SETNX + DB fallback.
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

Campaigns and social-task proofs are moderated by [Laya](#), an open-source,
non-chat AI that runs in Docker as a local sidecar (`laya` service in
`docker-compose.yml`). Because it's non-chat, it takes structured input and
returns a score and labels rather than free text — nothing is sent to a
third-party API. The local `infra/laya-stub` is a deterministic development
stand-in, not a production classifier.

The API calls `POST {LAYA_ENDPOINT}/v1/classify` with the ad copy (or the task
proof image + URL) and blends the returned 0–100 score with lightweight
reputation signals. Above the auto-approve threshold a submission goes live
instantly; below the auto-reject floor it's refused; the middle band routes
to a human reviewer.

Security boundary: deterministic policy checks (blocked terms, malformed
URLs) run *before* Laya and can hard-reject clear-cut abuse without consulting
the model — and if Laya is slow or unreachable, the service fails safe to
**"needs_review"**, never to auto-approve. A Laya outage can never push bad
content live.

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
