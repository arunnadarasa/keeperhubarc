ALTER TABLE "chains" ADD COLUMN "use_private_mempool_rpc" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "chains" ADD COLUMN "default_private_rpc_url" text;--> statement-breakpoint
UPDATE "chains" SET "use_private_mempool_rpc" = true, "default_private_rpc_url" = 'https://rpc.flashbots.net/fast' WHERE "chain_id" = 1;