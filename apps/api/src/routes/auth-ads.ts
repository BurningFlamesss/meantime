import type { FastifyInstance } from "fastify";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import argon2 from "argon2";
import {
  LEASE,
  EXTENSION_CACHE,
  prefetchRequestSchema,
  registerUserSchema,
  loginSchema,
  signLeaseToken,
  type LeaseTokenPayload,
  type PrefetchedAd,
  type PrefetchResponse,
  type PacingState,
  WELCOME_BONUS_USD,
  sha256Hex,
} from "@meantime/shared";
import {
  adLeases,
  campaigns,
  campaignVariants,
  devices,
  referrals,
  userNetworkEvents,
  users,
} from "@meantime/shared/db";
import type { AppContext } from "../context.js";
import { randomToken, signAuthToken, requireUser } from "../context.js";
import { ACCOUNTS, postTransfer } from "../ledger.js";
import { pacingFor } from "../fraud/cadence.js";
import { clusterForIp, resolveGeo } from "../geo.js";
import { checkReferralAllowed } from "../referrals.js";
import { logFraud } from "../fraud/trust.js";
import { createHash } from "node:crypto";

function referralCodeFor(userId: string): string {
  return createHash("sha256").update(`referral:${userId}`).digest("hex").slice(0, 8);
}

/** Record a geo/network signal for fraud scoring. Raw IP is hashed, never stored. */
async function recordNetworkEvent(ctx: AppContext, userId: string, ip: string): Promise<void> {
  const geo = resolveGeo(ip);
  const today = new Date().toISOString().slice(0, 10);
  await ctx.db
    .insert(userNetworkEvents)
    .values({
      userId,
      ipHash: geo.ipHash,
      geoCluster: geo.cluster,
      asn: geo.asn,
      seenOn: today,
    })
    .onConflictDoNothing();
}

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/auth/register", async (req, reply) => {
    const body = registerUserSchema.parse(req.body);
    const existing = await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
    if (existing.length > 0) return reply.code(409).send({ error: "email_taken" });

    const passwordHash = await argon2.hash(body.password);
    const ip = req.ip;
    const [user] = await ctx.db
      .insert(users)
      .values({ email: body.email, passwordHash, displayName: body.displayName ?? null, signupIp: ip })
      .returning();
    if (!user) return reply.code(500).send({ error: "create_failed" });

    let deviceId: string | null = null;
    let fingerprintHash: string | null = null;
    if (body.deviceId && body.fingerprintHash) {
      fingerprintHash = await sha256Hex(body.fingerprintHash);
      const [device] = await ctx.db
        .insert(devices)
        .values({ userId: user.id, fingerprintHash, userAgent: req.headers["user-agent"] ?? null })
        .onConflictDoNothing()
        .returning();
      deviceId = device?.id ?? null;
    }

    // Referral attribution, with self-referral blocked by network/device checks.
    if (body.referralCode) {
      const match = await ctx.db
        .select({ id: users.id })
        .from(users)
        // Core `sha256(bytea)` (Postgres 11+) avoids depending on pgcrypto.
        .where(
          sql`encode(sha256(convert_to('referral:' || ${users.id}::text, 'UTF8')), 'hex') LIKE ${body.referralCode.toLowerCase() + "%"}`,
        )
        .limit(1);
      const referrer = match[0];
      if (referrer && referrer.id !== user.id) {
        const ipHash = resolveGeo(ip).ipHash;
        const check = await checkReferralAllowed(ctx.db, {
          referrerId: referrer.id,
          referredIpHash: ipHash,
          referredFingerprintHash: fingerprintHash,
        });
        if (check.eligible) {
          await ctx.db.insert(referrals).values({
            referrerId: referrer.id,
            referredUserId: user.id,
            referredIpHash: ipHash,
            referredFingerprintHash: fingerprintHash,
          });
        } else {
          await logFraud(ctx.db, {
            userId: user.id,
            severity: "warning",
            rule: "self_referral_blocked",
            detail: { referrerId: referrer.id, reason: check.reason },
          });
        }
      }
    }

    // Welcome bonus: promo liability -> pending balance, unlockable at threshold.
    await ctx.db.transaction(async (tx) => {
      await postTransfer(tx, {
        entryType: "welcome_bonus",
        from: ACCOUNTS.platformPromoLiability,
        to: ACCOUNTS.userPending(user.id),
        amountMicro: BigInt(WELCOME_BONUS_USD),
        referenceType: "user",
        referenceId: user.id,
        memo: "Welcome bonus (pending until $5 threshold)",
      });
      await tx.update(users).set({ welcomeBonusCredited: true }).where(eq(users.id, user.id));
    });

    const accessToken = signAuthToken({ sub: user.id, kind: "user", did: deviceId ?? undefined }, ctx.env.JWT_SECRET, 3600 * 24 * 30);
    await recordNetworkEvent(ctx, user.id, ip);
    return { userId: user.id, deviceId, accessToken, refreshToken: randomToken() };
  });

  app.post("/auth/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const [user] = await ctx.db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (!user || !(await argon2.verify(user.passwordHash, body.password))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    let deviceId: string | null = null;
    if (body.deviceId && body.fingerprintHash) {
      const fp = await sha256Hex(body.fingerprintHash);
      const [device] = await ctx.db
        .insert(devices)
        .values({ userId: user.id, fingerprintHash: fp, userAgent: req.headers["user-agent"] ?? null })
        .onConflictDoUpdate({
          target: [devices.userId, devices.fingerprintHash],
          set: { lastSeenAt: new Date() },
        })
        .returning();
      deviceId = device?.id ?? null;
    }
    const accessToken = signAuthToken({ sub: user.id, kind: "user", did: deviceId ?? undefined }, ctx.env.JWT_SECRET, 3600 * 24 * 30);
    await recordNetworkEvent(ctx, user.id, req.ip);
    return { userId: user.id, deviceId, accessToken, refreshToken: randomToken() };
  });
}

