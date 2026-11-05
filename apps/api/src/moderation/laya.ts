import { LAYA, type ModerationOutcome, type ModerationDecision } from "@meantime/shared";

/**
 * Laya — an open-source, non-chat AI that runs in Docker. Unlike a chat model
 * it never generates free text back at us; it takes structured input and
 * returns structured judgments (labels + confidence). We run it as a local
 * sidecar container and call it over HTTP.
 *
 * Design contract:
 *  - Laya is the PRIMARY classifier for content quality/policy.
 *  - Deterministic checks run FIRST as a security boundary: anything that's
 *    clearly abusive (blocked terms, malformed URLs) is rejected without
 *    waiting on the model, and a Laya outage never auto-approves content —
 *    it falls back to "needs_review", never to "approved".
 */

export interface LayaConfig {
  /** Base URL of `laya-serve`, e.g. http://localhost:8000 */
  endpoint: string;
  /** Request timeout; a slow Laya must not stall the API. */
  timeoutMs: number;
  enabled: boolean;
}

/**
 * Build the moderation config from the validated environment. This must be
 * the only source of `LayaConfig` in the server: a module-scope
 * `process.env` read runs before `loadEnv()` loads `.env`, which silently
 * pinned every deployment to the localhost defaults. Test scripts build
 * their own `LayaConfig` and pass it explicitly.
 */
export function layaConfigFromEnv(env: {
  LAYA_ENDPOINT: string;
  LAYA_ENABLED: boolean;
}): LayaConfig {
  return {
    endpoint: env.LAYA_ENDPOINT,
    timeoutMs: 4_000,
    enabled: env.LAYA_ENABLED,
  };
}

/* ---------------------------- Laya HTTP client --------------------------- */
/*
 * Laya's server speaks TypeSafe Jev's `/v1/systemone` protocol: post a state
 * plus typed questions, receive calibrated answers. We ask one neutral category
 * question plus an ordinal severity, then fold the distribution into the 0-100
 * score the rest of the moderation pipeline uses.
 */

interface LayaQuestion {
  type: "choice" | "score" | "noul";
  instructions: string;
  criteria?: Record<string, string> | string[];
}

interface LayaAnswer {
  type: "choice" | "score" | "noul";
  choice?: string;
  score?: number;
  noul?: number;
  /** Per-criterion distribution for a `choice` answer. */
  probabilities?: Record<string, number>;
  confidence?: number;
  answer_confidence?: number;
}

interface LayaSystemOneResponse {
  model?: string;
  routing?: {
    /** Checkpoint the router chose: `english`, `multilingual`, ... */
    model?: string;
  };
  answers?: Record<string, LayaAnswer>;
}

export interface LayaJudgement {
  /** Category distribution from the `choice` answer, keyed by criterion. */
  probabilities: Record<string, number>;
  /** Expected severity level, normalised to 0..1. */
  severity: number;
  confidence: number;
  model: string;
  /**
   * Checkpoint Laya actually routed to, when the server reports it. Used to
   * keep verdicts from an unvalidated non-English checkpoint in human review.
   */
  checkpoint: string | null;
}

function probabilityOf(judgement: LayaJudgement, key: string): number {
  return asProbability(judgement.probabilities[key]);
}

/*
 * Both question sets ask for a category rather than a yes/no per offence.
 * That is not a stylistic choice: measured against the real English checkpoint,
 * a `noul` phrased "Is this advertisement spam?" answers ~1.0 for any ad at all
 * (it is, by definition, an advertisement), and "Is this a scam?" over-fires on
 * benign copy. A single `choice` over mutually exclusive categories is what the
 * checkpoint actually separates (clean copy -> legitimate_ad ~0.8, scam ->
 * fraud ~0.9), so the score is derived from that distribution.
 */

/**
 * Ad-copy questions.
 *
 * The prompt has to teach the checkpoint what this artefact actually is. A
 * bare "Is this an advertisement?" style question scores every ad as spam /
 * fraud (it is, by definition, an advertisement), which is why a neutral
 * category question with concrete examples is used. The context line in the
 * state is part of the prompt: it tells the classifier this is a short,
 * labelled sponsor line in a browser extension, not an unsolicited email or a
 * landing page, and that ordinary marketing language is allowed.
 */
