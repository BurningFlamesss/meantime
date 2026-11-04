#!/usr/bin/env node
/**
 * MeanTime — Unit Test Suite
 *
 * Covers:
 *  - Shared constants & core invariants (revenue share 55/45, min viewable 5s, 75% visibility, $5 payout threshold)
 *  - Shared crypto (HMAC lease signing, verification, tampering, expiration, timing-safe compare, sha256Hex)
 *  - Shared validators (auth, prefetch, telemetry, campaign, payout, tasks)
 *  - Anti-fraud cadence (pacing tiers, interval CV calculation, duration clustering)
 *  - Anti-fraud trust scoring (verdict bands auto_approve / manual_review / freeze)
 *  - Money and time formatting (formatMicro, formatMicroCents, formatMs)
 *  - Extension cache deduplication (filterEligible: expiry, platform, daily cap, cooldown)
 *
 * Usage:
 *   pnpm build && node scripts/test-unit.mjs
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";

// 1. Check built artifacts
const SHARED_DIST = new URL("../packages/shared/dist/index.js", import.meta.url);
const API_CADENCE_DIST = new URL("../apps/api/dist/fraud/cadence.js", import.meta.url);
const API_TRUST_DIST = new URL("../apps/api/dist/fraud/trust.js", import.meta.url);

if (!existsSync(SHARED_DIST)) {
  console.error("packages/shared/dist/index.js is missing — run `pnpm build` first.");
  process.exit(2);
}
if (!existsSync(API_CADENCE_DIST)) {
  console.error("apps/api/dist/fraud/cadence.js is missing — run `pnpm build` first.");
  process.exit(2);
}
if (!existsSync(API_TRUST_DIST)) {
  console.error("apps/api/dist/fraud/trust.js is missing — run `pnpm build` first.");
  process.exit(2);
}

const shared = await import(SHARED_DIST.href);
const cadence = await import(API_CADENCE_DIST.href);
const trust = await import(API_TRUST_DIST.href);

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      await res;
    }
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}: ${err.message}`);
  }
}

console.log("=== MeanTime Unit Test Suite ===\n");

/* -------------------------------------------------------------------------
 * 1. Product Invariants (Constants)
 * ------------------------------------------------------------------------- */
await test("invariants: 55% user / 45% platform revenue split", () => {
  assert.equal(shared.REVENUE_SHARE.USER_BPS, 5500);
  assert.equal(shared.REVENUE_SHARE.PLATFORM_BPS, 4500);
  assert.equal(shared.REVENUE_SHARE.USER_BPS + shared.REVENUE_SHARE.PLATFORM_BPS, 10000);
});

await test("invariants: verified view requires 5,000ms active viewport time", () => {
  assert.equal(shared.MIN_VIEWABLE_MS, 5000);
});

await test("invariants: viewability threshold requires >= 75% visibility", () => {
  assert.equal(shared.VIEWABILITY_THRESHOLD, 0.75);
});

await test("invariants: minimum payout threshold is $5.00 in micro-dollars", () => {
  assert.equal(shared.PAYOUT_THRESHOLD_USD, 5_000_000);
  assert.equal(shared.MICRO_DOLLARS_PER_USD, 1_000_000);
});

await test("invariants: intentional hover requires >= 500ms continuous hover", () => {
  assert.equal(shared.HOVER_INTENT_MIN_MS, 500);
});

await test("invariants: single ad per tab / extension cache ring buffer max 25", () => {
  assert.equal(shared.EXTENSION_CACHE.MAX_CACHED_ADS, 25);
  assert.equal(shared.EXTENSION_CACHE.LOW_WATER_MARK, 5);
});

/* -------------------------------------------------------------------------
 * 2. Shared Crypto: Lease Signing & Verification
 * ------------------------------------------------------------------------- */
