import dotenv from "dotenv";
import { expand } from "dotenv-expand";
import { cleanupTestUsers } from "../../tests/e2e/playwright/utils/cleanup";
import {
  cleanupPersistentTestUsers,
  seedAnalyticsData,
  seedPersistentTestUsers,
} from "../../tests/e2e/playwright/utils/seed";

const DEFAULT_DB_URL =
  "postgresql://postgres:postgres@localhost:5433/keeperhub";

async function seedEval(): Promise<void> {
  expand(dotenv.config());

  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("${")) {
    process.env.DATABASE_URL = DEFAULT_DB_URL;
  }

  await cleanupTestUsers();
  await cleanupPersistentTestUsers();
  await seedPersistentTestUsers();
  await seedAnalyticsData();
  console.log("[seed-eval] Seed complete");
}

export default seedEval;
