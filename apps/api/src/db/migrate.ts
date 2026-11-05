import { loadEnv } from "../env.js";
import { createDb } from "@meantime/shared/db";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, "../../drizzle");

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied.");
  process.exit(0);
}

void main();