const AD_CONTEXT =
  "Context: this is a short, clearly labelled sponsored text line (an 'Ad') " +
  "shown to a consenting user in a browser extension while they wait for an AI " +
  "assistant. It is not an email, a pop-up, or a full web page. It has one " +
  "headline, one short body line, a button label, and a destination URL that " +
  "belongs to the advertiser. Small software, developer-tool, course, and " +
  "product ads are normally legitimate. Confident, salesy, or superlative " +
  "marketing wording is not by itself deceptive. Judge the substance: is the " +
  "offer honest, or is it misleading or criminal?";

const AD_QUESTIONS: Record<string, LayaQuestion> = {
  shape: {
    type: "choice",
    instructions:
      "Read `context` and `post`. Choose the single best description of the advertisement. " +
      "Prefer legitimate_ad for an ordinary product ad with a plausible claim; use low_quality only for " +
      "harmless but genuinely poor marketing; use deceptive only when a reasonable reader would be misled; " +
      "use fraud only for a clear scam or illegal offer.",
    criteria: {
      legitimate_ad:
        "an honest advertisement for a real product or service; normal marketing language, superlatives, and a call to action are acceptable",
      low_quality:
        "low-effort, vague, or annoying marketing that makes no false promise and does not try to obtain money, credentials, or personal data",
      deceptive:
        "misleading or exaggerated claims that could fool a reasonable reader: fake discounts, guaranteed outcomes, hidden costs, fake urgency",
      fraud:
        "a scam or criminal offer: phishing, fake prizes or giveaways, investment or crypto returns, credential or payment theft, illegal products",
    },
  },
  severity: {
    type: "score",
    instructions:
      "How severe is any policy violation in `post`? A normal advertisement with no false claim is 0.",
    criteria: [
      "no violation: an ordinary advertisement",
      "minor: low-quality or mildly exaggerated wording, but still an honest offer",
      "clear violation: a misleading claim or high-pressure deceptive offer",
      "severe: fraud, scam, phishing, or an illegal product",
    ],
  },
};

/** Social-task links are text-classified; the screenshot itself is not sent. */
const TASK_QUESTIONS: Record<string, LayaQuestion> = {
  link: {
    type: "choice",
    instructions: "What is this link?",
    criteria: {
      normal: "a link to a normal post, profile, or product page",
      promo: "a promotional or affiliate link",
      phishing: "a link that impersonates a service to steal credentials",
      fraud: "a link to a fake prize, giveaway, or investment scheme",
    },
  },
};

function asProbability(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0;
}

