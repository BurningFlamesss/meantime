#!/usr/bin/env node
/**
 * Labelled moderation benchmark.
 *
 * Runs a reviewable set of hand-labelled ads and task links through the
 * public moderation entry points in `apps/api/dist`, against a running
 * `laya-serve`, and scores the decisions the product would actually make.
 *
 * Two questions, because they fail differently:
 *  - Does any `clean`/`normal` item get auto-rejected? (must be zero)
 *  - Does every `fraud`/`phishing` item get rejected or surfaced with a
 *    fraud/phishing reason for a reviewer? (recall gate)
 *
 * This is a small, hand-written set, not a public benchmark. It is sized to
 * catch calibration regressions in the prompt/score mapping, and it is the
 * evidence behind the decision to keep non-English verdicts in human review.
 *
 * Usage:
 *   pnpm build && LAYA_ENDPOINT=http://127.0.0.1:8000 pnpm laya:bench
 */
import { readFileSync, existsSync } from "node:fs";

const DIST = new URL("../apps/api/dist/moderation/laya.js", import.meta.url);
if (!existsSync(DIST)) {
  console.error("apps/api/dist/moderation/laya.js is missing — run `pnpm build` first.");
  process.exit(2);
}

const { moderateCampaign, moderateTask } = await import(DIST.href);

const casesFile = new URL("./laya-bench-cases.json", import.meta.url);
const { cases } = JSON.parse(readFileSync(casesFile, "utf8"));

const endpoint = (process.env.LAYA_ENDPOINT ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
const minRecall = Number(process.env.LAYA_BENCH_MIN_RECALL ?? "0.8");
const cfg = { endpoint, timeoutMs: 4_000, enabled: true };

let health;
try {
  const res = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(3_000) });
  health = res.ok ? await res.json() : null;
} catch {
  health = null;
}
if (!health) {
  console.error(`No classifier at ${endpoint}/health — start laya-serve first.`);
  process.exit(2);
}

const loaded = Array.isArray(health.loaded) ? health.loaded : [];
console.log(`Laya at ${endpoint} · loaded: ${loaded.join(", ") || "(none)"}`);
console.log(`${cases.length} labelled cases · min unsafe recall ${minRecall}\n`);

const adInput = (c) => ({
  headline: c.headline,
  bodyText: c.bodyText,
  ctaText: c.ctaText,
  targetUrl: c.targetUrl,
  advertiserAgeDays: 30,
  advertiserRejectedCount: 0,
  advertiserApprovedCount: 0,
});

const taskInput = (c) => ({
  postUrl: c.postUrl,
  taskType: c.taskType,
  screenshotKey: "task-proofs/bench/shot.png",
  accountAgeDays: 30,
});

const unsafeReasons = new Set(["laya:fraud", "laya:phishing"]);

const rows = [];
for (const c of cases) {
  const t0 = Date.now();
  const outcome =
    c.kind === "ad"
      ? await moderateCampaign(adInput(c), cfg)
      : await moderateTask(taskInput(c), cfg);
  const ms = Date.now() - t0;
  rows.push({
    ...c,
    ms,
    decision: outcome.decision,
    score: outcome.score,
    reasons: outcome.reasons,
    layers: outcome.layers,
    flagged: outcome.reasons.some((r) => unsafeReasons.has(r)),
    rejected: outcome.decision === "auto_rejected",
  });
}

const width = Math.max(...rows.map((r) => r.id.length));
const isClean = (r) => r.label === "clean" || r.label === "normal";
for (const r of rows) {
  const verdict = isClean(r)
    ? r.rejected
      ? "REJECT"
      : "ok"
    : r.rejected
      ? "reject"
      : r.flagged
        ? "flag"
        : "MISS";
  console.log(
    `${r.id.padEnd(width)}  ${r.lang}  ${r.label.padEnd(8)} ${String(r.decision).padEnd(13)} score=${String(r.score).padStart(3)} ${verdict.padEnd(6)} ${r.ms}ms  ${r.reasons.join(",") || "-"}`,
  );
}

const clean = rows.filter(isClean);
const unsafe = rows.filter((r) => !isClean(r));

const falseRejects = clean.filter((r) => r.rejected);
const surfaced = unsafe.filter((r) => r.rejected || r.flagged);
const hardRejects = unsafe.filter((r) => r.rejected);
const recall = unsafe.length === 0 ? 1 : surfaced.length / unsafe.length;
const maxMs = Math.max(...rows.map((r) => r.ms));

console.log("\n--- results ---");
console.log(
  `clean items: ${clean.length}, false auto-rejects: ${falseRejects.length}` +
    (falseRejects.length ? ` (${falseRejects.map((r) => r.id).join(", ")})` : ""),
);
console.log(
  `unsafe items: ${unsafe.length}, rejected or flagged: ${surfaced.length} ` +
    `(${Math.round(recall * 100)}%), hard auto-rejects: ${hardRejects.length}`,
);
if (surfaced.length < unsafe.length) {
  const missed = unsafe.filter((r) => !r.rejected && !r.flagged);
  console.log(`missed: ${missed.map((r) => `${r.id} (score ${r.score})`).join(", ")}`);
}

const byLang = new Map();
for (const r of rows) {
  const entry = byLang.get(r.lang) ?? { clean: 0, cleanFalse: 0, unsafe: 0, surfaced: 0 };
  if (r.label === "clean" || r.label === "normal") {
    entry.clean += 1;
    if (r.rejected) entry.cleanFalse += 1;
  } else {
    entry.unsafe += 1;
    if (r.rejected || r.flagged) entry.surfaced += 1;
  }
  byLang.set(r.lang, entry);
}
console.log("per language:");
for (const [lang, e] of [...byLang].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(
    `  ${lang.padEnd(3)} clean ${e.clean - e.cleanFalse}/${e.clean} not rejected · ` +
      `unsafe ${e.surfaced}/${e.unsafe} surfaced`,
  );
}
console.log(`max inference ${maxMs}ms (budget 4000ms)`);

const problems = [];
if (falseRejects.length > 0) problems.push(`${falseRejects.length} clean auto-reject(s)`);
if (recall < minRecall) problems.push(`unsafe recall ${Math.round(recall * 100)}% < ${minRecall * 100}%`);
if (maxMs >= 4_000) problems.push(`inference ${maxMs}ms exceeds the 4s budget`);

if (problems.length > 0) {
  console.log(`\nFAIL: ${problems.join("; ")}`);
  process.exitCode = 1;
} else {
  console.log("\nOK: no clean auto-rejects, unsafe recall met, latency within budget.");
}
