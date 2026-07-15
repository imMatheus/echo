ALTER TABLE "org_members" DROP CONSTRAINT "org_members_role_check";--> statement-breakpoint
-- Fire the deferred owner-guard trigger per statement instead of at commit;
-- otherwise its pending events block the ALTER TABLE below.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
-- The admin role is retired: demote existing admins to member (never silently
-- escalate privileges). Owners must re-grant owner explicitly where needed.
UPDATE "org_members" SET "role" = 'member' WHERE "role" = 'admin';--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_role_check" CHECK ("org_members"."role" IN ('owner', 'member'));