async function layaJudge(
  cfg: LayaConfig,
  state: string | Record<string, string>,
  questions: Record<string, LayaQuestion>,
): Promise<LayaJudgement | null> {
  if (!cfg.enabled) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const base = cfg.endpoint.replace(/\/+$/, "");
    const res = await fetch(`${base}/v1/systemone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state, questions }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as LayaSystemOneResponse;
    const answers = body.answers;
    if (!answers || typeof answers !== "object") return null;

    // The primary answer is a `choice`; the severity score only corroborates it.
    const primary = answers.shape ?? answers.link ?? answers.scam;
    if (!primary?.probabilities) return null; // not a category answer — fail safe

    return {
      probabilities: primary.probabilities,
      severity: Math.min(1, asProbability((answers.severity?.score ?? 0) / 3)),
      confidence: asProbability(primary.answer_confidence ?? primary.confidence ?? 0.5),
      model: body.model ?? "unknown",
      checkpoint: body.routing?.model ?? null,
    };
  } catch {
    return null; // timeout / unreachable — caller falls back safely
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------- deterministic policy ------------------------- */
/* These run first and are authoritative for clear-cut abuse. */

const BLOCKED_TERMS = [
  "make money fast",
  "crypto doubling",
  "free robux",
  "loan shark",
];

const SUSPICIOUS_TLDS = [".xyz", ".top", ".click", ".loan", ".win"];

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

interface PolicyResult {
  /** true when content is clearly abusive — reject without consulting Laya. */
  hardReject: boolean;
  reasons: string[];
}

function policyScan(text: string, url: string): PolicyResult {
  const reasons: string[] = [];
  let hardReject = false;
  const lower = text.toLowerCase();

  for (const term of BLOCKED_TERMS) {
    if (lower.includes(term)) {
      hardReject = true;
      reasons.push(`blocked_term:${term}`);
    }
  }
  const host = safeHost(url);
  if (!host) {
    hardReject = true;
    reasons.push("invalid_url");
  } else if (SUSPICIOUS_TLDS.some((tld) => host.endsWith(tld))) {
    reasons.push("suspicious_tld"); // not a hard reject — Laya decides
  }
  if (/(.)\1{5,}/.test(lower)) reasons.push("character_repetition");
  return { hardReject, reasons };
}

/* ------------------------------- decisions ------------------------------- */

function decide(score: number, approveAt: number): ModerationDecision {
  if (score >= approveAt) return "auto_approved";
  if (score < LAYA.AUTO_REJECT) return "auto_rejected";
  return "needs_review";
}

/**
 * Only the English checkpoint is calibrated for these prompts. Measured on a
 * small labelled sample, the multilingual checkpoint scored most clean Spanish,
 * Chinese, Hindi and Arabic ads as `fraud` (several above p=0.99), so an
 * automatic decision from it would reject legitimate advertisers. Anything the
 * router sends elsewhere keeps a human in the loop; deterministic policy
 * checks still hard-reject before the model is consulted.
 */
function needsHumanForCheckpoint(judgement: LayaJudgement): boolean {
  return judgement.checkpoint !== null && judgement.checkpoint !== "english";
}

export interface LayaCampaignInput {
  headline: string;
  bodyText: string;
  ctaText: string;
  targetUrl: string;
  advertiserAgeDays: number;
  advertiserRejectedCount: number;
  advertiserApprovedCount: number;
}

export interface LayaTaskInput {
  postUrl: string;
  taskType: string;
  screenshotKey: string;
  accountAgeDays: number;
}

/**
 * Campaign moderation. Laya classifies the ad copy; reputation nudges the
 * score; clear-cut abuse is rejected before the model is ever consulted.
 */
export async function moderateCampaign(
  input: LayaCampaignInput,
  cfg: LayaConfig,
): Promise<ModerationOutcome> {
  const policy = policyScan(`${input.headline} ${input.bodyText} ${input.ctaText}`, input.targetUrl);
  if (policy.hardReject) {
    return { score: 0, decision: "auto_rejected", reasons: policy.reasons, layers: ["policy"] };
  }

  const layers = ["policy"];
  const reasons = [...policy.reasons];

  // Laya is the primary content judge. It reads text, so the destination URL
  // is part of the state rather than a separate field. The state is an object
  // with a `post` key because the preset questions refer to `post`.
  const laya = await layaJudge(
    cfg,
    {
      context: AD_CONTEXT,
      post: [
        `Headline: ${input.headline}`,
        `Body: ${input.bodyText}`,
        `Button: ${input.ctaText}`,
        `Destination: ${input.targetUrl}`,
      ].join("\n"),
    },
    AD_QUESTIONS,
  );

  if (laya === null) {
    // Laya unavailable: never auto-approve on an outage — route to a human.
    layers.push("laya_unavailable");
    return {
      score: 50,
      decision: "needs_review",
      reasons: [...reasons, "laya_unavailable"],
      layers,
    };
  }

  layers.push("laya");

  // Fraud dominates; a deceptive-but-not-fraudulent ad costs less, and
  // low-quality-but-honest copy barely moves the score. Low quality is not
  // fraud and must never by itself trigger a rejection.
  const fraud = probabilityOf(laya, "fraud");
  const deceptive = probabilityOf(laya, "deceptive");
  const lowQuality = probabilityOf(laya, "low_quality");
  const legitimate = probabilityOf(laya, "legitimate_ad");
  if (fraud >= 0.5) reasons.push("laya:fraud");
  else if (deceptive >= 0.5) reasons.push("laya:deceptive");
  else if (lowQuality >= 0.5) reasons.push("laya:low_quality");
  if (laya.severity >= 0.83 && legitimate < 0.5) reasons.push("laya:severe");

  const risk = Math.min(1, fraud * 0.95 + deceptive * 0.55 + lowQuality * 0.15);
  let score = Math.round((1 - risk) * 100);

  // Reputation adjusts at the margins only — it cannot rescue bad content.
  if (input.advertiserRejectedCount > 0) {
    score -= Math.min(20, input.advertiserRejectedCount * 8);
    reasons.push("prior_rejections");
  }
  if (input.advertiserAgeDays < 1) {
    score -= 5;
    reasons.push("new_advertiser");
  }
  if (input.advertiserApprovedCount >= 10 && score >= LAYA.AUTO_APPROVE - 5) {
    score = Math.min(100, score + 3);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // If the checkpoint itself says this is mostly a legitimate ad, it must not
  // auto-reject on a residual fraud/deceptive tail. The floor lands in the
  // human review band, preserving fail-closed moderation without calling an
  // honest advertiser a fraudster. Applied after reputation so a new
  // advertiser's age penalty cannot push a legitimate verdict into reject.
  if (legitimate >= 0.5) score = Math.max(score, 60);

  // A non-English verdict is advisory only: unvalidated calibration means a
  // model score must not approve or reject an advertiser on its own.
  if (needsHumanForCheckpoint(laya)) {
    reasons.push("non_english_review");
    return { score, decision: "needs_review", reasons, layers };
  }

  return { score, decision: decide(score, LAYA.AUTO_APPROVE), reasons, layers };
}

/**
 * Task-proof moderation. Laya is a text model, so it judges the claimed post
 * URL for phishing/scam signals. It cannot inspect the screenshot, which means
 * a clean URL still needs a human to verify the image: this path never
 * auto-approves.
 */
export async function moderateTask(
  input: LayaTaskInput,
  cfg: LayaConfig,
): Promise<ModerationOutcome> {
  const reasons: string[] = [];
  const layers = ["policy"];

  if (!/^https?:\/\//.test(input.postUrl)) {
    return {
      score: 0,
      decision: "auto_rejected",
      reasons: ["invalid_post_url"],
      layers,
    };
  }

  const laya = await layaJudge(
    cfg,
    { post: [`Post URL: ${input.postUrl}`, `Task type: ${input.taskType}`].join("\n") },
    TASK_QUESTIONS,
  );

  if (laya === null) {
    layers.push("laya_unavailable");
    return {
      score: 50,
      decision: "needs_review",
      reasons: ["laya_unavailable"],
      layers,
    };
  }

  layers.push("laya");

  // A task link is judged on phishing/fraud only. Promo links are common in
  // legitimate posts, and the ordinal severity head rates ordinary social URLs
  // as "minor", so neither is a risk input here.
  const phishing = probabilityOf(laya, "phishing");
  const fraud = probabilityOf(laya, "fraud");
  if (phishing >= 0.25) reasons.push("laya:phishing");
  if (fraud >= 0.25) reasons.push("laya:fraud");

  const risk = Math.min(1, (phishing + fraud) * 1.15);
  let score = Math.round((1 - risk) * 100);
  if (input.accountAgeDays < 1) {
    score -= 10;
    reasons.push("new_account");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // A non-English verdict is advisory: keep it in human review even when it
  // looks like a clear phishing link, because that checkpoint is not validated.
  if (needsHumanForCheckpoint(laya)) {
    reasons.push("non_english_review");
    reasons.push("screenshot_unverified");
    return { score, decision: "needs_review", reasons, layers };
  }

  // A clearly fraudulent link is rejected without human review.
  if (score < LAYA.AUTO_REJECT) {
    return { score, decision: "auto_rejected", reasons, layers };
  }

  // The screenshot is unverified by a text model, so fail closed even when the
  // link looks clean. The task stays in the human review queue.
  reasons.push("screenshot_unverified");
  return { score, decision: "needs_review", reasons, layers };
}
