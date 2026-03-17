CREATE TABLE "gas_credit_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"allocated_cents" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gas_credit_alloc_org_period" UNIQUE("organization_id","period_start")
);
--> statement-breakpoint
ALTER TABLE "gas_credit_allocations" ADD CONSTRAINT "gas_credit_allocations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_gas_credit_alloc_org" ON "gas_credit_allocations" USING btree ("organization_id");