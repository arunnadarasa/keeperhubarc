-- Rename para_wallets to organization_wallets
ALTER TABLE "para_wallets" RENAME TO "organization_wallets";

-- Add provider column with default "para" for existing rows
ALTER TABLE "organization_wallets" ADD COLUMN "provider" text NOT NULL DEFAULT 'para';

-- Remove the default after backfilling (all existing rows are Para)
ALTER TABLE "organization_wallets" ALTER COLUMN "provider" DROP DEFAULT;

-- Rename Para-specific column
ALTER TABLE "organization_wallets" RENAME COLUMN "wallet_id" TO "para_wallet_id";

-- Make Para-specific columns nullable (Turnkey wallets won't have them)
ALTER TABLE "organization_wallets" ALTER COLUMN "para_wallet_id" DROP NOT NULL;
ALTER TABLE "organization_wallets" ALTER COLUMN "user_share" DROP NOT NULL;

-- Add Turnkey-specific columns
ALTER TABLE "organization_wallets" ADD COLUMN "turnkey_sub_org_id" text;
ALTER TABLE "organization_wallets" ADD COLUMN "turnkey_wallet_id" text;
ALTER TABLE "organization_wallets" ADD COLUMN "turnkey_private_key_id" text;
