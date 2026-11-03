import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import {
  campaigns,
  campaignVariants,
  payoutDestinations,
  payoutRequests,
  socialTasks,
  users,
} from "@meantime/shared/db";
import type { AppContext } from "../context.js";
import { ACCOUNTS, balanceOf, postTransfer } from "../ledger.js";
import { logFraud } from "../fraud/trust.js";
import { rateLimit } from "../rate-limit.js";

const reviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  notes: z.string().max(500).optional(),
});

function adminAuthorized(req: FastifyRequest, ctx: AppContext): "ok" | "disabled" | "denied" {
  const configured = ctx.env.ADMIN_API_KEY;
  if (!configured) return "disabled"; // fail closed when no reviewer key is configured
  const header = req.headers["x-admin-key"];
  if (typeof header !== "string") return "denied";
  const a = Buffer.from(header);
  const b = Buffer.from(configured);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "denied";
  return "ok";
}

/**
 * Reviewer surface. Deliberately separate from user/advertiser auth: it is
 * gated by an operator key, and every decision is written to fraud_logs with
 * the reviewer note so manual actions are auditable.
 */
export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const guard = (req: FastifyRequest, reply: import("fastify").FastifyReply): boolean => {
    if (!rateLimit(req, reply, "admin", 120, 60_000)) return false;
    const auth = adminAuthorized(req, ctx);
    if (auth === "disabled") {
      void reply.code(503).send({ error: "admin_disabled", hint: "Set ADMIN_API_KEY on the API." });
      return false;
    }
    if (auth === "denied") {
      void reply.code(401).send({ error: "invalid_admin_key" });
      return false;
    }
    return true;
  };

  app.get("/admin/queue", async (req, reply) => {
    if (!guard(req, reply)) return;

    const [campaignRows, variantRows, taskRows, payoutRows] = await Promise.all([
      ctx.db
        .select({
          id: campaigns.id,
          name: campaigns.name,
          headline: campaigns.headline,
          bodyText: campaigns.bodyText,
          ctaText: campaigns.ctaText,
          targetUrl: campaigns.targetUrl,
          status: campaigns.status,
          moderationDecision: campaigns.moderationDecision,
          moderationScore: campaigns.moderationScore,
          moderationReasons: campaigns.moderationReasons,
          createdAt: campaigns.createdAt,
        })
        .from(campaigns)
        .where(or(eq(campaigns.status, "draft"), eq(campaigns.moderationDecision, "needs_review")))
        .limit(50),
      ctx.db
        .select({
          id: campaignVariants.id,
          campaignId: campaignVariants.campaignId,
          label: campaignVariants.label,
          headline: campaignVariants.headline,
          bodyText: campaignVariants.bodyText,
          moderationScore: campaignVariants.moderationScore,
          moderationReasons: campaignVariants.moderationReasons,
        })
        .from(campaignVariants)
        .where(eq(campaignVariants.moderationDecision, "needs_review"))
        .limit(50),
      ctx.db
        .select({
          id: socialTasks.id,
          userId: socialTasks.userId,
          email: users.email,
          taskType: socialTasks.taskType,
          postUrl: socialTasks.postUrl,
          screenshotKey: socialTasks.screenshotKey,
          rewardMicro: socialTasks.rewardMicro,
          moderationScore: socialTasks.moderationScore,
          moderationReasons: socialTasks.moderationReasons,
          createdAt: socialTasks.createdAt,
        })
        .from(socialTasks)
        .leftJoin(users, eq(socialTasks.userId, users.id))
        .where(eq(socialTasks.status, "pending"))
        .limit(50),
      ctx.db
        .select({
          id: payoutRequests.id,
          userId: payoutRequests.userId,
          email: users.email,
          amountMicro: payoutRequests.amountMicro,
          status: payoutRequests.status,
          trustScoreAtRequest: payoutRequests.trustScoreAtRequest,
          requestedAt: payoutRequests.requestedAt,
          address: payoutDestinations.addressDisplay,
        })
        .from(payoutRequests)
        .leftJoin(users, eq(payoutRequests.userId, users.id))
        .leftJoin(payoutDestinations, eq(payoutRequests.destinationId, payoutDestinations.id))
        .where(inArray(payoutRequests.status, ["auditing", "frozen"]))
        .limit(50),
    ]);

    return {
      campaigns: campaignRows,
      variants: variantRows,
      tasks: taskRows,
      payouts: payoutRows,
    };
  });

  app.post("/admin/campaigns/:id/review", async (req, reply) => {
    if (!guard(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = reviewSchema.parse(req.body);

    const [existing] = await ctx.db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
    if (!existing) return reply.code(404).send({ error: "not_found" });

    const approve = body.decision === "approve";
    const note = body.notes?.trim();
    const [updated] = await ctx.db
      .update(campaigns)
      .set({
        status: approve ? "active" : "rejected",
        moderationDecision: approve ? "auto_approved" : "auto_rejected",
        moderationReasons: [
          ...existing.moderationReasons,
          `reviewer:${approve ? "approved" : "rejected"}${note ? `:${note}` : ""}`,
        ],
        moderatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, id))
      .returning();

    await logFraud(ctx.db, {
      severity: "info",
      rule: approve ? "admin_campaign_approved" : "admin_campaign_rejected",
      detail: { campaignId: id, notes: note ?? null },
    });
    return updated;
  });

  app.post("/admin/variants/:id/review", async (req, reply) => {
    if (!guard(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = reviewSchema.parse(req.body);

    const [existing] = await ctx.db
      .select()
      .from(campaignVariants)
      .where(eq(campaignVariants.id, id))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: "not_found" });

    const approve = body.decision === "approve";
    const note = body.notes?.trim();
    const [updated] = await ctx.db
      .update(campaignVariants)
      .set({
        moderationDecision: approve ? "auto_approved" : "auto_rejected",
        moderationReasons: [
          ...existing.moderationReasons,
          `reviewer:${approve ? "approved" : "rejected"}${note ? `:${note}` : ""}`,
        ],
      })
      .where(eq(campaignVariants.id, id))
      .returning();

    await logFraud(ctx.db, {
      severity: "info",
      rule: approve ? "admin_variant_approved" : "admin_variant_rejected",
      detail: { variantId: id, campaignId: existing.campaignId, notes: note ?? null },
    });
    return updated;
  });

  app.post("/admin/tasks/:id/review", async (req, reply) => {
    if (!guard(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = reviewSchema.parse(req.body);

    const [existing] = await ctx.db.select().from(socialTasks).where(eq(socialTasks.id, id)).limit(1);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (existing.status !== "pending") return reply.code(409).send({ error: "already_reviewed" });

    const approve = body.decision === "approve";
    const note = body.notes?.trim();

    const updated = await ctx.db.transaction(async (tx) => {
      const [task] = await tx
        .update(socialTasks)
        .set({
          status: approve ? "approved" : "rejected",
          reviewerNotes: note ?? null,
          reviewedAt: new Date(),
        })
        .where(and(eq(socialTasks.id, id), eq(socialTasks.status, "pending")))
        .returning();
      if (!task) return null;

      if (approve) {
        await postTransfer(tx, {
          entryType: "social_task_reward",
          from: ACCOUNTS.platformPromoLiability,
          to: ACCOUNTS.user(task.userId),
          amountMicro: task.rewardMicro,
          referenceType: "social_task",
          referenceId: task.id,
          memo: "Social task approved by reviewer",
        });
      }
      return task;
    });
    if (!updated) return reply.code(409).send({ error: "already_reviewed" });

    await logFraud(ctx.db, {
      userId: existing.userId,
      severity: "info",
      rule: approve ? "admin_task_approved" : "admin_task_rejected",
      detail: { taskId: id, notes: note ?? null },
    });
    return updated;
  });

  app.post("/admin/payouts/:id/review", async (req, reply) => {
    if (!guard(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = reviewSchema.parse(req.body);

    const [existing] = await ctx.db
      .select()
      .from(payoutRequests)
      .where(eq(payoutRequests.id, id))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (existing.status !== "auditing" && existing.status !== "frozen") {
      return reply.code(409).send({ error: "already_resolved" });
    }

    const approve = body.decision === "approve";
    const note = body.notes?.trim();

    const outcome = await ctx.db.transaction(async (tx) => {
      if (approve) {
        // A frozen request was never debited; a reviewed approval performs the
        // debit now. An auditing request already moved the money at request
        // time, so only its status changes.
        if (existing.status === "frozen") {
          const [user] = await tx
            .select()
            .from(users)
            .where(eq(users.id, existing.userId))
            .for("update")
            .limit(1);
          if (!user) return { error: "user_missing" } as const;
          const available = await balanceOf(tx, ACCOUNTS.user(existing.userId));
          if (available < existing.amountMicro) return { error: "insufficient_balance" } as const;
        }
        const [request] = await tx
          .update(payoutRequests)
          .set({ status: "approved", resolvedAt: new Date(), failureReason: null })
          .where(
            and(
              eq(payoutRequests.id, id),
              inArray(payoutRequests.status, ["auditing", "frozen"]),
            ),
          )
          .returning();
        if (!request) return { error: "already_resolved" } as const;

        if (existing.status === "frozen") {
          await postTransfer(tx, {
            entryType: "payout_debit",
            from: ACCOUNTS.user(existing.userId),
            to: ACCOUNTS.platformFloat,
            amountMicro: existing.amountMicro,
            referenceType: "payout",
            referenceId: existing.id,
            memo: "Frozen payout approved and debited by reviewer",
          });
        }
        return { request } as const;
      }

      const [request] = await tx
        .update(payoutRequests)
        .set({ status: "rejected", resolvedAt: new Date(), failureReason: note ?? "reviewer_rejected" })
        .where(
          and(eq(payoutRequests.id, id), inArray(payoutRequests.status, ["auditing", "frozen"])),
        )
        .returning();
      if (!request) return { error: "already_resolved" } as const;

      // Auditing requests already debited the user; rejection refunds them.
      if (existing.status === "auditing") {
        await postTransfer(tx, {
          entryType: "adjustment",
          from: ACCOUNTS.platformFloat,
          to: ACCOUNTS.user(existing.userId),
          amountMicro: existing.amountMicro,
          referenceType: "payout",
          referenceId: existing.id,
          memo: "Payout rejected by reviewer — refund",
        });
      }
      return { request } as const;
    });

    if ("error" in outcome) {
      if (outcome.error === "insufficient_balance") return reply.code(400).send({ error: outcome.error });
      return reply.code(409).send({ error: outcome.error });
    }

    await logFraud(ctx.db, {
      userId: existing.userId,
      severity: approve ? "info" : "warning",
      rule: approve ? "admin_payout_approved" : "admin_payout_rejected",
      detail: { payoutId: id, amountMicro: existing.amountMicro.toString(), notes: note ?? null },
    });
    return outcome.request;
  });
}
