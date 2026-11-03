#!/usr/bin/env node
/**
 * End-to-end smoke test for the API surfaces the demo depends on.
 *
 * Usage:
 *   pnpm smoke                      # against http://127.0.0.1:3001
 *   API_BASE=http://host:3001 pnpm smoke
 *
 * Requires a running API, a migrated database, and a reachable classifier
 * (Laya on :8000, or the offline stub on :8080 with LAYA_ENDPOINT pointed at
 * it). It registers throwaway accounts, so run it against a dev database only.
 *
 * The referral check needs two distinct client IPs, because a signup sharing
 * the referrer's IP is deliberately refused as a self-referral. On one machine
 * that is still possible without weakening the rule: a loopback client can
 * bind its source address (SMOKE_LOCAL_ADDRESS, default 127.0.0.2), so the API
 * sees a genuinely different network origin for the referred user.
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { randomUUID } from "node:crypto";

const API = (process.env.API_BASE ?? "http://127.0.0.1:3001").replace(/\/+$/, "");
const ADMIN_KEY = process.env.ADMIN_API_KEY;
const LOCAL_ADDRESS = process.env.SMOKE_LOCAL_ADDRESS ?? "127.0.0.2";
// Unrelated registrations use their own loopback sources so a run consumes the
// /auth/register budget (8 per 10 min per IP) on as few addresses as possible.
const SPARE_ADDRESS = "127.0.0.3";
const SPARE_ADDRESS_2 = "127.0.0.4";

const base = new URL(API);
const transport = base.protocol === "https:" ? httpsRequest : httpRequest;
const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(base.hostname);

const results = [];
const skipped = [];

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/** An environment limit (register rate limit) is neither a pass nor a bug. */
function skip(name, detail) {
  skipped.push({ name, detail });
  console.log(`SKIP  ${name}${detail ? `  — ${detail}` : ""}`);
}

const limited = (res) => res.status === 429;

/**
 * `localAddress` pins the source IP of the connection. Every loopback client
 * otherwise defaults to 127.0.0.1 regardless of the destination, which is why
 * a plain fetch to 127.0.0.2 still looks like the same client to the server.
 */
