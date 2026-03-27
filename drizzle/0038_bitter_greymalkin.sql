CREATE TABLE "mcp_oauth_auth_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"scope" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_oauth_auth_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "key_export_codes" ALTER COLUMN "attempts" SET DEFAULT 0;