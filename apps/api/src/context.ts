import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createDb, type Db } from "@meantime/shared/db";
import { Redis } from "ioredis";
import type { Env } from "./env.js";

export interface AppContext {
  env: Env;
  db: Db;
  redis: Redis;
}

export function buildContext(env: Env): AppContext {
  const db = createDb(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true });
  // Redis is optional: callers fall back to the DB. Swallow connection errors
  // so a dev run without Redis does not flood the logs with unhandled events.
  redis.on("error", () => {});
  return { env, db, redis };
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    auth?: AuthClaims;
  }
}

export interface AuthClaims {
  userId?: string;
  advertiserId?: string;
  deviceId?: string;
}

export function registerContext(app: FastifyInstance, ctx: AppContext): void {
  app.decorate("ctx", ctx);
}

/** Minimal HMAC-based bearer token: base64url(JSON).sig — same approach as lease tokens. */
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

interface TokenBody {
  sub: string;
  kind: "user" | "advertiser";
  did?: string;
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signAuthToken(body: Omit<TokenBody, "exp">, secret: string, ttlSec: number): string {
  const full: TokenBody = { ...body, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const payload = b64url(Buffer.from(JSON.stringify(full)));
  const sig = b64url(createHmac("sha256", secret).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyAuthToken(token: string, secret: string): TokenBody | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(createHmac("sha256", secret).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString()) as TokenBody;
    if (body.exp < Date.now() / 1000) return null;
    return body;
  } catch {
    return null;
  }
}

export function requireUser(
  req: FastifyRequest,
  reply: FastifyReply,
  secret: string,
): AuthClaims | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    void reply.code(401).send({ error: "missing_token" });
    return null;
  }
  const body = verifyAuthToken(header.slice(7), secret);
  if (!body || body.kind !== "user") {
    void reply.code(401).send({ error: "invalid_token" });
    return null;
  }
  return { userId: body.sub, deviceId: body.did };
}

export function requireAdvertiser(
  req: FastifyRequest,
  reply: FastifyReply,
  secret: string,
): AuthClaims | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    void reply.code(401).send({ error: "missing_token" });
    return null;
  }
  const body = verifyAuthToken(header.slice(7), secret);
  if (!body || body.kind !== "advertiser") {
    void reply.code(401).send({ error: "invalid_token" });
    return null;
  }
  return { advertiserId: body.sub };
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}
