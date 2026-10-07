CREATE TABLE "page_comment_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"page_id" uuid NOT NULL,
	"anchor" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp,
	CONSTRAINT "page_comment_threads_status_check" CHECK ("status" in ('open', 'resolved')),
	CONSTRAINT "page_comment_threads_resolution_check" CHECK (("status" = 'open' and "resolved_at" is null and "resolved_by" is null)
        or ("status" = 'resolved' and "resolved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "page_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"thread_id" uuid NOT NULL,
	"author_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "page_comments_body_length_check" CHECK (char_length("body") <= 10000)
);
--> statement-breakpoint
CREATE INDEX "page_comment_threads_page_created_idx" ON "page_comment_threads" ("page_id","created_at","id");--> statement-breakpoint
CREATE INDEX "page_comment_threads_page_status_updated_idx" ON "page_comment_threads" ("page_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "page_comments_thread_created_idx" ON "page_comments" ("thread_id","created_at","id");--> statement-breakpoint
ALTER TABLE "page_comment_threads" ADD CONSTRAINT "page_comment_threads_page_id_pages_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "page_comment_threads" ADD CONSTRAINT "page_comment_threads_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "page_comment_threads" ADD CONSTRAINT "page_comment_threads_resolved_by_users_id_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "page_comments" ADD CONSTRAINT "page_comments_thread_id_page_comment_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "page_comment_threads"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "page_comments" ADD CONSTRAINT "page_comments_author_id_users_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "shares" DROP CONSTRAINT "shares_permission_check";--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_permission_check" CHECK ("permission" in ('view', 'commenter', 'edit', 'admin'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION get_account_page_permission(p_page_id uuid, p_user_id uuid)
RETURNS TABLE(permission text, full_access boolean)
LANGUAGE plpgsql STABLE
AS $function$
DECLARE
  v_owner_id uuid;
  v_parent_id uuid;
  v_result text;
BEGIN
  SELECT COALESCE(get_root_folder_owner(page.parent_id), page.created_by), page.parent_id
  INTO v_owner_id, v_parent_id
  FROM pages page
  WHERE page.id = p_page_id AND page.is_deleted = false;

  IF v_owner_id IS NULL THEN RETURN QUERY SELECT NULL::text, false; RETURN; END IF;
  IF v_owner_id = p_user_id THEN RETURN QUERY SELECT 'edit'::text, true; RETURN; END IF;

  SELECT candidate.permission INTO v_result
  FROM (
    SELECT share.permission, 1 AS source_rank
    FROM shares share
    WHERE share.entity_type = 'page' AND share.entity_id = p_page_id
      AND share.recipient_user_id = p_user_id
    UNION ALL
    SELECT share.permission, 2
    FROM shares share
    JOIN folders source ON source.id = share.entity_id
    WHERE share.entity_type = 'folder' AND share.recipient_user_id = p_user_id
      AND source.is_deleted = false
      AND share.entity_id IN (
        SELECT ancestor_id FROM folder_closure WHERE descendant_id = v_parent_id
      )
      AND NOT is_page_folder_inheritance_blocked(share.entity_id, p_page_id)
    UNION ALL
    SELECT CASE member.role
      WHEN 'viewer' THEN 'view'
      WHEN 'editor' THEN 'edit'
      WHEN 'admin' THEN 'admin'
      ELSE NULL
    END, 3
    FROM workspace_members member
    WHERE member.workspace_owner_id = v_owner_id AND member.member_id = p_user_id
      AND NOT is_page_path_restricted(p_page_id)
  ) candidate
  ORDER BY CASE candidate.permission
    WHEN 'admin' THEN 4 WHEN 'edit' THEN 3 WHEN 'commenter' THEN 2 ELSE 1 END DESC,
    candidate.source_rank ASC
  LIMIT 1;
  RETURN QUERY SELECT v_result, false;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION get_account_folder_permission(p_folder_id uuid, p_user_id uuid)
RETURNS TABLE(permission text, full_access boolean)
LANGUAGE plpgsql STABLE
AS $function$
DECLARE
  v_owner_id uuid;
  v_result text;
BEGIN
  SELECT get_root_folder_owner(p_folder_id) INTO v_owner_id
  WHERE EXISTS (SELECT 1 FROM folders WHERE id = p_folder_id AND is_deleted = false);
  IF v_owner_id IS NULL THEN RETURN QUERY SELECT NULL::text, false; RETURN; END IF;
  IF v_owner_id = p_user_id THEN RETURN QUERY SELECT 'admin'::text, true; RETURN; END IF;

  SELECT candidate.permission INTO v_result
  FROM (
    SELECT share.permission, 1 AS source_rank
    FROM shares share
    WHERE share.entity_type = 'folder' AND share.entity_id = p_folder_id
      AND share.recipient_user_id = p_user_id
    UNION ALL
    SELECT share.permission, 2
    FROM shares share
    JOIN folders source ON source.id = share.entity_id
    WHERE share.entity_type = 'folder' AND share.recipient_user_id = p_user_id
      AND source.is_deleted = false
      AND share.entity_id IN (
        SELECT ancestor_id FROM folder_closure
        WHERE descendant_id = p_folder_id AND ancestor_id <> p_folder_id
      )
      AND NOT is_folder_inheritance_blocked(share.entity_id, p_folder_id)
    UNION ALL
    SELECT CASE member.role
      WHEN 'viewer' THEN 'view'
      WHEN 'editor' THEN 'edit'
      WHEN 'admin' THEN 'admin'
      ELSE NULL
    END, 3
    FROM workspace_members member
    WHERE member.workspace_owner_id = v_owner_id AND member.member_id = p_user_id
      AND NOT is_folder_path_restricted(p_folder_id)
  ) candidate
  ORDER BY CASE candidate.permission
    WHEN 'admin' THEN 4 WHEN 'edit' THEN 3 WHEN 'commenter' THEN 2 ELSE 1 END DESC,
    candidate.source_rank ASC
  LIMIT 1;
  RETURN QUERY SELECT v_result, false;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION get_page_access_snapshot(p_page_id uuid, p_user_id uuid)
RETURNS TABLE(
  account_permission text,
  public_permission text,
  permission text,
  full_access boolean
)
LANGUAGE sql STABLE
AS $function$
  WITH account AS MATERIALIZED (
    SELECT * FROM get_account_page_permission(p_page_id, p_user_id)
  ), public_access AS MATERIALIZED (
    SELECT get_public_page_permission(p_page_id) AS permission
  ), candidates AS (
    SELECT account.permission, account.full_access, 1 AS source_rank
    FROM account WHERE account.permission IS NOT NULL
    UNION ALL
    SELECT public_access.permission, false, 2
    FROM public_access WHERE public_access.permission IS NOT NULL
  ), effective AS (
    SELECT candidates.permission, candidates.full_access
    FROM candidates
    ORDER BY CASE candidates.permission
      WHEN 'admin' THEN 4 WHEN 'edit' THEN 3 WHEN 'commenter' THEN 2 ELSE 1 END DESC,
      candidates.source_rank ASC
    LIMIT 1
  )
  SELECT account.permission, public_access.permission, effective.permission,
         COALESCE(effective.full_access, false)
  FROM account
  CROSS JOIN public_access
  LEFT JOIN effective ON true;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION get_folder_access_snapshot(p_folder_id uuid, p_user_id uuid)
RETURNS TABLE(
  account_permission text,
  public_permission text,
  permission text,
  full_access boolean
)
LANGUAGE sql STABLE
AS $function$
  WITH account AS MATERIALIZED (
    SELECT * FROM get_account_folder_permission(p_folder_id, p_user_id)
  ), public_access AS MATERIALIZED (
    SELECT get_public_folder_permission(p_folder_id) AS permission
  ), candidates AS (
    SELECT account.permission, account.full_access, 1 AS source_rank
    FROM account WHERE account.permission IS NOT NULL
    UNION ALL
    SELECT public_access.permission, false, 2
    FROM public_access WHERE public_access.permission IS NOT NULL
  ), effective AS (
    SELECT candidates.permission, candidates.full_access
    FROM candidates
    ORDER BY CASE candidates.permission
      WHEN 'admin' THEN 4 WHEN 'edit' THEN 3 WHEN 'commenter' THEN 2 ELSE 1 END DESC,
      candidates.source_rank ASC
    LIMIT 1
  )
  SELECT account.permission, public_access.permission, effective.permission,
         COALESCE(effective.full_access, false)
  FROM account
  CROSS JOIN public_access
  LEFT JOIN effective ON true;
$function$;
