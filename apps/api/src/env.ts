import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Load `apps/api/.env` when present. Values already present in process.env
 * are not overridden, so a real deployment environment always wins over the
 * file.
 *
 * Parsed per key rather than with `process.loadEnvFile`, which is all-or-
 * nothing: a single malformed line there would silently drop every later
 * line of the file, including secrets, and the failure is invisible because
 * the code never sees an error for well-formed prefixes. This parser skips
 * only the broken line.
 */
function loadDotEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "apps/api/.env"),
    path.resolve(here, "../.env"),
  ];
  const seen = new Set<string>();
  for (const envPath of candidatePaths) {
    if (!existsSync(envPath)) continue;
    let text: string;
    try {
      text = readFileSync(envPath, "utf8");
    } catch {
      continue; // Unreadable file: the shell environment still applies.
    }
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue; // malformed line — skip, don't drop the rest
      const key = line.slice(0, eq).trim();
      // `export KEY=...` from a shell-style env file is still a binding.
      const bareKey = key.startsWith("export ") ? key.slice(7).trim() : key;
      if (bareKey.length === 0 || seen.has(bareKey)) continue;
      let value = line.slice(eq + 1).trim();
      // Strip symmetric single/double quotes the way dotenv tools do.
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      seen.add(bareKey);
      if (process.env[bareKey] === undefined) process.env[bareKey] = value;
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
  /**
   * Salt for IP equality hashes. A module-scope read would silently bake in
   * the placeholder for every deployment that forgets the variable, making
   * every stored ipHash brute-forceable over the IPv4 space — so it is part
   * of the validated environment and required to look like a real secret.
   */
  IP_HASH_SALT: z.string().min(16),
  /** Moderation classifier base URL. */
  LAYA_ENDPOINT: z.string().url().default("http://localhost:8000"),
  /** Disable to force `needs_review` for all campaign/task moderation. */
  LAYA_ENABLED: z
    .union([z.boolean(), z.string()])
    .default(true)
    .transform((v) => {
      if (typeof v === "boolean") return v;
      return v.toLowerCase() === "true" || v === "1";
    }),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
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
