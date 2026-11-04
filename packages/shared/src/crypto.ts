import type { LeaseTokenPayload } from "./types.js";

/**
 * HMAC-SHA256 lease tokens. Implemented on WebCrypto so the same code runs in
 * the extension service worker, the browser, and Node (node:crypto provides
 * `globalThis.crypto.subtle` since Node 20 — no polyfill needed).
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

/** Canonical serialization — field order is part of the signature. */
function canonicalPayload(p: LeaseTokenPayload): string {
  return JSON.stringify({
    v: p.v,
    lid: p.lid,
    uid: p.uid,
    did: p.did,
    aid: p.aid,
    cid: p.cid,
    iat: p.iat,
    exp: p.exp,
    ...(p.dur !== undefined ? { dur: p.dur } : {}),
  });
}

export async function signLeaseToken(
  payload: LeaseTokenPayload,
  secret: string,
): Promise<string> {
  const body = b64urlEncode(encoder.encode(canonicalPayload(payload)));
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

export interface LeaseVerification {
  ok: boolean;
  payload?: LeaseTokenPayload;
  reason?: "malformed" | "bad_signature" | "expired";
}

export async function verifyLeaseToken(
  token: string,
  secret: string,
  nowSec: number,
  clockSkewSec = 0,
): Promise<LeaseVerification> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "malformed" };
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const key = await importKey(secret);
  const expected = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  let provided: Uint8Array;
  try {
    provided = b64urlDecode(sig);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!timingSafeEqual(new Uint8Array(expected), provided)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: LeaseTokenPayload;
  try {
    payload = JSON.parse(decoder.decode(b64urlDecode(body))) as LeaseTokenPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (payload.v !== 1 || !payload.lid || !payload.uid || !payload.cid) {
    return { ok: false, reason: "malformed" };
  }
  if (nowSec - clockSkewSec > payload.exp) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** Stable SHA-256 hex digest — used for fingerprint hashing and token hashes. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
