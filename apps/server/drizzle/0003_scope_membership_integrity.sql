ALTER TABLE "scope_members" DROP CONSTRAINT "scope_members_scope_id_scopes_id_fk";
--> statement-breakpoint
ALTER TABLE "scope_members" DROP CONSTRAINT "scope_members_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "scope_members" ADD COLUMN "org_id" uuid;--> statement-breakpoint
UPDATE "scope_members" AS member
SET "org_id" = scope."org_id"
FROM "scopes" AS scope
WHERE scope."id" = member."scope_id"
  AND scope."org_id" IS NOT NULL;--> statement-breakpoint

-- A stale row could restore private scope access if a removed user later
-- rejoined the organization. Keep only rows backed by a current org member.
DELETE FROM "scope_members" AS member
WHERE member."org_id" IS NULL
   OR NOT EXISTS (
     SELECT 1
     FROM "org_members" AS org_member
     WHERE org_member."org_id" = member."org_id"
       AND org_member."user_id" = member."user_id"
   );--> statement-breakpoint

-- Older replicas insert only (scope_id, user_id). Derive the redundant org id
-- in the database so rolling deploys stay compatible while the composite FKs
-- make cross-organization memberships impossible.
CREATE FUNCTION "public"."echo_scope_member_set_org"() RETURNS trigger AS $$
BEGIN
  SELECT scope."org_id" INTO NEW.org_id
  FROM "public"."scopes" AS scope
  WHERE scope."id" = NEW.scope_id;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "echo_scope_members_org_fill_trigger"
BEFORE INSERT OR UPDATE OF "scope_id", "org_id" ON "public"."scope_members"
FOR EACH ROW EXECUTE FUNCTION "public"."echo_scope_member_set_org"();--> statement-breakpoint

ALTER TABLE "scope_members" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scopes" ADD CONSTRAINT "scopes_id_org_id_unique" UNIQUE("id","org_id");--> statement-breakpoint
ALTER TABLE "scope_members" ADD CONSTRAINT "scope_members_scope_org_fk" FOREIGN KEY ("scope_id","org_id") REFERENCES "public"."scopes"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_members" ADD CONSTRAINT "scope_members_org_member_fk" FOREIGN KEY ("org_id","user_id") REFERENCES "public"."org_members"("org_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scope_members_org_user_idx" ON "scope_members" USING btree ("org_id","user_id");
