#!/usr/bin/env node
/**
 * Drive the advertiser portal in a real browser and screenshot the analytics
 * section, verifying the hover-rate hint and geo column render with live data.
 *
 * Uses Playwright's Chromium via raw CDP (Node 26's global WebSocket; no new
 * dependencies). Prerequisites: web on :3000, API on :3001. The script seeds
 * everything it needs through the real API surface — it ensures an advertiser
 * account (PORTAL_EMAIL/PORTAL_PASSWORD), gives it an approved campaign with
 * one intentional-hover impression (via a user prefetch + verified telemetry
 * event, the same path the smoke script exercises), then logs in through the
 * real portal form. ADMIN_API_KEY must be set when the campaign needs manual
 * approval (mirrors apps/api/.env like scripts/smoke.mjs does).
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";

const CHROME = process.env.PLAYWRIGHT_CHROME;
if (!CHROME) {
  console.error("Set PLAYWRIGHT_CHROME to the Playwright Chromium binary path.");
  process.exit(1);
}
const API = (process.env.API_BASE ?? "http://127.0.0.1:3001").replace(/\/+$/, "");
const WEB = process.env.WEB_BASE ?? "http://127.0.0.1:3000";
const EMAIL = process.env.PORTAL_EMAIL ?? "ui-portal@example.test";
const PASSWORD = process.env.PORTAL_PASSWORD ?? "ui-portal-pass-123";
const OUT = process.env.OUT ?? "scripts/artifacts/portal-analytics.png";
const API_ENV_FILE = new URL("../apps/api/.env", import.meta.url);
// Real environment variables win (loadEnvFile never overwrites), matching
// scripts/smoke.mjs.
try {
  if (typeof process.loadEnvFile === "function") process.loadEnvFile(API_ENV_FILE);
} catch {
  // A malformed local .env should not stop the UI check.
}
const ADMIN_KEY = process.env.ADMIN_API_KEY;
mkdirSync("scripts/artifacts", { recursive: true });

/* ------------------------------ CDP client ------------------------------ */

class PageCdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function launchPage(url) {
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--user-data-dir=/tmp/ui-check-profile-${Date.now()}`,
      "--remote-debugging-port=0",
      url,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let browserWs = "";
  proc.stderr.on("data", (d) => {
    const m = String(d).match(/ws:\/\/[^\s]+/);
    if (m) browserWs = m[0];
  });
  const deadline = Date.now() + 15_000;
  while (!browserWs && Date.now() < deadline) await sleep(100);
  if (!browserWs) throw new Error("Chromium did not expose a CDP endpoint");

  // Find the page target's dedicated websocket.
  const port = new URL(browserWs).port;
  let pageWsUrl = "";
  for (let i = 0; i < 50 && !pageWsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page" && t.url.startsWith("http"));
      if (page) pageWsUrl = page.webSocketDebuggerUrl;
    } catch {
      // target list not ready yet
    }
    if (!pageWsUrl) await sleep(100);
  }
  if (!pageWsUrl) throw new Error("No page target found");

  const ws = new WebSocket(pageWsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  return { proc, cdp: new PageCdp(ws), ws };
}

const evalJs = (cdp, expression, awaitPromise = false) =>
  cdp
    .send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise })
    .then((r) => {
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? "page eval failed");
      return r.result?.value;
    });

/* --------------------------- API helpers --------------------------- */

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

/** Ensure the account exists; returns an advertiser access token. */
async function ensureAdvertiser() {
  const login = await api("/advertiser/login", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (login.status === 200) return login.json.accessToken ?? null;
  const reg = await api("/advertiser/register", {
    method: "POST",
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, companyName: "Portal Check" }),
  });
  if (reg.status === 200) return reg.json.accessToken ?? null;
  if (reg.status === 409) return null; // exists with other credentials; the login form will surface it
  throw new Error(`advertiser setup failed: ${reg.status} ${JSON.stringify(reg.json).slice(0, 200)}`);
}

/* ----------------------------- seeding -------------------------------- */

const CPI_MICRO = 10_000_000; // $10 cpi keeps a single verified view decisive

/**
 * Give the advertiser at least one campaign with impression data, so the
 * portal's analytics section has live rows to render. Creates the campaign
 * through moderation (approving via the reviewer queue when the classifier
 * does not auto-approve), then drives the real earning path — user prefetch +
 * verified telemetry impression with an intentional hover.
 *
 * Bid-weighted sampling across every active campaign can serve another
 * advertiser's ad, so prefetches retry with `excludeCampaignIds` (its
 * documented purpose: campaigns the client already holds) until one of the
 * portal's own campaigns is served. Idempotent: returns early once any of the
 * advertiser's active campaigns already has views.
 */
async function seedCampaign(advertiserToken) {
  if (!advertiserToken) return;

  const authHeaders = { authorization: `Bearer ${advertiserToken}` };
  const listed = await api("/advertiser/campaigns", { headers: authHeaders });
  if (listed.status !== 200) throw new Error(`campaign list failed: ${listed.status}`);
  let ours = (Array.isArray(listed.json) ? listed.json : []).filter((c) => c.status === "active");

  if (ours.length > 0) {
    for (const c of ours) {
      const analytics = await api(`/advertiser/campaigns/${c.id}/analytics`, { headers: authHeaders });
      if (analytics.status === 200 && analytics.json?.totals?.views >= 1) return;
    }
  } else {
    const created = await api("/advertiser/campaigns", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: `Portal check ${Date.now()}`,
        headline: "Ship faster with DevTools Pro",
        bodyText: "A debugger that understands async stacks. Free for 14 days while you wait on AI.",
        ctaText: "Try free",
        targetUrl: "https://example.com/devtools",
        dailyBudgetMicro: 100_000_000,
        cpiMicro: CPI_MICRO,
        targetPlatforms: ["openai"],
        targetGeoClusters: [],
      }),
    });
    const campaign = created.json?.campaign;
    if (created.status !== 200 || !campaign?.id) {
      throw new Error(`campaign create failed: ${created.status} ${JSON.stringify(created.json).slice(0, 200)}`);
    }
    if (campaign.status !== "active") {
      if (!ADMIN_KEY) throw new Error("campaign needs review approval but ADMIN_API_KEY is unset");
      const approved = await api(`/admin/campaigns/${campaign.id}/review`, {
        method: "POST",
        headers: { "x-admin-key": ADMIN_KEY },
        body: JSON.stringify({ decision: "approve", notes: "ui check" }),
      });
      if (approved.status !== 200 || approved.json.status !== "active") {
        throw new Error(`campaign approve failed: ${approved.status}`);
      }
    }
    ours = [campaign];
  }

  const ourIds = new Set(ours.map((c) => c.id));

  // One user account to carry the impression (register budget allows ~8/10min).
  const user = await api("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `ui-user-${Date.now()}@example.test`,
      password: "correct-horse-battery",
      deviceId: `ui-check-${randomUUID()}`,
    }),
  });
  if (user.status !== 200) throw new Error(`user register failed: ${user.status} ${JSON.stringify(user.json).slice(0, 120)}`);
  const userToken = user.json.accessToken;

  const deviceId = `ui-check-${randomUUID()}`;
  const seenForeign = [];
  let ad = null;
  for (let attempt = 0; attempt < 8 && !ad; attempt++) {
    const prefetched = await api("/ads/prefetch", {
      method: "POST",
      headers: { authorization: `Bearer ${userToken}` },
      body: JSON.stringify({
        deviceId,
        count: 25,
        platforms: ["openai"],
        // Keep the exclusion list within the schema cap; the most recently
        // served campaigns are the ones most likely to be picked again.
        excludeCampaignIds: seenForeign.slice(-50),
      }),
    });
    if (prefetched.status !== 200) throw new Error(`prefetch failed: ${prefetched.status}`);
    const ads = prefetched.json?.ads ?? [];
    ad = ads.find((a) => ourIds.has(a.campaignId)) ?? null;
    for (const a of ads) if (!ourIds.has(a.campaignId)) seenForeign.push(a.campaignId);
    console.log(`prefetch attempt ${attempt + 1}: ${ads.length} ad(s), portal campaign ${ad ? "served" : "not served"}`);
  }
  if (!ad) throw new Error("prefetch never served one of the portal's campaigns");

  const batch = await api("/telemetry/batch", {
    method: "POST",
    headers: { authorization: `Bearer ${userToken}` },
    body: JSON.stringify({
      batchId: randomUUID(),
      deviceId,
      extensionVersion: "ui-check",
      sentAt: Date.now(),
      events: [
        {
          impressionId: randomUUID(),
          leaseToken: ad.leaseToken,
          platform: "openai",
          placement: "thinking_indicator",
          displayMode: "wait_time_only",
          submittedAt: Date.now() - 5_700,
          aiWaitDurationMs: 5_700,
          cumulativeVisibleMs: 5_200,
          hoverMs: 640,
          hoverIntentional: true,
          closedReason: "earned",
          earned: true,
          pohi: { inputInteractionScore: 0.9, keystrokeCount: 14, trustedPasteSeen: false, aiMutationVerified: true },
          promptsLastHour: 1,
        },
      ],
    }),
  });
  const result = batch.json?.results?.[0];
  if (batch.status !== 200 || result?.status !== "verified") {
    throw new Error(`telemetry failed: ${batch.status} ${JSON.stringify(batch.json).slice(0, 200)}`);
  }

  const analytics = await api(`/advertiser/campaigns/${ad.campaignId}/analytics`, { headers: authHeaders });
  const totals = analytics.json?.totals;
  if (analytics.status !== 200 || !totals || totals.views < 1 || totals.intentionalHovers < 1) {
    throw new Error(
      `seeded impression did not land on the portal campaign: ${analytics.status}, views ${totals?.views}, hovers ${totals?.intentionalHovers}`,
    );
  }
  console.log(`seeded campaign ${ad.campaignId}: ${totals.views} view(s), hoverRate ${totals.hoverRate}`);
}

/* ------------------------------ drive UI ------------------------------ */

const advertiserToken = await ensureAdvertiser();
await seedCampaign(advertiserToken);

const { proc, cdp, ws } = await launchPage(`${WEB}/advertiser`);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");

// Sign in through the real form so the full UI flow is exercised. The portal
// is SSR-rendered; if the submit lands before React hydrates, the browser does
// a native GET submit (destroying the execution context). Retry instead: fill +
// requestSubmit, then check whether the login form is still there.
let submitted = false;
for (let attempt = 0; attempt < 10 && !submitted; attempt++) {
  const outcome = await evalJs(
    cdp,
    `(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 40; i++) {
        if (document.querySelector('input[id="adv-email"]')) break;
        await wait(250);
      }
      const setVal = (el, val) => {
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const email = document.querySelector('input[id="adv-email"]');
      if (!email) return "login-form-missing";
      setVal(email, ${JSON.stringify(EMAIL)});
      const pass = document.querySelector('input[type="password"]');
      setVal(pass, ${JSON.stringify(PASSWORD)});
      document.querySelector("form")?.requestSubmit();
      await wait(1200);
      return document.querySelector('input[id="adv-email"]') ? "still-on-login" : "left-login";
    })()`,
    true,
  ).catch((err) => {
    // Execution context destroyed = native navigation; the page reloaded.
    console.log(`submit attempt ${attempt + 1}: ${err.message}`);
    return "context-destroyed";
  });
  if (outcome === "left-login") submitted = true;
  else await sleep(800);
}
if (!submitted) throw new Error("could not sign in through the login form");

// The portal renders analytics only after a campaign row is selected
// (`selected` starts null), so click the first live campaign row.
let clicked = false;
for (let i = 0; i < 40 && !clicked; i++) {
  clicked =
    (await evalJs(
      cdp,
      `(() => {
        const heads = Array.from(document.querySelectorAll("h2"));
        const campaigns = heads.find((h) => h.textContent.trim() === "Campaigns");
        if (!campaigns) return false;
        const row = campaigns.parentElement.querySelector("tbody tr");
        if (!row) return false;
        row.click();
        return true;
      })()`,
    ).catch(() => false)) ?? false;
  if (!clicked) await sleep(500);
}
if (!clicked) throw new Error("campaign list never rendered a clickable row");

// Wait for the portal's Analytics section (means auth + campaign select + fetch).
let ready = false;
const deadline = Date.now() + 30_000;
while (Date.now() < deadline) {
  const has = await evalJs(cdp, `document.body.innerText.includes("Analytics")`).catch(() => false);
  if (has) {
    ready = true;
    break;
  }
  await sleep(400);
}
if (!ready) {
  const text = await evalJs(cdp, `document.body.innerText.slice(0, 400)`).catch(() => "");
  throw new Error(`Analytics section never appeared. Body: ${text}`);
}

await sleep(2500); // let analytics + geo table load

const hoverHint = await evalJs(
  cdp,
  `document.body.innerText.includes("% of views")`,
).catch(() => null);
const hoverCol = await evalJs(
  cdp,
  `Array.from(document.querySelectorAll("th")).some((th) => th.textContent.trim() === "Hover rate")`,
).catch(() => null);
console.log(`hover-rate hint on tile: ${hoverHint}`);
console.log(`hover-rate column in geo table: ${hoverCol}`);

// Record what actually rendered, so the run log shows the live numbers.
const rendered = await evalJs(
  cdp,
  `(() => {
    const texts = [];
    const stat = Array.from(document.querySelectorAll("div")).find((d) =>
      d.textContent.trim().startsWith("Intentional hovers") && d.textContent.includes("% of views"));
    if (stat) texts.push(stat.textContent.trim().replace(/\\s+/g, " ").slice(0, 120));
    const table = Array.from(document.querySelectorAll("table")).find((t) =>
      Array.from(t.querySelectorAll("th")).some((th) => th.textContent.trim() === "Hover rate"));
    if (table) texts.push(table.textContent.trim().replace(/\\s+/g, " ").slice(0, 200));
    return texts.join(" | ");
  })()`,
).catch(() => "");
if (rendered) console.log(`rendered: ${rendered}`);

// Scroll analytics into view and capture the full page.
await evalJs(
  cdp,
  `(() => {
    const tables = Array.from(document.querySelectorAll("table"));
    const geo = tables.find((t) => Array.from(t.querySelectorAll("th")).some((th) => th.textContent.trim() === "Hover rate"));
    const target = geo ?? document.body;
    target.scrollIntoView({ block: "center" });
  })()`,
);
await sleep(300);
await cdp
  .send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })
  .then((shot) => {
    writeFileSync(OUT, Buffer.from(shot.data, "base64"));
    console.log(`screenshot: ${OUT}`);
  });

ws.close();
proc.kill();
process.exit(hoverHint && hoverCol ? 0 : 1);
