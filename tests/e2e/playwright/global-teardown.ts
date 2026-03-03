import dotenv from "dotenv";
import { expand } from "dotenv-expand";
import { cleanupTestUsers } from "./utils/cleanup";
import { cleanupPersistentTestUsers } from "./utils/seed";

const DEFAULT_DB_URL =
  "postgresql://postgres:postgres@localhost:5433/keeperhub";

function isRemoteMode(): boolean {
  return !!(process.env.BASE_URL && process.env.TEST_API_KEY);
}

async function globalTeardown(): Promise<void> {
  expand(dotenv.config());

  if (isRemoteMode()) {
    return;
  }

  const envDbUrl = process.env.DATABASE_URL;
  if (!envDbUrl || envDbUrl.includes("${")) {
    process.env.DATABASE_URL = DEFAULT_DB_URL;
  }

  await cleanupTestUsers();
  await cleanupPersistentTestUsers();
}

export default globalTeardown;
