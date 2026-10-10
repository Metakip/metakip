CREATE TABLE "invitation_email_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"delivery_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"invited_by" uuid NOT NULL,
	"email" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_email_attempts_delivery_attempt_unique" UNIQUE("delivery_id","attempt_number")
);
--> statement-breakpoint
CREATE TABLE "invitation_send_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"invitation_id" uuid NOT NULL,
	"invited_by" uuid NOT NULL,
	"email" text NOT NULL,
	"token_encrypted" text NOT NULL,
	"token_hash" text NOT NULL,
	"email_body_encrypted" text,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now(),
	"lease_until" timestamp with time zone,
	"claim_token" uuid,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_send_attempts_status_check" CHECK ("status" in ('pending', 'processing', 'sent', 'failed', 'superseded')),
	CONSTRAINT "invitation_send_attempts_attempts_check" CHECK ("attempts" between 0 and 5),
	CONSTRAINT "invitation_send_attempts_state_check" CHECK (("status" = 'pending'
              and "completed_at" is null
              and "lease_until" is null
              and "claim_token" is null
              and "next_attempt_at" is not null)
            or ("status" = 'processing'
              and "attempts" > 0
              and "completed_at" is null
              and "lease_until" is not null
              and "claim_token" is not null
              and "next_attempt_at" is not null)
            or ("status" in ('sent', 'failed', 'superseded')
              and "completed_at" is not null
              and "lease_until" is null
              and "claim_token" is null
              and "next_attempt_at" is null))
);
--> statement-breakpoint
CREATE TABLE "pending_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"email" text NOT NULL,
	"permission" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"token_hash" text NOT NULL CONSTRAINT "pending_invitations_token_hash_unique" UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp with time zone,
	"accepted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_invitations_target_email_unique" UNIQUE("target_type","target_id","email"),
	CONSTRAINT "pending_invitations_target_permission_check" CHECK (("target_type" = 'workspace' and "permission" in ('viewer', 'editor', 'admin'))
            or ("target_type" in ('page', 'folder') and "permission" in ('view', 'commenter', 'edit', 'admin'))),
	CONSTRAINT "pending_invitations_status_check" CHECK ("status" in ('pending', 'accepted', 'declined', 'revoked', 'superseded')),
	CONSTRAINT "pending_invitations_resolution_check" CHECK (("status" = 'pending' and "resolved_at" is null and "accepted_by" is null)
            or ("status" = 'accepted' and "resolved_at" is not null and "accepted_by" is not null)
            or ("status" in ('declined', 'revoked', 'superseded')
                and "resolved_at" is not null and "accepted_by" is null))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_setup_completed_at" timestamp;--> statement-breakpoint
