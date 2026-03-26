ALTER TABLE "direct_executions" ALTER COLUMN "network" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "key_export_codes" ALTER COLUMN "attempts" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "direct_executions" ADD COLUMN "gas_price_wei" text;--> statement-breakpoint
ALTER TABLE "direct_executions" ADD COLUMN "estimated_cost_usd" text;--> statement-breakpoint
ALTER TABLE "direct_executions" ADD COLUMN "retry_count" integer DEFAULT 0 NOT NULL;