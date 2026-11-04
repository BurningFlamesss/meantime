import { loadEnv } from "../env.js";
import { createDb, advertisers, campaigns } from "@meantime/shared/db";
import argon2 from "argon2";

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);

  const passwordHash = await argon2.hash("demo-advertiser-pass-123");
  const [adv] = await db
    .insert(advertisers)
    .values({
      email: "demo@advertiser.test",
      passwordHash,
      companyName: "Demo Tools Co.",
      balanceMicro: 50_000_000n, // $50
    })
    .onConflictDoNothing()
    .returning();
  if (!adv) {
    console.log("Seed already applied.");
    return;
  }

  await db.insert(campaigns).values([
    {
      advertiserId: adv.id,
      name: "DevTools Pro — wait-time launch",
      status: "active",
      headline: "Ship faster with DevTools Pro",
      bodyText: "A debugger that understands async stacks. Free for 14 days while you wait on AI.",
      ctaText: "Try free",
      targetUrl: "https://example.com/devtools",
      dailyBudgetMicro: 5_000_000n,
      cpiMicro: 20_000n, // $0.02 per verified 5s view
      targetPlatforms: ["openai", "gemini", "claude", "grok", "deepseek"],
      maxPerDayPerUser: 3,
      cooldownSec: 1800,
    },
    {
      advertiserId: adv.id,
      name: "PromptKit — library",
      status: "active",
      headline: "Stop rewriting the same prompt",
      bodyText: "PromptKit saves your best prompts as reusable snippets. Built for power users.",
      ctaText: "Learn more",
      targetUrl: "https://example.com/promptkit",
      dailyBudgetMicro: 3_000_000n,
      cpiMicro: 15_000n,
      targetPlatforms: ["openai", "gemini", "claude", "grok", "deepseek"],
      maxPerDayPerUser: 2,
      cooldownSec: 3600,
    },
  ]);

  console.log("Seeded demo advertiser and 2 campaigns.");
}

void main();
