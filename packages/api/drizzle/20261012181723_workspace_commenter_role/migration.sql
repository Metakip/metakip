ALTER TABLE "workspace_members" DROP CONSTRAINT "workspace_members_role_check";--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_role_check" CHECK ("role" in ('viewer', 'commenter', 'editor', 'admin'));--> statement-breakpoint
ALTER TABLE "pending_invitations" DROP CONSTRAINT "pending_invitations_target_permission_check", ADD CONSTRAINT "pending_invitations_target_permission_check" CHECK (("target_type" = 'workspace' and "permission" in ('viewer', 'commenter', 'editor', 'admin'))
            or ("target_type" in ('page', 'folder') and "permission" in ('view', 'commenter', 'edit', 'admin')));--> statement-breakpoint
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
      WHEN 'commenter' THEN 'commenter'
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
$function$;--> statement-breakpoint
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
      WHEN 'commenter' THEN 'commenter'
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
CREATE OR REPLACE FUNCTION get_page_base_permissions(p_page_id uuid)
RETURNS TABLE(user_id uuid, permission text)
LANGUAGE plpgsql STABLE
AS $function$
DECLARE
  v_owner_id uuid;
  v_parent_id uuid;
BEGIN
  SELECT COALESCE(get_root_folder_owner(page.parent_id), page.created_by), page.parent_id
  INTO v_owner_id, v_parent_id
  FROM pages page
  WHERE page.id = p_page_id AND page.is_deleted = false;

  RETURN QUERY
  WITH combined AS (
    SELECT share.recipient_user_id AS user_id, share.permission, 1 AS source_rank
    FROM shares share
    WHERE share.entity_type = 'page' AND share.entity_id = p_page_id

    UNION ALL

    SELECT share.recipient_user_id, share.permission, 2
    FROM shares share
    JOIN folders source ON source.id = share.entity_id
    WHERE share.entity_type = 'folder'
      AND source.is_deleted = false
      AND share.entity_id IN (
        SELECT ancestor_id FROM folder_closure WHERE descendant_id = v_parent_id
      )
      AND NOT is_page_folder_inheritance_blocked(share.entity_id, p_page_id)

    UNION ALL

    SELECT member.member_id,
      CASE member.role
        WHEN 'viewer' THEN 'view'
        WHEN 'commenter' THEN 'commenter'
        WHEN 'editor' THEN 'edit'
        WHEN 'admin' THEN 'admin'
      END,
      3
    FROM workspace_members member
    WHERE member.workspace_owner_id = v_owner_id
      AND NOT is_page_path_restricted(p_page_id)
  ), ranked AS (
    SELECT DISTINCT ON (combined.user_id) combined.user_id, combined.permission
    FROM combined
    ORDER BY combined.user_id,
      CASE combined.permission
        WHEN 'admin' THEN 4 WHEN 'edit' THEN 3 WHEN 'commenter' THEN 2 ELSE 1 END DESC,
      combined.source_rank ASC
  )
  SELECT v_owner_id, 'edit'::text WHERE v_owner_id IS NOT NULL
  UNION
  SELECT ranked.user_id, ranked.permission FROM ranked;
END;
$function$;
