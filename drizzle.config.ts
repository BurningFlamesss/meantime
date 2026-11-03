import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  dialect: "postgresql",
  // Schema is absolute so it resolves from any workspace. `out` must stay
  // relative: drizzle-kit prefixes it with "./" and an absolute path becomes
  // the invalid `.//home/...` (which broke generation when run from apps/api).
  schema: path.join(root, "packages/shared/src/db/schema.ts"),
  out: "drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/meantime",
  },
});