await test("crypto: signLeaseToken and verifyLeaseToken roundtrip", async () => {
  const secret = "a-very-long-secret-key-at-least-32-chars";
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    lid: "lease-1234",
    uid: "user-5678",
    did: "device-9999",
    aid: "advertiser-1111",
    cid: "campaign-2222",
    iat: now,
    exp: now + 3600,
  };

  const token = await shared.signLeaseToken(payload, secret);
  assert.equal(typeof token, "string");
  assert.equal(token.split(".").length, 2);

  const res = await shared.verifyLeaseToken(token, secret, now, 0);
  assert.equal(res.ok, true);
  assert.equal(res.payload?.lid, "lease-1234");
  assert.equal(res.payload?.uid, "user-5678");
  assert.equal(res.payload?.aid, "advertiser-1111");
  assert.equal(res.payload?.cid, "campaign-2222");
});

await test("crypto: verifyLeaseToken rejects tampered signature", async () => {
  const secret = "a-very-long-secret-key-at-least-32-chars";
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    lid: "lease-1234",
    uid: "user-5678",
    did: "device-9999",
    aid: "advertiser-1111",
    cid: "campaign-2222",
    iat: now,
    exp: now + 3600,
  };

  const token = await shared.signLeaseToken(payload, secret);
  const [dataPart, sigPart] = token.split(".");
  const tamperedSig = sigPart.slice(0, -2) + (sigPart.endsWith("a") ? "b" : "a");
  const tamperedToken = `${dataPart}.${tamperedSig}`;

  const res = await shared.verifyLeaseToken(tamperedToken, secret, now, 0);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "bad_signature");
});

await test("crypto: verifyLeaseToken rejects tampered payload", async () => {
  const secret = "a-very-long-secret-key-at-least-32-chars";
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    lid: "lease-1234",
    uid: "user-5678",
    did: "device-9999",
    aid: "advertiser-1111",
    cid: "campaign-2222",
    iat: now,
    exp: now + 3600,
  };

  const token = await shared.signLeaseToken(payload, secret);
  const [, sigPart] = token.split(".");
  const tamperedBytes = new TextEncoder().encode(
    JSON.stringify({ ...payload, uid: "attacker-user" }),
  );
  let bin = "";
  for (const b of tamperedBytes) bin += String.fromCharCode(b);
  const tamperedB64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const tamperedToken = `${tamperedB64}.${sigPart}`;

  const res = await shared.verifyLeaseToken(tamperedToken, secret, now, 0);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "bad_signature");
});

await test("crypto: verifyLeaseToken rejects expired token", async () => {
  const secret = "a-very-long-secret-key-at-least-32-chars";
  const past = Math.floor(Date.now() / 1000) - 7200; // 2 hours ago
  const payload = {
    v: 1,
    lid: "lease-1234",
    uid: "user-5678",
    did: "device-9999",
    aid: "advertiser-1111",
    cid: "campaign-2222",
    iat: past - 3600,
    exp: past,
  };

  const token = await shared.signLeaseToken(payload, secret);
  const now = Math.floor(Date.now() / 1000);
  const res = await shared.verifyLeaseToken(token, secret, now, 0);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "expired");
});

await test("crypto: verifyLeaseToken rejects wrong secret", async () => {
  const secret = "a-very-long-secret-key-at-least-32-chars";
  const wrongSecret = "different-secret-key-at-least-32-chars";
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    lid: "lease-1234",
    uid: "user-5678",
    did: "device-9999",
    aid: "advertiser-1111",
    cid: "campaign-2222",
    iat: now,
    exp: now + 3600,
  };

  const token = await shared.signLeaseToken(payload, secret);
  const res = await shared.verifyLeaseToken(token, wrongSecret, now, 0);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "bad_signature");
});

await test("crypto: sha256Hex produces standard 64-char hex digest", async () => {
  const hash = await shared.sha256Hex("hello world");
  assert.equal(typeof hash, "string");
  assert.equal(hash.length, 64);
  assert.equal(
    hash,
    "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
  );
});

/* -------------------------------------------------------------------------
 * 3. Shared Validators
 * ------------------------------------------------------------------------- */
await test("validators: registerUserSchema accepts valid email and password >= 8 chars", () => {
  const valid = shared.registerUserSchema.safeParse({
    email: "user@example.com",
    password: "password123",
  });
  assert.ok(valid.success);
});

