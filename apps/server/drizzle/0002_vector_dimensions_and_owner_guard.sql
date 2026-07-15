ALTER TABLE "memories" ALTER COLUMN "tsv" SET DEFAULT to_tsvector('english', '');--> statement-breakpoint
UPDATE "memories"
SET "tsv" = to_tsvector('english',
  coalesce("content", '') || ' ' || array_to_string(coalesce("tags", '{}'), ' '))
WHERE "tsv" IS NULL;--> statement-breakpoint
ALTER TABLE "memories" ALTER COLUMN "tsv" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "embedding_dimensions" integer GENERATED ALWAYS AS (vector_dims(embedding)) STORED;--> statement-breakpoint
UPDATE "memories"
SET "embedding" = NULL, "embedding_model" = NULL
WHERE ("embedding" IS NULL) <> ("embedding_model" IS NULL);--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_embedding_pair_check" CHECK (("memories"."embedding" IS NULL) = ("memories"."embedding_model" IS NULL));--> statement-breakpoint

-- Repair legacy organizations created before owner changes were serialized.
-- Prefer the original creator when they are still a member, then the earliest
-- remaining member. The final guard refuses to hide an unrepairable org.
-- Keep writes out through trigger installation so a rolling-deploy replica
-- cannot create a new ownerless organization between repair and enforcement.
LOCK TABLE "organizations", "org_members" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint

UPDATE "org_members" AS member
SET "role" = 'owner'
FROM "organizations" AS org
WHERE member."org_id" = org."id"
  AND member."user_id" = org."created_by"
  AND NOT EXISTS (
    SELECT 1 FROM "org_members" AS owner
    WHERE owner."org_id" = org."id" AND owner."role" = 'owner'
  );--> statement-breakpoint

WITH candidates AS (
  SELECT DISTINCT ON (member."org_id") member."org_id", member."user_id"
  FROM "org_members" AS member
  WHERE NOT EXISTS (
    SELECT 1 FROM "org_members" AS owner
    WHERE owner."org_id" = member."org_id" AND owner."role" = 'owner'
  )
  ORDER BY member."org_id", member."created_at", member."user_id"
)
UPDATE "org_members" AS member
SET "role" = 'owner'
FROM candidates
WHERE member."org_id" = candidates."org_id"
  AND member."user_id" = candidates."user_id";--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "organizations" AS org
    WHERE NOT EXISTS (
      SELECT 1 FROM "org_members" AS owner
      WHERE owner."org_id" = org."id" AND owner."role" = 'owner'
    )
  ) THEN
    RAISE EXCEPTION 'Cannot enforce organization ownership: an organization has no members to promote';
  END IF;
END
$$;--> statement-breakpoint

-- Serialize every owner-count-changing membership statement on its parent org.
-- The deferred assertion below can then validate flexible multi-step transfers
-- without the write-skew that two concurrent owner demotions would otherwise allow.
CREATE FUNCTION "public"."echo_lock_org_owner_change"() RETURNS trigger AS $$
DECLARE
  target_org uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM "public"."organizations" WHERE id = NEW.org_id FOR UPDATE;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM "public"."organizations" WHERE id = OLD.org_id FOR UPDATE;
    RETURN OLD;
  END IF;

  FOR target_org IN
    SELECT changed.org_id
    FROM (VALUES (OLD.org_id), (NEW.org_id)) AS changed(org_id)
    WHERE changed.org_id IS NOT NULL
    GROUP BY changed.org_id
    ORDER BY changed.org_id
  LOOP
    PERFORM 1 FROM "public"."organizations" WHERE id = target_org FOR UPDATE;
  END LOOP;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "echo_org_members_owner_lock_trigger"
BEFORE INSERT OR UPDATE OF "org_id", "role" OR DELETE ON "public"."org_members"
FOR EACH ROW EXECUTE FUNCTION "public"."echo_lock_org_owner_change"();--> statement-breakpoint

CREATE FUNCTION "public"."echo_assert_org_has_owner"(target_org uuid) RETURNS void AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "public"."organizations" WHERE id = target_org)
     AND NOT EXISTS (
       SELECT 1 FROM "public"."org_members"
       WHERE org_id = target_org AND role = 'owner'
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'org_members_owner_required',
      MESSAGE = format('organization %s must have at least one owner', target_org);
  END IF;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE FUNCTION "public"."echo_org_owner_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'organizations' THEN
    PERFORM "public"."echo_assert_org_has_owner"(NEW.id);
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM "public"."echo_assert_org_has_owner"(NEW.org_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM "public"."echo_assert_org_has_owner"(OLD.org_id);
  ELSE
    PERFORM "public"."echo_assert_org_has_owner"(OLD.org_id);
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
      PERFORM "public"."echo_assert_org_has_owner"(NEW.org_id);
    END IF;
  END IF;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "echo_organizations_owner_guard_trigger"
AFTER INSERT OR UPDATE ON "public"."organizations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."echo_org_owner_guard"();--> statement-breakpoint

CREATE CONSTRAINT TRIGGER "echo_org_members_owner_guard_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "public"."org_members"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."echo_org_owner_guard"();
