import dotenv from "dotenv";
import { expand } from "dotenv-expand";
import { cleanupTestUsers } from "./utils/cleanup";
import {
  cleanupPersistentTestUsers,
  seedPersistentTestUsers,
} from "./utils/seed";

const DEFAULT_DB_URL =
  "postgresql://postgres:postgres@localhost:5433/keeperhub";

async function globalSetup(): Promise<void> {
  expand(dotenv.config());

  const envDbUrl = process.env.DATABASE_URL;
  if (!envDbUrl || envDbUrl.includes("${")) {
    process.env.DATABASE_URL = DEFAULT_DB_URL;
  }

  // Clean up leftover test data from previous runs
  await cleanupTestUsers();
  await cleanupPersistentTestUsers();

  // Seed persistent test users for invitation tests
  await seedPersistentTestUsers();
}

export default globalSetup;