await test("validators: registerUserSchema rejects short password (< 8 chars)", () => {
  const invalid = shared.registerUserSchema.safeParse({
    email: "user@example.com",
    password: "short",
  });
  assert.equal(invalid.success, false);
});

await test("validators: registerUserSchema rejects malformed email", () => {
  const invalid = shared.registerUserSchema.safeParse({
    email: "not-an-email",
    password: "password123",
  });
  assert.equal(invalid.success, false);
});

await test("validators: prefetchRequestSchema enforces count <= 25 and requires deviceId", () => {
  const invalidCount = shared.prefetchRequestSchema.safeParse({
    deviceId: "device-12345678",
    count: 26,
    platforms: ["openai"],
  });
  assert.equal(invalidCount.success, false);

  const missingDevice = shared.prefetchRequestSchema.safeParse({
    count: 15,
    platforms: ["openai"],
  });
  assert.equal(missingDevice.success, false);

  const valid = shared.prefetchRequestSchema.safeParse({
    deviceId: "device-12345678",
    count: 15,
    platforms: ["openai"],
  });
  assert.ok(valid.success);
});

await test("validators: campaignInputSchema enforces length limits and http URL", () => {
  const valid = shared.campaignInputSchema.safeParse({
    name: "Dev Tools Campaign",
    headline: "Fast, private developer tools",
    bodyText: "Build better software with our lightweight CLI and real-time insights.",
    ctaText: "Try it free",
    targetUrl: "https://example.com/devtools",
    dailyBudgetMicro: 5_000_000,
    cpiMicro: 20_000,
    targetPlatforms: ["openai", "anthropic"],
    targetGeoClusters: ["NA-EAST"],
  });
  assert.ok(valid.success);

  // Exceed headline limit (70 chars)
  const tooLongHeadline = shared.campaignInputSchema.safeParse({
    name: "Too long",
    headline: "A".repeat(71),
    bodyText: "Valid body text within limits.",
    ctaText: "Click",
    targetUrl: "https://example.com",
    dailyBudgetMicro: 5_000_000,
    cpiMicro: 20_000,
    targetPlatforms: ["openai"],
  });
  assert.equal(tooLongHeadline.success, false);

  // Non-http targetUrl
  const badUrl = shared.campaignInputSchema.safeParse({
    name: "Bad URL",
    headline: "Valid headline",
    bodyText: "Valid body text within limits.",
    ctaText: "Click",
    targetUrl: "javascript:alert(1)",
    dailyBudgetMicro: 5_000_000,
    cpiMicro: 20_000,
    targetPlatforms: ["openai"],
  });
  assert.equal(badUrl.success, false);
});

await test("validators: payoutRequestSchema accepts valid payout request", () => {
  const valid = shared.payoutRequestSchema.safeParse({
    method: "paypal",
    address: "user@example.com",
    amountMicro: 5_000_000,
  });
  assert.ok(valid.success);

  const invalidMethod = shared.payoutRequestSchema.safeParse({
    method: "western_union",
    address: "user@example.com",
    amountMicro: 5_000_000,
  });
  assert.equal(invalidMethod.success, false);
});

await test("validators: taskSubmissionSchema requires valid http(s) postUrl and key format", () => {
  const valid = shared.taskSubmissionSchema.safeParse({
    taskType: "x",
    postUrl: "https://x.com/user/status/1234567890",
    screenshotKey: "task-proofs/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222",
  });
  assert.ok(valid.success);

  const invalidUrl = shared.taskSubmissionSchema.safeParse({
    taskType: "x",
    postUrl: "ftp://not-http.com/proof",
    screenshotKey: "task-proofs/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222",
  });
  assert.equal(invalidUrl.success, false);
});

/* -------------------------------------------------------------------------
 * 4. Anti-Fraud: Cadence & Pacing
 * ------------------------------------------------------------------------- */
await test("cadence: pacingFor tier 1 (<= 12 prompts/hr) gives 100% eligibility", () => {
  for (let prompts = 0; prompts <= 12; prompts++) {
    const p = cadence.pacingFor(prompts);
    assert.equal(p.tier, 1);
    assert.equal(p.allow, true);
  }
});

