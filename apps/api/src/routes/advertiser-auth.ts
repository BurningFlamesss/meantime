import type { FastifyInstance } from "fastify";
import { and, eq, gt, sql } from "drizzle-orm";
import argon2 from "argon2";
import { createHash } from "node:crypto";
import {
  advertiserLoginSchema,
  advertiserRegisterSchema,
  refreshTokenSchema,
} from "@meantime/shared";
import { advertisers, advertiserSessions } from "@meantime/shared/db";
import type { AppContext } from "../context.js";
import { randomToken, signAuthToken } from "../context.js";
import { rateLimit } from "../rate-limit.js";

const ACCESS_TTL_SECONDS = 60 * 60; // 1 hour; rotated by /advertiser/refresh
const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000;

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface AdvertiserSessionResult {
  advertiserId: string;
  email: string;
  companyName: string;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: number;
}

function issueAccessToken(ctx: AppContext, advertiserId: string): string {
  return signAuthToken(
    { sub: advertiserId, kind: "advertiser" },
    ctx.env.JWT_SECRET,
    ACCESS_TTL_SECONDS,
  );
}

async function issueSession(
  ctx: AppContext,
  advertiser: { id: string; email: string; companyName: string },
): Promise<AdvertiserSessionResult> {
  const refreshToken = randomToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await ctx.db.insert(advertiserSessions).values({
    advertiserId: advertiser.id,
    refreshTokenHash: hashRefreshToken(refreshToken),
    expiresAt,
  });
  return {
    advertiserId: advertiser.id,
    email: advertiser.email,
    companyName: advertiser.companyName,
    accessToken: issueAccessToken(ctx, advertiser.id),
    refreshToken,
    refreshExpiresAt: expiresAt.getTime(),
  };
}

/**
 * Advertiser auth is deliberately separate from user auth: the token kind is
 * checked by `requireAdvertiser`, so a user session can never act on a
 * campaign, and an advertiser token can never read a user's balance. Access
 * tokens are short-lived and backed by a rotating refresh session, so a lost
 * portal session can be revoked instead of staying valid for days.
 */
export async function advertiserAuthRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/advertiser/register", async (req, reply) => {
    if (!rateLimit(req, reply, "advertiser_register", 8, 600_000)) return;
    const body = advertiserRegisterSchema.parse(req.body);

    const existing = await ctx.db
      .select({ id: advertisers.id })
      .from(advertisers)
      .where(eq(advertisers.email, body.email))
      .limit(1);
    if (existing.length > 0) return reply.code(409).send({ error: "email_taken" });

    const passwordHash = await argon2.hash(body.password);
    const [advertiser] = await ctx.db
      .insert(advertisers)
      .values({
        email: body.email,
        passwordHash,
        companyName: body.companyName,
        website: body.website ?? null,
      })
      .returning();
    if (!advertiser) return reply.code(500).send({ error: "create_failed" });

    return issueSession(ctx, advertiser);
  });

  app.post("/advertiser/login", async (req, reply) => {
    if (!rateLimit(req, reply, "advertiser_login", 10, 600_000)) return;
    const body = advertiserLoginSchema.parse(req.body);

    const [advertiser] = await ctx.db
      .select()
      .from(advertisers)
      .where(eq(advertisers.email, body.email))
      .limit(1);
    if (!advertiser || !(await argon2.verify(advertiser.passwordHash, body.password))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    return issueSession(ctx, advertiser);
  });

  /**
   * Rotate the advertiser refresh token. The presented session is revoked in
   * the same transaction, so a replayed token fails closed rather than
   * silently extending a stolen session.
   */
  app.post("/advertiser/refresh", async (req, reply) => {
    if (!rateLimit(req, reply, "advertiser_refresh", 60, 60_000)) return;
    const body = refreshTokenSchema.parse(req.body);
    const hash = hashRefreshToken(body.refreshToken);

    const [session] = await ctx.db
      .select()
      .from(advertiserSessions)
      .where(
        and(
          eq(advertiserSessions.refreshTokenHash, hash),
          sql`${advertiserSessions.revokedAt} IS NULL`,
          gt(advertiserSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!session) return reply.code(401).send({ error: "invalid_refresh_token" });

    const [advertiser] = await ctx.db
      .select()
      .from(advertisers)
      .where(eq(advertisers.id, session.advertiserId))
      .limit(1);
    if (!advertiser) return reply.code(401).send({ error: "invalid_refresh_token" });

    const rotated = await ctx.db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(advertiserSessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(advertiserSessions.id, session.id),
            sql`${advertiserSessions.revokedAt} IS NULL`,
          ),
        )
        .returning({ id: advertiserSessions.id });
      if (!revoked) return null; // another request rotated it first

      const refreshToken = randomToken();
      const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
      await tx.insert(advertiserSessions).values({
        advertiserId: advertiser.id,
        refreshTokenHash: hashRefreshToken(refreshToken),
        expiresAt,
      });
      return { refreshToken, expiresAt };
    });
    if (!rotated) return reply.code(401).send({ error: "invalid_refresh_token" });

    return {
      advertiserId: advertiser.id,
      email: advertiser.email,
      companyName: advertiser.companyName,
      accessToken: issueAccessToken(ctx, advertiser.id),
      refreshToken: rotated.refreshToken,
      refreshExpiresAt: rotated.expiresAt.getTime(),
    };
  });

  app.post("/advertiser/logout", async (req, reply) => {
    if (!rateLimit(req, reply, "advertiser_logout", 60, 60_000)) return;
    const body = refreshTokenSchema.parse(req.body);
    await ctx.db
      .update(advertiserSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(advertiserSessions.refreshTokenHash, hashRefreshToken(body.refreshToken)),
          sql`${advertiserSessions.revokedAt} IS NULL`,
        ),
      );
    return { ok: true };
  });
}
