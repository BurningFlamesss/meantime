import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import argon2 from "argon2";
import { advertiserLoginSchema, advertiserRegisterSchema } from "@meantime/shared";
import { advertisers } from "@meantime/shared/db";
import type { AppContext } from "../context.js";
import { signAuthToken } from "../context.js";
import { rateLimit } from "../rate-limit.js";

const ADVERTISER_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * Advertiser auth is deliberately separate from user auth: the token kind is
 * checked by `requireAdvertiser`, so a user session can never act on a
 * campaign, and an advertiser token can never read a user's balance.
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

    const accessToken = signAuthToken(
      { sub: advertiser.id, kind: "advertiser" },
      ctx.env.JWT_SECRET,
      ADVERTISER_TTL_SECONDS,
    );
    return {
      advertiserId: advertiser.id,
      email: advertiser.email,
      companyName: advertiser.companyName,
      accessToken,
    };
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

    const accessToken = signAuthToken(
      { sub: advertiser.id, kind: "advertiser" },
      ctx.env.JWT_SECRET,
      ADVERTISER_TTL_SECONDS,
    );
    return {
      advertiserId: advertiser.id,
      email: advertiser.email,
      companyName: advertiser.companyName,
      accessToken,
    };
  });
}