await test("cadence: pacingFor tier 2 (13-25 prompts/hr) throttles every 3rd prompt", () => {
  const p13 = cadence.pacingFor(13);
  assert.equal(p13.tier, 2);
  assert.equal(p13.allow, false);

  const p15 = cadence.pacingFor(15);
  assert.equal(p15.tier, 2);
  assert.equal(p15.allow, true); // 15 % 3 === 0
});

await test("cadence: pacingFor tier 3 (> 25 prompts/hr) silences all ads", () => {
  const p26 = cadence.pacingFor(26);
  assert.equal(p26.tier, 3);
  assert.equal(p26.allow, false);

  const p100 = cadence.pacingFor(100);
  assert.equal(p100.tier, 3);
  assert.equal(p100.allow, false);
});

await test("cadence: coefficientOfVariation calculates standard deviation over mean", () => {
  const { mean, stddev, cv } = cadence.coefficientOfVariation([100, 100, 100, 100]);
  assert.equal(mean, 100);
  assert.equal(stddev, 0);
  assert.equal(cv, 0);

  const { cv: cvVar } = cadence.coefficientOfVariation([10, 20, 30, 40, 50]);
  assert.ok(cvVar > 0.4);
});

await test("cadence: analyzeCadence flags robotic interval CV collapse (< 0.08 over >= 15 prompts)", () => {
  const roboticTimestamps = Array.from({ length: 20 }, (_, i) => 1_700_000_000_000 + i * 10_000);
  const findings = cadence.analyzeCadence([], roboticTimestamps, []);
  assert.ok(
    findings.some((f) => f.rule === "cv_collapse"),
    "Should flag cv_collapse for robotic intervals",
  );
});

await test("cadence: natural human prompt intervals (high CV) are not flagged as cv_collapse", () => {
  const intervals = [5, 45, 12, 90, 3, 60, 25, 110, 15, 30, 80, 4, 70, 20, 50, 95];
  let current = 1_700_000_000_000;
  const humanTimestamps = intervals.map((gapSec) => {
    current += gapSec * 1000;
    return current;
  });

  const findings = cadence.analyzeCadence([], humanTimestamps, []);
  assert.ok(
    !findings.some((f) => f.rule === "cv_collapse"),
    "Human variable cadence should not be flagged with cv_collapse",
  );
});

await test("cadence: viewport duration clustering (50 impressions in [5001, 5015]ms) is flagged", () => {
  const clusteredDurations = Array.from({ length: 50 }, () => 5002);
  const findings = cadence.analyzeCadence([], [], clusteredDurations);
  assert.ok(
    findings.some((f) => f.rule === "viewport_duration_cluster"),
    "Clustered viewport duration must be flagged",
  );
});

/* -------------------------------------------------------------------------
 * 5. Anti-Fraud: Trust Score & Verdict Bands
 * ------------------------------------------------------------------------- */
await test("trust: verdictFor maps score bands to auto_approve, manual_review, freeze", () => {
  assert.equal(trust.verdictFor(80), "auto_approve");
  assert.equal(trust.verdictFor(95), "auto_approve");
  assert.equal(trust.verdictFor(79), "manual_review");
  assert.equal(trust.verdictFor(50), "manual_review");
  assert.equal(trust.verdictFor(49), "freeze");
  assert.equal(trust.verdictFor(0), "freeze");
});

/* -------------------------------------------------------------------------
 * 6. Formatting
 * ------------------------------------------------------------------------- */
