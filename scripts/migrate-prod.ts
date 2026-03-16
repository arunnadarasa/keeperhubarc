import { execSync } from "node:child_process";

const VERCEL_ENV = process.env.VERCEL_ENV;
const MIGRATE_ENVS = new Set(["production", "preview"]);

if (VERCEL_ENV !== undefined && MIGRATE_ENVS.has(VERCEL_ENV)) {
  console.log(`Running database migrations for ${VERCEL_ENV}...`);
  try {
    execSync("pnpm db:migrate", { stdio: "inherit" });
    console.log("Migrations completed successfully");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
} else {
  console.log(`Skipping migrations (VERCEL_ENV=${VERCEL_ENV ?? "not set"})`);
}