CREATE INDEX "invitation_email_attempts_invitation_attempted_idx" ON "invitation_email_attempts" ("invitation_id","attempted_at");--> statement-breakpoint
CREATE INDEX "invitation_email_attempts_sender_attempted_idx" ON "invitation_email_attempts" ("invited_by","attempted_at");--> statement-breakpoint
CREATE INDEX "invitation_email_attempts_sender_email_attempted_idx" ON "invitation_email_attempts" ("invited_by","email","attempted_at");--> statement-breakpoint
CREATE INDEX "invitation_email_attempts_retention_idx" ON "invitation_email_attempts" ("attempted_at");--> statement-breakpoint
CREATE INDEX "invitation_send_attempts_invitation_attempted_idx" ON "invitation_send_attempts" ("invitation_id","attempted_at");--> statement-breakpoint
CREATE INDEX "invitation_send_attempts_sender_attempted_idx" ON "invitation_send_attempts" ("invited_by","attempted_at");--> statement-breakpoint
CREATE INDEX "invitation_send_attempts_sender_email_attempted_idx" ON "invitation_send_attempts" ("invited_by","email","attempted_at");--> statement-breakpoint
CREATE INDEX "invitation_send_attempts_pending_delivery_idx" ON "invitation_send_attempts" ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "invitation_send_attempts_completed_idx" ON "invitation_send_attempts" ("completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_send_attempts_active_invitation_unique" ON "invitation_send_attempts" ("invitation_id") WHERE "status" in ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "pending_invitations_target_idx" ON "pending_invitations" ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "pending_invitations_invited_by_idx" ON "pending_invitations" ("invited_by");--> statement-breakpoint
CREATE INDEX "pending_invitations_accepted_by_idx" ON "pending_invitations" ("accepted_by");--> statement-breakpoint
CREATE INDEX "pending_invitations_retention_idx" ON "pending_invitations" ("status","resolved_at");--> statement-breakpoint
CREATE INDEX "pending_invitations_expiry_idx" ON "pending_invitations" ("expires_at");--> statement-breakpoint
ALTER TABLE "invitation_email_attempts" ADD CONSTRAINT "invitation_email_attempts_invited_by_users_id_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation_send_attempts" ADD CONSTRAINT "invitation_send_attempts_czXVznlMQwIw_fkey" FOREIGN KEY ("invitation_id") REFERENCES "pending_invitations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation_send_attempts" ADD CONSTRAINT "invitation_send_attempts_invited_by_users_id_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pending_invitations" ADD CONSTRAINT "pending_invitations_invited_by_users_id_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pending_invitations" ADD CONSTRAINT "pending_invitations_accepted_by_users_id_fkey" FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
UPDATE "users"
SET "account_setup_completed_at" = coalesce("onboarding_completed_at", "created_at", now());--> statement-breakpoint
CREATE FUNCTION get_invitation_claim_status(invitation pending_invitations)
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT CASE
    WHEN invitation.status = 'pending' THEN CASE
      WHEN invitation.expires_at <= now() THEN 'expired'
      WHEN (
        (invitation.target_type = 'workspace' AND invitation.invited_by = invitation.target_id)
        OR (invitation.target_type = 'page' AND EXISTS (
          SELECT 1 FROM get_effective_page_permission(invitation.target_id, invitation.invited_by) access
          WHERE (access.full_access OR access.permission = 'admin')
            AND (invitation.permission <> 'admin' OR access.full_access)
        ))
        OR (invitation.target_type = 'folder' AND EXISTS (
          SELECT 1 FROM get_effective_folder_permission(invitation.target_id, invitation.invited_by) access
          WHERE (access.full_access OR access.permission = 'admin')
            AND (invitation.permission <> 'admin' OR access.full_access)
        ))
      ) THEN 'pending'
      ELSE 'revoked'
    END
    WHEN invitation.status = 'superseded' THEN CASE
      WHEN (
        (invitation.target_type = 'workspace' AND EXISTS (
          SELECT 1 FROM workspace_members membership
          JOIN users recipient ON recipient.id = membership.member_id
          WHERE membership.workspace_owner_id = invitation.target_id
            AND lower(recipient.email) = invitation.email
        ))
        OR (invitation.target_type IN ('page', 'folder')
            AND (
              (invitation.target_type = 'page' AND EXISTS (
                SELECT 1 FROM pages target
                WHERE target.id = invitation.target_id AND target.is_deleted = false
              ))
              OR (invitation.target_type = 'folder' AND EXISTS (
                SELECT 1 FROM folders target
                WHERE target.id = invitation.target_id AND target.is_deleted = false
              ))
            )
            AND EXISTS (
              SELECT 1 FROM shares direct_grant
              JOIN users recipient ON recipient.id = direct_grant.recipient_user_id
              WHERE direct_grant.entity_type = invitation.target_type
                AND direct_grant.entity_id = invitation.target_id
                AND lower(recipient.email) = invitation.email
            ))
      ) THEN 'superseded'
      ELSE 'revoked'
    END
    ELSE invitation.status
  END;
$$;
--> statement-breakpoint
CREATE FUNCTION revoke_invalid_workspace_invitations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.version IS DISTINCT FROM (
    SELECT version FROM workspace_access_versions
    WHERE workspace_owner_id = NEW.workspace_owner_id
  ) THEN
    RETURN NULL;
  END IF;
  UPDATE pending_invitations invitation
  SET status = 'revoked', resolved_at = now(), accepted_by = NULL, updated_at = now()
  WHERE invitation.status IN ('pending', 'superseded')
    AND (
      (invitation.target_type = 'workspace' AND invitation.target_id = NEW.workspace_owner_id)
      OR (invitation.target_type = 'page' AND EXISTS (
        SELECT 1 FROM pages page
        WHERE page.id = invitation.target_id
          AND coalesce((
            SELECT root.created_by FROM folder_closure closure
            JOIN folders root ON root.id = closure.ancestor_id
            WHERE closure.descendant_id = page.parent_id AND root.parent_id IS NULL
            LIMIT 1
          ), page.created_by) = NEW.workspace_owner_id
      ))
      OR (invitation.target_type = 'folder' AND EXISTS (
        SELECT 1 FROM folders folder
        WHERE folder.id = invitation.target_id
          AND coalesce((
            SELECT root.created_by FROM folder_closure closure
            JOIN folders root ON root.id = closure.ancestor_id
            WHERE closure.descendant_id = folder.id AND root.parent_id IS NULL
            LIMIT 1
          ), folder.created_by) = NEW.workspace_owner_id
      ))
    )
    AND get_invitation_claim_status(invitation) = 'revoked';
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER revoke_invitations_after_workspace_access_change
AFTER INSERT OR UPDATE ON workspace_access_versions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION revoke_invalid_workspace_invitations();
--> statement-breakpoint
UPDATE pending_invitations invitation
SET status = 'revoked', resolved_at = now(), accepted_by = NULL, updated_at = now()
WHERE invitation.status IN ('pending', 'superseded')
  AND get_invitation_claim_status(invitation) = 'revoked';