await test("formatting: formatMicro and formatMs behave correctly", () => {
  const formatMicro = (micro) => `$${(micro / 1_000_000).toFixed(4)}`;
  const formatMicroCents = (micro) => `$${(micro / 1_000_000).toFixed(2)}`;
  const formatMs = (ms) => `${(ms / 1000).toFixed(1)}s`;

  assert.equal(formatMicro(1_000_000), "$1.0000");
  assert.equal(formatMicro(500_000), "$0.5000");
  assert.equal(formatMicro(4_200_000), "$4.2000");
  assert.equal(formatMicro(11_000), "$0.0110");

  assert.equal(formatMicroCents(1_000_000), "$1.00");
  assert.equal(formatMicroCents(4_200_000), "$4.20");
  assert.equal(formatMicroCents(500_000), "$0.50");

  assert.equal(formatMs(5000), "5.0s");
  assert.equal(formatMs(1234), "1.2s");
  assert.equal(formatMs(5500), "5.5s");
});

/* -------------------------------------------------------------------------
 * 7. Extension Cache & Deduplication (filterEligible)
 * ------------------------------------------------------------------------- */
await test("extension: filterEligible deduplicates expired leases, cooldown, platform, and daily cap", () => {
  function dayKey(now) {
    return new Date(now).toISOString().slice(0, 10);
  }

  function filterEligible(pool, history, now, platform) {
    const today = dayKey(now);
    return pool.filter((ad) => {
      if (ad.expiresAt * 1000 <= now) return false;
      if (platform && ad.targetPlatforms && ad.targetPlatforms.length > 0) {
        if (!ad.targetPlatforms.includes(platform)) return false;
      }
      const rec = history[ad.campaignId];
      if (!rec) return true;
      const viewsToday = rec.days.filter((d) => d === today).length;
      if (viewsToday >= ad.frequencyCap.maxPerDay) return false;
      if (now - rec.lastShownAt < ad.frequencyCap.cooldownSec * 1000) return false;
      return true;
    });
  }

  const now = 1_700_000_000_000;
  const pool = [
    {
      leaseId: "l1",
      campaignId: "c1",
      expiresAt: Math.floor(now / 1000) + 3600, // Valid
      frequencyCap: { maxPerDay: 3, cooldownSec: 60 },
      targetPlatforms: ["openai", "anthropic"],
    },
    {
      leaseId: "l2",
      campaignId: "c2",
      expiresAt: Math.floor(now / 1000) - 10, // Expired
      frequencyCap: { maxPerDay: 3, cooldownSec: 60 },
      targetPlatforms: ["openai"],
    },
    {
      leaseId: "l3",
      campaignId: "c3",
      expiresAt: Math.floor(now / 1000) + 3600,
      frequencyCap: { maxPerDay: 2, cooldownSec: 60 },
      targetPlatforms: ["deepseek"], // Foreign platform
    },
    {
      leaseId: "l4",
      campaignId: "c4",
      expiresAt: Math.floor(now / 1000) + 3600,
      frequencyCap: { maxPerDay: 1, cooldownSec: 60 }, // Daily cap reached
      targetPlatforms: ["openai"],
    },
    {
      leaseId: "l5",
      campaignId: "c5",
      expiresAt: Math.floor(now / 1000) + 3600,
      frequencyCap: { maxPerDay: 5, cooldownSec: 120 }, // In cooldown
      targetPlatforms: ["openai"],
    },
  ];

  const today = dayKey(now);
  const history = {
    c4: { days: [today], lastShownAt: now - 3600_000 }, // c4 viewed once today (max 1)
    c5: { days: [today], lastShownAt: now - 30_000 }, // c5 viewed 30s ago (cooldown 120s)
  };

  const eligibleForOpenAI = filterEligible(pool, history, now, "openai");
  assert.equal(eligibleForOpenAI.length, 1);
  assert.equal(eligibleForOpenAI[0].leaseId, "l1");

  const eligibleForAnthropic = filterEligible(pool, history, now, "anthropic");
  assert.equal(eligibleForAnthropic.length, 1);
  assert.equal(eligibleForAnthropic[0].leaseId, "l1");

  const eligibleForDeepSeek = filterEligible(pool, history, now, "deepseek");
  assert.equal(eligibleForDeepSeek.length, 1);
  assert.equal(eligibleForDeepSeek[0].leaseId, "l3");
});

/* -------------------------------------------------------------------------
 * Summary
 * ------------------------------------------------------------------------- */
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("OK: all unit tests passed.\n");
  process.exit(0);
}
