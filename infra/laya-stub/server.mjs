/**
 * Development stand-in for the Laya moderation sidecar.
 *
 * The real product expects a local, non-chat classifier at LAYA_ENDPOINT that
 * accepts {task,text?,url?,imageKey?} and returns {score,labels,confidence}.
 * This stub exists so `docker compose up -d` gives developers a working
 * moderation path without a proprietary model. It is DETERMINISTIC and is not
 * a substitute for production content safety.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8080);

const SPAM_TERMS = [
  "make money fast",
  "guaranteed income",
  "crypto doubling",
  "free robux",
  "loan shark",
  "get rich quick",
];

const SUSPICIOUS_TLDS = [".xyz", ".top", ".click", ".loan", ".win"];

function scoreText(text = "") {
  const lower = text.toLowerCase();
  const labels = [];
  let score = 92;

  for (const term of SPAM_TERMS) {
    if (lower.includes(term)) {
      score = Math.min(score, 22);
      labels.push("spam");
    }
  }
  if (/(.)\1{5,}/.test(lower)) {
    score = Math.min(score, 58);
    labels.push("character_repetition");
  }
  if (text.trim().length < 10) {
    score = Math.min(score, 62);
    labels.push("too_short");
  }

  return { score, labels: [...new Set(labels)], confidence: 0.99 };
}

function scoreUrl(url = "") {
  try {
    const host = new URL(url).hostname;
    if (SUSPICIOUS_TLDS.some((tld) => host.endsWith(tld))) {
      return { score: 48, labels: ["suspicious_tld"], confidence: 0.99 };
    }
    return { score: 92, labels: [], confidence: 0.99 };
  } catch {
    return { score: 18, labels: ["invalid_url"], confidence: 0.99 };
  }
}

function classify(body) {
  if (body.task === "proof_image") {
    const urlResult = scoreUrl(body.url ?? "");
    if (!body.imageKey) {
      return {
        score: Math.min(urlResult.score, 55),
        labels: [...urlResult.labels, "missing_image"],
        confidence: 0.99,
      };
    }
    return urlResult;
  }
  return scoreText(body.text ?? "");
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
    return send(res, 200, { ok: true, service: "laya-stub" });
  }
  if (req.method !== "POST" || req.url !== "/v1/classify") {
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
    if (body?.task !== "ad_copy" && body?.task !== "proof_image") {
      return send(res, 400, { error: "invalid_task" });
    }
    return send(res, 200, classify(body));
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`laya-stub listening on :${PORT}`);
});
