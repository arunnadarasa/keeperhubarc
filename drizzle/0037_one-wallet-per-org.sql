-- Restrict to one wallet per organization (regardless of provider)
DROP INDEX IF EXISTS "uq_org_wallet_provider";
CREATE UNIQUE INDEX "uq_org_wallet" ON "organization_wallets" ("organization_id");
