import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  dialect: "postgresql",
  // Absolute paths so the config works regardless of which workspace runs it.
  schema: path.join(root, "packages/shared/src/db/schema.ts"),
  out: path.join(root, "apps/api/drizzle"),
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/meantime",
  },
});