function call(path, token, body, opts = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = transport(
      {
        hostname: base.hostname,
        port: base.port || (base.protocol === "https:" ? 443 : 80),
        path,
        method: payload === null ? "GET" : "POST",
        headers: {
          ...(payload === null
            ? {}
            : {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload),
              }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(opts.headers ?? {}),
        },
        localAddress: opts.localAddress,
        timeout: 20_000,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => {
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            json = text;
          }
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`timeout: ${path}`)));
    req.on("error", reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

/** Same API, different client network origin. */
function alt(path, token, body) {
  return call(path, token, body, { localAddress: LOCAL_ADDRESS });
}

let seq = 0;
function email(label) {
  return `${label}-${Date.now()}-${seq++}@smoke.invalid`;
}

async function registerUser(label, extra = {}, opts = {}) {
  const address = email(label);
  const res = await call(
    "/auth/register",
    null,
    { email: address, password: "correct-horse-battery", ...extra },
    opts,
  );
  return { ...res, email: address };
}

async function waitForApi() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await call("/health", null, undefined);
      if (res.status === 200) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/* --------------------------- advertiser auth --------------------------- */
async function advertiserChecks() {
  const address = email("adv");

  const registered = await call("/advertiser/register", null, {
    email: address,
    password: "advertiser-pass-123",
    companyName: "Smoke Test Co.",
  });
  check(
    "advertiser register returns an access + refresh session",
    registered.status === 200 &&
      !!registered.json.accessToken &&
      !!registered.json.refreshToken &&
      registered.json.refreshExpiresAt > Date.now(),
    `status ${registered.status}`,
  );

  const login = await call("/advertiser/login", null, {
    email: address,
    password: "advertiser-pass-123",
  });
  check("advertiser login returns a session", login.status === 200 && !!login.json.accessToken);

  const wrong = await call("/advertiser/login", null, {
    email: address,
    password: "definitely-wrong",
  });
  check("wrong advertiser password rejected", wrong.status === 401, `status ${wrong.status}`);

  const duplicate = await call("/advertiser/register", null, {
    email: address,
    password: "advertiser-pass-123",
    companyName: "Smoke Test Co.",
  });
  check("duplicate advertiser email rejected", duplicate.status === 409, `status ${duplicate.status}`);

  const rotated = await call("/advertiser/refresh", null, {
    refreshToken: login.json.refreshToken,
  });
  check(
    "advertiser refresh rotates the session",
    rotated.status === 200 &&
      !!rotated.json.refreshToken &&
      rotated.json.refreshToken !== login.json.refreshToken,
    `status ${rotated.status}`,
  );

  const reused = await call("/advertiser/refresh", null, {
    refreshToken: login.json.refreshToken,
  });
  check("spent advertiser refresh token rejected", reused.status === 401, `status ${reused.status}`);

  const loggedOut = await call("/advertiser/logout", null, {
    refreshToken: rotated.json.refreshToken,
  });
  const afterLogout = await call("/advertiser/refresh", null, {
    refreshToken: rotated.json.refreshToken,
  });
  check(
    "advertiser logout revokes the session",
    loggedOut.status === 200 && afterLogout.status === 401,
    `logout ${loggedOut.status}, refresh ${afterLogout.status}`,
  );

  const viewer = await registerUser("scope", {}, { localAddress: isLoopback ? SPARE_ADDRESS : undefined });
  if (limited(viewer)) {
    skip("user and advertiser tokens are not interchangeable", "register rate limit");
  } else {
    const viewerOnPortal = await call("/advertiser/campaigns", viewer.json.accessToken);
    const advertiserOnUser = await call("/me/balance", login.json.accessToken);
    check(
      "user and advertiser tokens are not interchangeable",
      viewerOnPortal.status === 401 && advertiserOnUser.status === 401,
      `portal ${viewerOnPortal.status}, balance ${advertiserOnUser.status}`,
    );
  }

  return login.json.accessToken;
}

/* ------------------------- campaign + moderation ----------------------- */
async function campaignChecks(advertiserToken, cpiMicro) {
  const created = await call("/advertiser/campaigns", advertiserToken, {
    name: `Smoke campaign ${Date.now()}`,
    headline: "Ship faster with DevTools Pro",
    bodyText: "A debugger that understands async stacks. Free for 14 days while you wait on AI.",
    ctaText: "Try free",
    targetUrl: "https://example.com/devtools",
    dailyBudgetMicro: 100_000_000,
    cpiMicro,
    targetPlatforms: ["openai"],
    targetGeoClusters: [],
  });
  const campaign = created.json?.campaign;
  const decision = created.json?.moderation?.decision;
  check(
    "advertiser creates a campaign through moderation",
    created.status === 200 && !!campaign?.id && typeof decision === "string",
    `status ${created.status}, moderation ${decision}`,
  );
  if (!campaign?.id) return null;

  const listed = await call("/advertiser/campaigns", advertiserToken);
  check(
    "campaign is listed for its owner",
    listed.status === 200 && listed.json.some?.((c) => c.id === campaign.id),
    `count ${Array.isArray(listed.json) ? listed.json.length : "?"}`,
  );

  // A clean creative should pass the classifier. If it lands in human review
  // instead, approve it through the reviewer API so the money path can still be
  // exercised. That is the documented reviewer flow, not an auto-approve.
  if (campaign.status !== "active") {
    if (!ADMIN_KEY) {
      check(
        "campaign serves traffic",
        false,
        `moderation returned ${decision}; set ADMIN_API_KEY to approve it in the smoke run`,
      );
      return campaign;
    }
    const approved = await call(
      `/admin/campaigns/${campaign.id}/review`,
      null,
      { decision: "approve", notes: "smoke test" },
      { headers: { "x-admin-key": ADMIN_KEY } },
    );
    check(
      "campaign approved by the reviewer queue",
      approved.status === 200 && approved.json.status === "active",
      `status ${approved.status}`,
    );
    return approved.json;
  }

  check(
    "clean creative is auto-approved by the classifier",
    decision === "auto_approved",
    String(decision),
  );
  return campaign;
}

/* ------------------------------ referral ------------------------------- */
async function referralChecks(cpiMicro) {
  const referrer = await registerUser("ref-a");
  if (limited(referrer)) {
    skip("referral checks", "register rate limit (8 per 10 min per IP); re-run later");
    return;
  }
  const stats = await call("/me/referrals", referrer.json.accessToken);
  check(
    "referrer gets a code and /r/ link",
    typeof stats.json.code === "string" && stats.json.link.endsWith(`/r/${stats.json.code}`),
    stats.json.link,
  );

  // Same client IP: the self-referral guard must refuse attribution.
  const sameIp = await registerUser("ref-same", { referralCode: stats.json.code });
  if (limited(sameIp)) {
    skip("same-IP signup is not attributed", "register rate limit");
  } else {
    const sameIpStats = await call("/me/referrals", referrer.json.accessToken);
    check(
      "same-IP signup is not attributed",
      sameIp.status === 200 && sameIpStats.json.total === 0,
      `total ${sameIpStats.json.total}`,
    );
  }

  const unknown = await registerUser(
    "ref-unknown",
    { referralCode: "deadbeef" },
    { localAddress: isLoopback ? SPARE_ADDRESS_2 : undefined },
  );
  if (limited(unknown)) {
    skip("unknown referral code does not break registration", "register rate limit");
  } else {
    check(
      "unknown referral code does not break registration",
      unknown.status === 200 && !!unknown.json.accessToken,
      `status ${unknown.status}`,
    );
  }

  // Distinct source address: attribution is legitimate and must be recorded.
  const referred = await registerUser("ref-b", { referralCode: stats.json.code }, {
    localAddress: LOCAL_ADDRESS,
  });
  if (limited(referred)) {
    skip("referral attribution", "register rate limit; re-run later");
    return;
  }
  const attributed = await call("/me/referrals", referrer.json.accessToken);
  check(
    "referral from a distinct network is attributed as pending",
    attributed.json.total === 1 && attributed.json.pending === 1,
    `total ${attributed.json.total}, pending ${attributed.json.pending}`,
  );
  if (attributed.json.total !== 1) {
    console.log(
      `      (attribution needs a distinct client IP; SMOKE_LOCAL_ADDRESS=${LOCAL_ADDRESS})`,
    );
    return;
  }

  /* Earn $1.00+ as the referred user so the bonus vests. */
  const deviceId = `smoke-${randomUUID()}`;
  const prefetched = await alt("/ads/prefetch", referred.json.accessToken, {
    deviceId,
    count: 5,
    platforms: ["openai"],
  });
  const ad = prefetched.json?.ads?.[0];
  check(
    "referred user receives a leased ad",
    prefetched.status === 200 && !!ad?.leaseToken,
    `status ${prefetched.status}, ads ${prefetched.json?.ads?.length ?? 0}`,
  );
  if (!ad) return;

  const batch = await alt("/telemetry/batch", referred.json.accessToken, {
    batchId: randomUUID(),
    deviceId,
    extensionVersion: "smoke",
    sentAt: Date.now(),
    events: [
      {
        impressionId: randomUUID(),
        leaseToken: ad.leaseToken,
        platform: "openai",
        placement: "under_prompt",
        displayMode: "wait_time_only",
        submittedAt: Date.now() - 5_700,
        aiWaitDurationMs: 5_700,
        cumulativeVisibleMs: 5_200,
        hoverMs: 640,
        hoverIntentional: true,
        closedReason: "earned",
        earned: true,
        pohi: {
          inputInteractionScore: 0.9,
          keystrokeCount: 14,
          trustedPasteSeen: false,
          aiMutationVerified: true,
        },
        promptsLastHour: 1,
      },
    ],
  });
  const result = batch.json?.results?.[0];
  const expectedEarn = Math.floor(cpiMicro * 0.55);
  check(
    "verified 5s view pays the 55% user share",
    result?.status === "verified" && result.earnedMicro === expectedEarn,
    `status ${result?.status}, earned ${result?.earnedMicro} of expected ${expectedEarn}`,
  );

  const vested = await call("/me/referrals", referrer.json.accessToken);
  const balance = await call("/me/balance", referrer.json.accessToken);
  check(
    "referral bonus vests after $1.00 of verified earnings",
    vested.json.paid === 1 && vested.json.earnedMicro === 500_000,
    `paid ${vested.json.paid}, earned ${vested.json.earnedMicro}`,
  );
  check(
    "referrer balance includes the $0.50 bonus",
    Number(balance.json.availableMicro) >= 500_000,
    `available ${balance.json.availableMicro}`,
  );
}

async function main() {
  if (!(await waitForApi())) {
    console.error(`API is not reachable at ${API}`);
    process.exit(1);
  }
  if (!isLoopback) {
    console.log(
      `note: ${base.hostname} is not loopback, so the distinct-IP referral leg will be skipped`,
    );
  }

  const advertiserToken = await advertiserChecks();
  // A high bid is not a shortcut around the vesting rule: it just means one
  // verified view can cross the $1.00 qualification threshold inside a test.
  const cpiMicro = 2_000_000;
  const campaign = await campaignChecks(advertiserToken, cpiMicro);
  if (campaign?.status === "active" && isLoopback) {
    await referralChecks(cpiMicro);
  } else if (campaign?.status !== "active") {
    check("referral vesting", false, "skipped: no active campaign to serve");
  }

  const failed = results.filter((r) => !r.ok);
  const passed = results.length - failed.length;
  console.log(
    `\n${passed}/${results.length} checks passed` +
      (skipped.length ? `, ${skipped.length} skipped` : "") +
      (failed.length ? ` — failing: ${failed.map((f) => f.name).join(", ")}` : ""),
  );
  process.exit(failed.length ? 1 : 0);
}

await main();
