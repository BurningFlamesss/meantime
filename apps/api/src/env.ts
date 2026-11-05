import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Load `apps/api/.env` when present. Node >=20.12 exposes
 * `process.loadEnvFile`; on older runtimes we simply rely on the shell
 * environment. Values already present in process.env are not overridden.
 */
function loadDotEnv(): void {
  if (typeof process.loadEnvFile !== "function") return;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "apps/api/.env"),
    path.resolve(here, "../.env"),
  ];
  for (const envPath of candidatePaths) {
    if (existsSync(envPath)) {
      try {
        process.loadEnvFile(envPath);
      } catch {
        // A malformed .env should not mask the actionable validation error below.
      }
    }
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
  /** Operator key for /admin/*. Unset disables the reviewer surface (503). */
  ADMIN_API_KEY: z.string().min(16).optional(),
  /** SMTP email configuration for verification emails (e.g. Gmail App Password). */
  SMTP_HOST: z.string().default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().int().default(465),
  SMTP_SECURE: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => {
      if (typeof v === "boolean") return v;
      if (typeof v === "string") return v.toLowerCase() === "true" || v === "1";
      return true;
    }),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("MeanTime <noreply@meantime.app>"),
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
