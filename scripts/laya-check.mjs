#!/usr/bin/env node
/**
 * Laya moderation boundary suite.
 *
 * Drives the public moderation entry points from `apps/api/dist` against a
 * local fake classifier that speaks TypeSafe Jev's `POST /v1/systemone`. The
 * fake lets the suite pin every failure mode the fail-closed invariant depends
 * on — non-2xx, malformed bodies, missing category answers, timeouts, refused
 * connections — plus the score mapping, reputation adjustments, policy-first
 * ordering, and the exact request shape sent to the model.
 *
 * With `LAYA_ENDPOINT` pointing at a running real `laya-serve`, the suite also
 * probes the real checkpoint. Those probes are reported separately: the fake is
 * a protocol double, never evidence about the model.
 *
 * Usage:
 *   pnpm build && pnpm laya:check
 *   LAYA_ENDPOINT=http://127.0.0.1:8000 pnpm laya:check
 */
import { createServer } from "node:http";
import { existsSync } from "node:fs";

const DIST = new URL("../apps/api/dist/moderation/laya.js", import.meta.url);
if (!existsSync(DIST)) {
  console.error("apps/api/dist/moderation/laya.js is missing — run `pnpm build` first.");
  process.exit(2);
}

const { moderateCampaign, moderateTask } = await import(DIST.href);

/* --------------------------- fake classifier --------------------------- */

const AD_CLEAN = { legitimate_ad: 0.92, low_quality: 0.04, deceptive: 0.02, fraud: 0.02 };
const LINK_CLEAN = { normal: 0.92, promo: 0.03, phishing: 0.03, fraud: 0.02 };

let reply = null;
let latencyMs = 0;
let requests = [];

/** Build a Jev-shaped answer set for every question the client asked. */
function answer(body, probabilities, severity = 0) {
  const answers = {};
  for (const [id, question] of Object.entries(body?.questions ?? {})) {
    if (question?.type === "score") {
      answers[id] = {
        type: "score",
        score: severity,
        confidence: 0.9,
        probabilities: [0.9, 0.06, 0.03, 0.01],
      };
    } else {
      const top =
        Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "legitimate_ad";
      answers[id] = {
        type: "choice",
        choice: top,
        confidence: 0.9,
        answer_confidence: 0.9,
        probabilities,
      };
    }
  }
  return { model: "fake-laya", answers };
}

function defaultReply(body) {
  // Tasks ask about a `link`, ads about `shape`; pick the matching clean set.
  return { json: answer(body, body?.questions?.link ? LINK_CLEAN : AD_CLEAN) };
}

const server = createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/v1/systemone") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    requests.push({ body, raw, headers: req.headers });
    setTimeout(() => {
      let out;
      try {
        out = (reply ?? defaultReply)(body);
      } catch {
        out = { status: 500, json: { error: "handler_failed" } };
      }
      if (res.destroyed || res.writableEnded) return;
      const payload = out.raw ?? JSON.stringify(out.json ?? {});
      try {
        res.writeHead(out.status ?? 200, { "content-type": out.contentType ?? "application/json" });
        res.end(payload);
      } catch {
        // Client aborted after the classifier timeout; nothing to answer.
      }
    }, latencyMs);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const ENDPOINT = `http://127.0.0.1:${server.address().port}`;

/* ------------------------------- helpers -------------------------------- */

const cfg = (over = {}) => ({ endpoint: ENDPOINT, timeoutMs: 4000, enabled: true, ...over });

const adInput = (over = {}) => ({
  headline: "Ship faster with Acme CI",
  bodyText: "Run your test suite in parallel. Start free, no card required.",
  ctaText: "Start free",
  targetUrl: "https://acme-ci.com/pricing",
  advertiserAgeDays: 30,
  advertiserRejectedCount: 0,
  advertiserApprovedCount: 0,
  ...over,
});