export async function adsRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/ads/prefetch", async (req, reply) => {
    const auth = requireUser(req, reply, ctx.env.JWT_SECRET);
    if (!auth?.userId) return;

    const body = prefetchRequestSchema.parse(req.body);
    const count = Math.min(body.count, EXTENSION_CACHE.PREFETCH_BATCH_SIZE);
    const nowSec = Math.floor(Date.now() / 1000);

    // Server-side pacing state (Layer 4) from the last hour of impressions.
    const hourAgo = new Date(Date.now() - 3600_000);
    const [promptRow] = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(adLeases)
      .where(and(eq(adLeases.userId, auth.userId), gt(adLeases.consumedAt, hourAgo)));
    const promptsLastHour = Number(promptRow?.count ?? 0);
    const pacing = pacingFor(promptsLastHour);

    const pacingState: PacingState = {
      tier: pacing.tier,
      remainingThisHour: pacing.remainingThisHour,
      promptDivisor: pacing.promptDivisor,
    };
    if (!pacing.allow) {
      const empty: PrefetchResponse = { ads: [], pacing: pacingState, serverTime: Date.now() };
      return empty;
    }

    // Eligible campaigns: active, budget remaining today, platform- and
    // geo-targeted. Geo is matched on the request IP's cluster; the raw IP
    // is never stored or returned.
    const today = new Date().toISOString().slice(0, 10);
    const userCluster = clusterForIp(req.ip);
    const rows = await ctx.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.status, "active"))
      .orderBy(desc(campaigns.cpiMicro))
      .limit(count * 3);

    const eligible = rows.filter((c) => {
      if (c.spendDate === today && c.spentTodayMicro >= c.dailyBudgetMicro) return false;
      if (body.platforms.length > 0) {
        const targets = c.targetPlatforms as string[];
        if (!targets.some((p) => body.platforms.includes(p))) return false;
      }
      const geoTargets = (c.targetGeoClusters as string[]) ?? [];
      if (geoTargets.length > 0 && !geoTargets.includes(userCluster)) return false;
      return true;
    });

    const [device] = auth.deviceId
      ? await ctx.db.select().from(devices).where(eq(devices.id, auth.deviceId)).limit(1)
      : [null];

    const ads: PrefetchedAd[] = [];
    for (const campaign of eligible.slice(0, count)) {
      // A/B rotation: pick the base copy or an approved variant at random.
      const approvedVariants = await ctx.db
        .select()
        .from(campaignVariants)
        .where(
          and(
            eq(campaignVariants.campaignId, campaign.id),
            eq(campaignVariants.moderationDecision, "auto_approved"),
          ),
        );
      const pick =
        approvedVariants.length > 0 && Math.random() < approvedVariants.length / (approvedVariants.length + 1)
          ? approvedVariants[Math.floor(Math.random() * approvedVariants.length)]
          : null;

      const copy = pick ?? campaign;
      const leaseId = crypto.randomUUID();
      const payload: LeaseTokenPayload = {
        v: 1,
        lid: leaseId,
        uid: auth.userId,
        did: device?.id ?? body.deviceId,
        aid: campaign.id,
        cid: campaign.id,
        iat: nowSec,
        exp: nowSec + LEASE.TTL_SECONDS,
      };
      const leaseToken = await signLeaseToken(payload, ctx.env.LEASE_HMAC_SECRET);
      await ctx.db.insert(adLeases).values({
        id: leaseId,
        userId: auth.userId,
        deviceId: device?.id ?? null,
        campaignId: campaign.id,
        expiresAt: new Date((nowSec + LEASE.TTL_SECONDS) * 1000),
      });
      ads.push({
        adId: campaign.id,
        campaignId: campaign.id,
        variantId: pick?.id ?? null,
        variantLabel: pick?.label ?? "A",
        leaseId,
        leaseToken,
        issuedAt: nowSec,
        expiresAt: nowSec + LEASE.TTL_SECONDS,
        cpiMicro: Number(campaign.cpiMicro),
        headline: copy.headline,
        bodyText: copy.bodyText,
        ctaText: copy.ctaText,
        targetUrl: campaign.targetUrl,
        targetPlatforms: (campaign.targetPlatforms as string[]) ?? [],
        frequencyCap: {
          maxPerDay: campaign.maxPerDayPerUser,
          cooldownSec: campaign.cooldownSec,
        },
      });
    }

    const response: PrefetchResponse = { ads, pacing: pacingState, serverTime: Date.now() };
    return response;
  });
}
