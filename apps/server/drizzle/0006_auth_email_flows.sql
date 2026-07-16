CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "auth_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "auth_tokens_purpose_check" CHECK ("auth_tokens"."purpose" IN ('verify_email', 'password_reset'))
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"auth_token_id" uuid,
	"template" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"provider_message_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_template_check" CHECK ("email_outbox"."template" IN ('verify_email', 'password_reset', 'password_changed'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
-- Accounts created before email verification existed were provisioned through
-- a trusted/private deployment flow. Preserve their access during upgrades.
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;--> statement-breakpoint
-- Keep mixed-version replicas from issuing a session for a newly-created,
-- unverified account while a rolling deployment is in progress.
CREATE OR REPLACE FUNCTION "public"."echo_require_verified_session_user"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "public"."users"
    WHERE id = NEW.user_id AND email_verified_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'email address must be verified before creating a session'
      USING ERRCODE = '23514', CONSTRAINT = 'sessions_verified_user_required';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "echo_sessions_verified_user_trigger"
  BEFORE INSERT OR UPDATE OF user_id ON "public"."sessions"
  FOR EACH ROW EXECUTE FUNCTION "public"."echo_require_verified_session_user"();--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_auth_token_id_auth_tokens_id_fk" FOREIGN KEY ("auth_token_id") REFERENCES "public"."auth_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_tokens_user_purpose_idx" ON "auth_tokens" USING btree ("user_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "auth_tokens_expires_idx" ON "auth_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_outbox_auth_token_unique" ON "email_outbox" USING btree ("auth_token_id") WHERE "email_outbox"."auth_token_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "email_outbox_dispatch_idx" ON "email_outbox" USING btree ("next_attempt_at") WHERE "email_outbox"."sent_at" IS NULL AND "email_outbox"."failed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "email_outbox_provider_message_idx" ON "email_outbox" USING btree ("provider_message_id") WHERE "email_outbox"."provider_message_id" IS NOT NULL;