const taskInput = (over = {}) => ({
  postUrl: "https://github.com/octocat/Hello-World",
  taskType: "follow",
  screenshotKey: "task-proofs/u/shot.png",
  accountAgeDays: 30,
  ...over,
});

function reset() {
  requests = [];
  latencyMs = 0;
  reply = defaultReply;
}

let passed = 0;
let failed = 0;
let skipped = 0;

function check(name, ok, detail = "") {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

function skip(name, detail = "") {
  skipped += 1;
  console.log(`SKIP  ${name}${detail ? `  — ${detail}` : ""}`);
}

const brief = (r) =>
  `score=${r.score} decision=${r.decision} layers=${r.layers.join("+")} reasons=${
    r.reasons.join(",") || "-"
  }`;

let outcome;

/* ---------------------- policy runs before the model -------------------- */

reset();
outcome = await moderateCampaign(adInput({ headline: "Make Money Fast with this one trick" }), cfg());
check(
  "blocked term hard-rejects without contacting the classifier",
  outcome.decision === "auto_rejected" &&
    outcome.score === 0 &&
    outcome.layers.join() === "policy" &&
    outcome.reasons.includes("blocked_term:make money fast") &&
    requests.length === 0,
  brief(outcome),
);

reset();
outcome = await moderateCampaign(adInput({ targetUrl: "not a url" }), cfg());
check(
  "malformed destination hard-rejects without contacting the classifier",
  outcome.decision === "auto_rejected" &&
    outcome.reasons.includes("invalid_url") &&
    requests.length === 0,
  brief(outcome),
);

reset();
outcome = await moderateCampaign(adInput({ targetUrl: "https://deals.xyz/offer" }), cfg());
check(
  "suspicious TLD is a reason, not a hard reject (classifier still runs)",
  requests.length === 1 && outcome.reasons.includes("suspicious_tld") && outcome.layers.includes("laya"),
  brief(outcome),
);

reset();
outcome = await moderateCampaign(adInput({ bodyText: "Huge savings!!!!!! today only" }), cfg());
check(
  "character repetition is flagged by policy and still reaches the classifier",
  requests.length === 1 && outcome.reasons.includes("character_repetition"),
  brief(outcome),
);

/* ---------------------------- score mapping ----------------------------- */

reset();
outcome = await moderateCampaign(adInput(), cfg());
check(
  "clean ad: 97 / auto_approved with no reasons",
  outcome.score === 97 &&
    outcome.decision === "auto_approved" &&
    outcome.reasons.length === 0 &&
    outcome.layers.join() === "policy,laya",
  brief(outcome),
);

reset();
reply = (body) => ({
  json: answer(body, { legitimate_ad: 0.02, low_quality: 0.02, deceptive: 0.02, fraud: 0.94 }, 3),
});
outcome = await moderateCampaign(adInput(), cfg());
check(
  "fraud 0.94: 5 / auto_rejected with fraud + severe reasons",
  outcome.score === 5 &&
    outcome.decision === "auto_rejected" &&
    outcome.reasons.includes("laya:fraud") &&
    outcome.reasons.includes("laya:severe"),
  brief(outcome),
);

reset();
reply = (body) => ({
  json: answer(body, { legitimate_ad: 0.1, low_quality: 0.05, deceptive: 0.6, fraud: 0.05 }, 1),
});
outcome = await moderateCampaign(adInput(), cfg());
check(
  "deceptive 0.6: 65 / needs_review",
  outcome.score === 65 &&
    outcome.decision === "needs_review" &&
    outcome.reasons.includes("laya:deceptive"),
  brief(outcome),
);

reset();
reply = (body) => ({
  json: answer(body, { legitimate_ad: 0.05, low_quality: 0.9, deceptive: 0.02, fraud: 0.03 }, 1),
});
outcome = await moderateCampaign(adInput(), cfg());
check(
  "low_quality 0.9 is recorded but does not reduce the score (honest-but-annoying stays eligible)",
  outcome.reasons.includes("laya:low_quality") &&
    outcome.score === 96 &&
    outcome.decision === "auto_approved",
  brief(outcome),
);

reset();
reply = (body) => ({
  json: answer(body, { legitimate_ad: 0.92, low_quality: 0.04, deceptive: -3, fraud: 1.7 }, 99),
});
outcome = await moderateCampaign(adInput(), cfg());
check(
  "out-of-range probabilities and severity are clamped (fraud 1.7 -> 1)",
  outcome.score === 0 &&
    outcome.decision === "auto_rejected" &&
    outcome.reasons.includes("laya:fraud") &&
    outcome.reasons.includes("laya:severe") &&
    Number.isInteger(outcome.score) &&
    outcome.score >= 0 &&
    outcome.score <= 100,
  brief(outcome),
);

reset();
reply = (body) => ({
  json: answer(body, { legitimate_ad: 0.92, low_quality: 0.04, deceptive: 0.02, fraud: "0.94" }),
});
outcome = await moderateCampaign(adInput(), cfg());
check(
  "non-numeric probabilities read as 0, never NaN",
  Number.isFinite(outcome.score) && outcome.score === 99 && !outcome.reasons.includes("laya:fraud"),
  brief(outcome),
);

/* ------------------------------ fail closed ----------------------------- */

const failures = [
  [
    "missing category answer",
    () => ({ json: { model: "fake-laya", answers: { severity: { type: "score", score: 0 } } } }),
  ],
  ["answers object missing", () => ({ json: { model: "fake-laya" } })],
  ["non-JSON body", () => ({ raw: "<html>bad gateway</html>", contentType: "text/html" })],
  [
    "category answer without probabilities",
    () => ({ json: { answers: { shape: { type: "choice", choice: "legitimate_ad" } } } }),
  ],
  ["HTTP 500", () => ({ status: 500, json: { error: "boom" } })],
];

for (const [label, respond] of failures) {
  reset();
  reply = respond;
  outcome = await moderateCampaign(adInput(), cfg());
  check(
    `${label}: fails closed to needs_review 50`,
    outcome.decision === "needs_review" &&
      outcome.score === 50 &&
      outcome.layers.includes("laya_unavailable") &&
      outcome.reasons.includes("laya_unavailable"),
    brief(outcome),
  );
}

reset();
latencyMs = 300;
const startedAt = Date.now();
outcome = await moderateCampaign(adInput(), cfg({ timeoutMs: 120 }));
const elapsed = Date.now() - startedAt;
check(
  "slow model is aborted inside the classifier budget and fails closed",
  outcome.decision === "needs_review" && outcome.score === 50 && elapsed < 1500,
  `${brief(outcome)} elapsed=${elapsed}ms`,
);

reset();
outcome = await moderateCampaign(adInput(), cfg({ endpoint: "http://127.0.0.1:1" }));
check(
  "connection refused fails closed",
  outcome.decision === "needs_review" && outcome.score === 50,
  brief(outcome),
);

reset();
outcome = await moderateCampaign(adInput(), cfg({ enabled: false }));
check(
  "LAYA_ENABLED=false fails closed instead of approving",
  outcome.decision === "needs_review" && requests.length === 0,
  brief(outcome),
);

reset();
outcome = await moderateCampaign(adInput(), cfg({ endpoint: `${ENDPOINT}///` }));
check(
  "endpoint with trailing slashes still resolves /v1/systemone",
  outcome.decision === "auto_approved" && requests.length === 1,
  brief(outcome),
);

/* ------------------------------ reputation ------------------------------ */

reset();
outcome = await moderateCampaign(adInput({ advertiserAgeDays: 0.5 }), cfg());
check(
  "new advertiser: -5 (92) but still approved",
  outcome.score === 92 &&
    outcome.decision === "auto_approved" &&
    outcome.reasons.includes("new_advertiser"),
  brief(outcome),
);

reset();
outcome = await moderateCampaign(adInput({ advertiserRejectedCount: 3 }), cfg());
check(
  "prior rejections: -20 pushes clean copy into review",
  outcome.score === 77 &&
    outcome.decision === "needs_review" &&
    outcome.reasons.includes("prior_rejections"),
  brief(outcome),
);

reset();
outcome = await moderateCampaign(adInput({ advertiserApprovedCount: 25 }), cfg());
check("established advertiser bonus cannot exceed 100", outcome.score === 100, brief(outcome));

reset();
reply = (body) => ({
  json: answer(body, { legitimate_ad: 0.02, low_quality: 0.02, deceptive: 0.02, fraud: 0.94 }, 3),
});
outcome = await moderateCampaign(
  adInput({ advertiserAgeDays: 999, advertiserApprovedCount: 999 }),
  cfg(),
);
check(
  "reputation never rescues fraud",
  outcome.decision === "auto_rejected" && outcome.score < 40,
  brief(outcome),
);

/* ----------------------------- social tasks ----------------------------- */

reset();
outcome = await moderateTask(taskInput({ postUrl: "ftp://example.com/post" }), cfg());
check(
  "task: non-http URL rejects before the classifier",
  outcome.decision === "auto_rejected" &&
    outcome.score === 0 &&
    requests.length === 0 &&
    outcome.reasons.includes("invalid_post_url"),
  brief(outcome),
);

reset();
outcome = await moderateTask(taskInput(), cfg());
check(
  "task: clean link never auto-approves (screenshot unverified)",
  outcome.decision === "needs_review" &&
    outcome.score === 94 &&
    outcome.reasons.includes("screenshot_unverified"),
  brief(outcome),
);

reset();
reply = (body) => ({ json: answer(body, { normal: 0.02, promo: 0.01, phishing: 0.88, fraud: 0.05 }) });
outcome = await moderateTask(taskInput({ postUrl: "https://secure-verify-account.top/login" }), cfg());
check(
  "task: phishing 0.88 auto-rejects",
  outcome.decision === "auto_rejected" &&
    outcome.score === 0 &&
    outcome.reasons.includes("laya:phishing"),
  brief(outcome),
);

reset();
reply = (body) => ({ json: answer(body, { normal: 0.05, promo: 0.05, phishing: 0.1, fraud: 0.1 }) });
outcome = await moderateTask(taskInput(), cfg());
check(
  "task: low phishing/fraud stays in review",
  outcome.decision === "needs_review" && outcome.score === 77,
  brief(outcome),
);

reset();
outcome = await moderateTask(taskInput({ accountAgeDays: 0.2 }), cfg());
check(
  "task: new account -10 (84) still needs review",
  outcome.score === 84 &&
    outcome.decision === "needs_review" &&
    outcome.reasons.includes("new_account"),
  brief(outcome),
);

/* -------------------------- protocol conformance ------------------------ */

reset();
await moderateCampaign(adInput(), cfg());
const sent = requests[0];
const sentKeys = sent ? Object.keys(sent.body ?? {}).sort() : [];
const questions = sent?.body?.questions ?? {};
check(
  "protocol: POST /v1/systemone with only {state, questions}",
  Boolean(sent) &&
    sentKeys.join(",") === "questions,state" &&
    sent.headers["content-type"] === "application/json",
  sentKeys.join(","),
);
check(
  "protocol: ad state carries headline, body, CTA, and destination under `post`",
  typeof sent?.body?.state?.post === "string" &&
    ["Headline: ", "Body: ", "Call to action: ", "Destination: "].every((label) =>
      sent.body.state.post.includes(label),
    ) &&
    sent.body.state.post.includes("https://acme-ci.com/pricing"),
  sent ? `${String(sent.body.state.post).split("\n").length} lines` : "no request",
);
check(
  "protocol: one 4-way choice plus an ordinal severity head",
  questions.shape?.type === "choice" &&
    Object.keys(questions.shape?.criteria ?? {}).join(",") ===
      "legitimate_ad,low_quality,deceptive,fraud" &&
    questions.severity?.type === "score" &&
    Array.isArray(questions.severity.criteria) &&
    questions.severity.criteria.length === 4,
  Object.keys(questions).join(","),
);

reset();
await moderateTask(taskInput(), cfg());
const taskQuestions = requests[0]?.body?.questions ?? {};
check(
  "protocol: task asks a single normal/promo/phishing/fraud choice about the link",
  Object.keys(taskQuestions).join(",") === "link" &&
    taskQuestions.link?.type === "choice" &&
    Object.keys(taskQuestions.link?.criteria ?? {}).join(",") === "normal,promo,phishing,fraud",
  Object.keys(taskQuestions).join(","),
);

/* ------------------------ real model (optional) ------------------------- */

const real = (process.env.LAYA_ENDPOINT ?? "").replace(/\/+$/, "");

if (!real || real === ENDPOINT) {
  skip("real-model probes", "set LAYA_ENDPOINT=http://127.0.0.1:8000");
} else {
  let health = null;
  try {
    const res = await fetch(`${real}/health`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) health = await res.json();
  } catch {
    health = null;
  }

  if (!health) {
    skip("real-model probes", `${real}/health unreachable`);
  } else {
    check(
      "real laya /health reports a loaded model",
      health.status === "ok" || (Array.isArray(health.loaded) && health.loaded.length > 0),
      JSON.stringify(health).slice(0, 160),
    );

    const realCfg = { endpoint: real, timeoutMs: 4000, enabled: true };
    const probe = async (fn) => {
      const t0 = Date.now();
      const out = await fn();
      return { ...out, ms: Date.now() - t0 };
    };

    const clean = await probe(() => moderateCampaign(adInput(), realCfg));
    const scam = await probe(() =>
      moderateCampaign(
        adInput({
          headline: "Double your crypto in 24 hours",
          bodyText: "Send bitcoin to our wallet and get 2x back. Guaranteed.",
          ctaText: "Claim now",
          targetUrl: "https://crypto-doubler.xyz/claim",
        }),
        realCfg,
      ),
    );
    const benignTask = await probe(() => moderateTask(taskInput(), realCfg));
    const phishTask = await probe(() =>
      moderateTask(
        taskInput({ postUrl: "https://bankofamerica-secure-login.top/verify" }),
        realCfg,
      ),
    );

    for (const [label, p] of [
      ["clean ad", clean],
      ["crypto scam ad", scam],
      ["benign task", benignTask],
      ["phishing task", phishTask],
    ]) {
      console.log(`  real ${label.padEnd(16)} ${brief(p)}  ${p.ms}ms`);
    }

    check(
      "real model: clean ad copy is not rejected",
      clean.decision !== "auto_rejected" && clean.score >= 40,
      brief(clean),
    );
    check(
      "real model: crypto scam scores below clean copy and is auto-rejected",
      scam.score < clean.score && scam.decision === "auto_rejected",
      brief(scam),
    );
    check(
      "real model: benign task link never auto-approves",
      benignTask.decision !== "auto_approved",
      brief(benignTask),
    );
    check(
      "real model: phishing link is flagged (phishing/fraud reason or reject band)",
      phishTask.reasons.some((r) => r.includes("phishing") || r.includes("fraud")) ||
        phishTask.score < 40,
      brief(phishTask),
    );
    check(
      "real model: every inference fits the 4s API budget",
      [clean, scam, benignTask, phishTask].every((p) => p.ms < 4000),
      `max=${Math.max(clean.ms, scam.ms, benignTask.ms, phishTask.ms)}ms`,
    );
  }
}

server.close();
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
if (failed > 0) process.exitCode = 1;
