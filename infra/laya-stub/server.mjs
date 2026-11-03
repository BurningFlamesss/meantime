/**
 * Offline test double for Laya.
 *
 * The production service is the open-source Laya `laya-serve` container
 * (https://github.com/NandhaKishorM/laya), which exposes TypeSafe Jev's
 * `POST /v1/systemone` protocol. This stub implements the same request and
 * response shape deterministically, so the API's moderation client can be
 * exercised without downloading a ~400M-parameter checkpoint.
 *
 * It is a rules engine, NOT a moderation model. Never deploy it as the real
 * classifier; the API treats a stub result exactly like a Laya result.
 *
 *   POST /v1/systemone  {state, questions} -> {model, answers, usage}
 *   GET  /health
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8080);

const SCAM_TERMS = [
  "make money fast",
  "crypto doubling",
  "double your crypto",
  "free robux",
  "guaranteed income",
  "get rich quick",
  "loan shark",
  "seed phrase",
  "wire transfer",
  "send bitcoin",
];

const SPAM_TERMS = ["buy now", "limited time", "act now", "click here", "free money"];

const MISLEADING_TERMS = ["guaranteed", "100%", "risk-free", "no risk", "instant approval"];

const PHISHING_TERMS = [
  "verify now",
  "confirm your password",
  "card number",
  "account will be suspended",
  "seed phrase",
  "private key",
  "connect wallet",
  "claim your prize",
  "you have been selected",
];

const SUSPICIOUS_TLDS = [".xyz", ".top", ".click", ".loan", ".win"];

function stateText(state) {
  if (typeof state === "string") return state;
  try {
    return JSON.stringify(state);
  } catch {
    return "";
  }
}

function analyse(state) {
  const text = stateText(state);
  const lower = text.toLowerCase();

  const scamHit = SCAM_TERMS.some((term) => lower.includes(term));
  const spamHit = SPAM_TERMS.some((term) => lower.includes(term));
  const misleadingHit = MISLEADING_TERMS.some((term) => lower.includes(term));

  let suspiciousTld = false;
  const match = lower.match(/https?:\/\/[^\s"']+/);
  if (match) {
    try {
      const host = new URL(match[0]).hostname;
      suspiciousTld = SUSPICIOUS_TLDS.some((tld) => host.endsWith(tld));
    } catch {
      suspiciousTld = false;
    }
  }

  const repetition = /(.)\1{5,}/.test(lower);
  const phishingHit = PHISHING_TERMS.some((term) => lower.includes(term));

  const scam = scamHit ? 0.94 : suspiciousTld ? 0.72 : 0.03;
  const spam = spamHit || repetition ? 0.82 : 0.05;
  const misleading = misleadingHit ? 0.78 : 0.05;
  const phishing = phishingHit || (suspiciousTld && /login|verify|password|card|account/.test(lower)) ? 0.88 : 0.04;

  let severity = 0;
  if (scamHit || suspiciousTld) severity = 3;
  else if (misleadingHit || phishingHit) severity = 2;
  else if (spamHit || repetition) severity = 1;

  const clean = !scamHit && !spamHit && !misleadingHit && !repetition && !phishingHit && !suspiciousTld;
  return { scam, spam, misleading, phishing, severity, clean };
}

/** Category probabilities for a `choice` question, by criterion name. */
function choiceProbabilities(criteria, scores) {
  const keys = Array.isArray(criteria) ? criteria : Object.keys(criteria ?? {});
  const raw = {
    legitimate_ad: scores.clean ? 0.92 : 0.04,
    low_quality: scores.spam,
    deceptive: scores.misleading,
    fraud: scores.scam,
    legitimate: scores.clean ? 0.92 : 0.04,
    normal: scores.clean ? 0.92 : 0.04,
    spam: scores.spam,
    promo: scores.spam,
    phishing: scores.phishing,
  };
  const scored = keys.map((key) => [key, typeof raw[key] === "number" ? raw[key] : 0.02]);
  const total = scored.reduce((sum, [, value]) => sum + value, 0) || 1;
  const top = scored.reduce((best, entry) => (entry[1] > best[1] ? entry : best), scored[0] ?? ["other", 0]);

  // A decision engine commits to its best category; the rest is the remainder.
  const probabilities = {};
  for (const [key, value] of scored) {
    probabilities[key] = key === top[0] ? 0.82 : 0.18 * (value / total);
  }
  return probabilities;
}

function answerFor(id, question, scores) {
  const type = question?.type;
  const key = String(id).toLowerCase();

  if (type === "noul") {
    const noul = key.includes("scam") || key.includes("fraud") || key.includes("phishing")
      ? scores.scam
      : key.includes("spam")
        ? scores.spam
        : key.includes("mislead") || key.includes("deceptive")
          ? scores.misleading
          : 0.05;
    return { type: "noul", noul, confidence: 0.95 };
  }

  if (type === "score") {
    return {
      type: "score",
      score: scores.severity,
      confidence: 0.95,
      probabilities: [0.8, 0.1, 0.06, 0.04],
      legend: Array.isArray(question.criteria) ? question.criteria : [],
    };
  }

  if (type === "choice") {
    const probabilities = choiceProbabilities(question.criteria, scores);
    const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other";
    const confidence = probabilities[choice] ?? 0.5;
    return { type: "choice", choice, confidence, answer_confidence: confidence, probabilities };
  }

  return { type: "noul", noul: 0.05, confidence: 0.5 };
}

function send(res, status, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, { ok: true, service: "laya-stub", model: "stub" });
  }
  if (req.method !== "POST" || req.url !== "/v1/systemone") {
    return send(res, 404, { error: "not_found" });
  }

  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > 1_000_000) req.destroy();
  });
  req.on("end", () => {
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: "invalid_json" });
    }
    if (!body || typeof body !== "object" || typeof body.questions !== "object" || body.questions === null) {
      return send(res, 400, { error: "questions_required" });
    }

    const scores = analyse(body.state);
    const answers = {};
    for (const [id, question] of Object.entries(body.questions)) {
      answers[id] = answerFor(id, question, scores);
    }

    return send(res, 200, {
      model: "stub",
      answers,
      usage: { input_tokens: stateText(body.state).length, output_tokens: 0 },
    });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`laya-stub listening on :${PORT}`);
});
