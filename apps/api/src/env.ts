import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Load `apps/api/.env` when present. Node >=20.12 exposes
 * `process.loadEnvFile`; on older runtimes we simply rely on the shell
 * environment. Values already present in process.env are not overridden.
 */
function loadDotEnv(): void {
  if (typeof process.loadEnvFile !== "function") return;
  const envPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch {
    // A malformed .env should not mask the actionable validation error below.
  }
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  LEASE_HMAC_SECRET: z.string().min(16),
  JWT_SECRET: z.string().min(16),
  S3_BUCKET: z.string().min(1),
  S3_ENDPOINT: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_REGION: z.string().default("us-east-1"),
  PORT: z.coerce.number().int().default(3001),
  WEB_ORIGIN: z.string().default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  loadDotEnv();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ");
    throw new Error(`Invalid environment: ${missing}`);
  }
  return parsed.data;
}
