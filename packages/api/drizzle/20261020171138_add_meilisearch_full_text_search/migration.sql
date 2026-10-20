CREATE TABLE "folder_search_index_queue" (
	"folder_id" uuid PRIMARY KEY,
	"requested_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_index_queue" (
	"page_id" uuid PRIMARY KEY,
	"requested_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_index_state" (
	"index_uid" text PRIMARY KEY,
	"generation" text NOT NULL
);
--> statement-breakpoint
DROP INDEX "pages_title_search_idx";--> statement-breakpoint
ALTER TABLE "pages" DROP COLUMN "title_search";--> statement-breakpoint
ALTER TABLE "pages" DROP COLUMN "content_search";--> statement-breakpoint
CREATE INDEX "folder_search_index_queue_requested_at_idx" ON "folder_search_index_queue" ("requested_at");--> statement-breakpoint
CREATE INDEX "search_index_queue_requested_at_idx" ON "search_index_queue" ("requested_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enqueue_page_search_index_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'UPDATE' THEN
		IF NEW.title IS NOT DISTINCT FROM OLD.title
			AND NEW.ydoc IS NOT DISTINCT FROM OLD.ydoc
			AND NEW.is_deleted IS NOT DISTINCT FROM OLD.is_deleted
			AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id
			AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
			AND NEW.public_permission IS NOT DISTINCT FROM OLD.public_permission
			AND NEW.inheritance_policy IS NOT DISTINCT FROM OLD.inheritance_policy THEN
			RETURN NEW;
		END IF;
	END IF;

	IF TG_OP = 'DELETE' THEN
		INSERT INTO search_index_queue (page_id, requested_at)
		VALUES (OLD.id, clock_timestamp())
		ON CONFLICT (page_id) DO UPDATE
		SET requested_at = greatest(clock_timestamp(), search_index_queue.requested_at + interval '1 millisecond');
		RETURN OLD;
	END IF;

	INSERT INTO search_index_queue (page_id, requested_at)
	VALUES (NEW.id, clock_timestamp())
	ON CONFLICT (page_id) DO UPDATE
	SET requested_at = greatest(clock_timestamp(), search_index_queue.requested_at + interval '1 millisecond');
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pages_search_index_queue_trigger
AFTER INSERT OR UPDATE OR DELETE ON pages
FOR EACH ROW EXECUTE FUNCTION enqueue_page_search_index_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enqueue_folder_search_index_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'UPDATE' THEN
		IF NEW.name IS NOT DISTINCT FROM OLD.name
			AND NEW.is_deleted IS NOT DISTINCT FROM OLD.is_deleted
			AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id
			AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
			AND NEW.public_permission IS NOT DISTINCT FROM OLD.public_permission
			AND NEW.inheritance_policy IS NOT DISTINCT FROM OLD.inheritance_policy THEN
			RETURN NEW;
		END IF;
	END IF;

	IF TG_OP = 'DELETE' THEN
		INSERT INTO folder_search_index_queue (folder_id, requested_at)
		VALUES (OLD.id, clock_timestamp())
		ON CONFLICT (folder_id) DO UPDATE
		SET requested_at = greatest(clock_timestamp(), folder_search_index_queue.requested_at + interval '1 millisecond');
		RETURN OLD;
	END IF;

	INSERT INTO folder_search_index_queue (folder_id, requested_at)
	VALUES (NEW.id, clock_timestamp())
	ON CONFLICT (folder_id) DO UPDATE
	SET requested_at = greatest(clock_timestamp(), folder_search_index_queue.requested_at + interval '1 millisecond');
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER folders_search_index_queue_trigger
AFTER INSERT OR UPDATE OR DELETE ON folders
FOR EACH ROW EXECUTE FUNCTION enqueue_folder_search_index_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enqueue_search_index_for_folder_subtrees(p_folder_ids uuid[])
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	requested_at_value timestamptz := clock_timestamp();
BEGIN
	-- Distinct IDs are necessary when several changed folders share descendants.
	INSERT INTO search_index_queue (page_id, requested_at)
	SELECT DISTINCT page.id, requested_at_value
	FROM pages page
	JOIN folder_closure path ON path.descendant_id = page.parent_id
	WHERE path.ancestor_id = ANY(p_folder_ids)
	ON CONFLICT (page_id) DO UPDATE
	SET requested_at = greatest(EXCLUDED.requested_at, search_index_queue.requested_at + interval '1 millisecond');

	INSERT INTO folder_search_index_queue (folder_id, requested_at)
	SELECT DISTINCT path.descendant_id, requested_at_value
	FROM folder_closure path
	WHERE path.ancestor_id = ANY(p_folder_ids)
	ON CONFLICT (folder_id) DO UPDATE
	SET requested_at = greatest(EXCLUDED.requested_at, folder_search_index_queue.requested_at + interval '1 millisecond');
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enqueue_search_index_for_acl_entity(p_entity_type text, p_entity_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
	IF p_entity_type = 'page' THEN
		INSERT INTO search_index_queue (page_id, requested_at)
		VALUES (p_entity_id, clock_timestamp())
		ON CONFLICT (page_id) DO UPDATE
		SET requested_at = greatest(EXCLUDED.requested_at, search_index_queue.requested_at + interval '1 millisecond');
	ELSIF p_entity_type = 'folder' THEN
		PERFORM enqueue_search_index_for_folder_subtrees(ARRAY[p_entity_id]);
	END IF;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enqueue_search_index_for_share_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP <> 'INSERT' THEN
		PERFORM enqueue_search_index_for_acl_entity(OLD.entity_type, OLD.entity_id);
	END IF;
	IF TG_OP <> 'DELETE' THEN
		PERFORM enqueue_search_index_for_acl_entity(NEW.entity_type, NEW.entity_id);
	END IF;
	IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER shares_search_acl_queue_trigger
AFTER INSERT OR UPDATE OF entity_type, entity_id, recipient_user_id, permission OR DELETE ON shares
FOR EACH ROW EXECUTE FUNCTION enqueue_search_index_for_share_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enqueue_search_index_for_folder_acl_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	changed_folder_ids uuid[];
BEGIN
	-- If an ancestor changed too, its subtree already covers this folder.
	WITH changed AS MATERIALIZED (
		SELECT updated.id
		FROM new_rows updated
		JOIN old_rows previous USING (id)
		WHERE previous.parent_id IS DISTINCT FROM updated.parent_id
			OR previous.created_by IS DISTINCT FROM updated.created_by
			OR previous.public_permission IS DISTINCT FROM updated.public_permission
			OR previous.inheritance_policy IS DISTINCT FROM updated.inheritance_policy
			OR previous.is_deleted IS DISTINCT FROM updated.is_deleted
	)
	SELECT array_agg(updated.id) INTO changed_folder_ids
	FROM changed updated
	WHERE NOT EXISTS (
		SELECT 1
		FROM folder_closure path
		JOIN changed ancestor ON ancestor.id = path.ancestor_id
		WHERE path.descendant_id = updated.id AND path.ancestor_id <> updated.id
	);

	IF changed_folder_ids IS NOT NULL THEN
		PERFORM enqueue_search_index_for_folder_subtrees(changed_folder_ids);
	END IF;

	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER folders_search_acl_queue_trigger
AFTER UPDATE ON folders
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION enqueue_search_index_for_folder_acl_changes();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enqueue_search_index_for_public_visit_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP <> 'INSERT' THEN
		PERFORM enqueue_search_index_for_acl_entity('page', OLD.page_id);
	END IF;
	IF TG_OP <> 'DELETE' THEN
		PERFORM enqueue_search_index_for_acl_entity('page', NEW.page_id);
	END IF;
	IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER page_public_access_visits_search_acl_queue_trigger
AFTER INSERT OR UPDATE OF page_id, user_id OR DELETE ON page_public_access_visits
FOR EACH ROW EXECUTE FUNCTION enqueue_search_index_for_public_visit_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enqueue_search_index_for_folder_public_visit_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP <> 'INSERT' THEN
		PERFORM enqueue_search_index_for_folder_subtrees(ARRAY[OLD.folder_id]);
	END IF;
	IF TG_OP <> 'DELETE' THEN
		PERFORM enqueue_search_index_for_folder_subtrees(ARRAY[NEW.folder_id]);
	END IF;
	IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER folder_public_access_visits_search_acl_queue_trigger
AFTER INSERT OR UPDATE OF folder_id, user_id OR DELETE ON folder_public_access_visits
FOR EACH ROW EXECUTE FUNCTION enqueue_search_index_for_folder_public_visit_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION get_folder_base_permissions(p_folder_id uuid)
RETURNS TABLE(user_id uuid, permission text)
LANGUAGE sql STABLE
AS $function$
  WITH target AS (
    SELECT folder.id, get_root_folder_owner(folder.id) AS owner_id
    FROM folders folder
    WHERE folder.id = p_folder_id
      AND folder.is_deleted = false
      AND get_root_folder_owner(folder.id) IS NOT NULL
  ), combined AS (
    SELECT share.recipient_user_id AS user_id, share.permission, 1 AS source_rank
    FROM shares share
    WHERE share.entity_type = 'folder' AND share.entity_id = p_folder_id

    UNION ALL

    SELECT share.recipient_user_id, share.permission, 2
    FROM shares share
    JOIN folders source ON source.id = share.entity_id
    JOIN folder_closure path ON path.ancestor_id = source.id
      AND path.descendant_id = p_folder_id
    WHERE share.entity_type = 'folder'
      AND source.is_deleted = false
      AND source.id <> p_folder_id
      AND NOT is_folder_inheritance_blocked(source.id, p_folder_id)

    UNION ALL

    SELECT member.member_id,
      CASE member.role
        WHEN 'viewer' THEN 'view'
        WHEN 'commenter' THEN 'commenter'
        WHEN 'editor' THEN 'edit'
        WHEN 'admin' THEN 'admin'
        ELSE NULL
      END,
      3
    FROM workspace_members member
    JOIN target ON target.owner_id = member.workspace_owner_id
    WHERE NOT is_folder_path_restricted(p_folder_id)
  ), ranked AS (
    SELECT DISTINCT ON (combined.user_id) combined.user_id, combined.permission
    FROM combined
    WHERE combined.user_id IS NOT NULL
    ORDER BY combined.user_id,
      CASE combined.permission
        WHEN 'admin' THEN 4 WHEN 'edit' THEN 3 WHEN 'commenter' THEN 2 ELSE 1
      END DESC,
      combined.source_rank ASC
  )
  SELECT target.owner_id, 'admin'::text
  FROM target
  WHERE target.owner_id IS NOT NULL

  UNION

  SELECT ranked.user_id, ranked.permission
  FROM ranked
  JOIN target ON target.owner_id IS DISTINCT FROM ranked.user_id;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION get_account_folder_permission(p_folder_id uuid, p_user_id uuid)
RETURNS TABLE(permission text, full_access boolean)
LANGUAGE sql STABLE
AS $function$
  SELECT account.permission, COALESCE(account.user_id = target.owner_id, false)
  FROM (SELECT 1) seed
  LEFT JOIN LATERAL (
    SELECT get_root_folder_owner(folder.id) AS owner_id
    FROM folders folder
    WHERE folder.id = p_folder_id AND folder.is_deleted = false
  ) target ON true
  LEFT JOIN LATERAL (
    SELECT base.user_id, base.permission
    FROM get_folder_base_permissions(p_folder_id) base
    WHERE base.user_id = p_user_id
    LIMIT 1
  ) account ON true;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION get_page_search_access_tokens(p_page_id uuid)
RETURNS TABLE(access_token text)
LANGUAGE sql STABLE
AS $function$
  WITH target AS (
    SELECT page.id, COALESCE(get_root_folder_owner(page.parent_id), page.created_by) AS owner_id
    FROM pages page
    WHERE page.id = p_page_id AND page.is_deleted = false
  )
  SELECT DISTINCT 'user:' || account.user_id::text
  FROM target
  CROSS JOIN LATERAL get_page_base_permissions(target.id) account
  WHERE account.user_id = target.owner_id
    OR is_page_path_restricted(target.id)
    OR NOT EXISTS (
      SELECT 1 FROM workspace_members member
      WHERE member.workspace_owner_id = target.owner_id
        AND member.member_id = account.user_id
    )
    OR EXISTS (
      SELECT 1 FROM shares share
      WHERE share.recipient_user_id = account.user_id
        AND (
          (share.entity_type = 'page' AND share.entity_id = target.id)
          OR (share.entity_type = 'folder'
            AND EXISTS (
              SELECT 1 FROM pages page
              JOIN folder_closure path ON path.descendant_id = page.parent_id
              JOIN folders source ON source.id = path.ancestor_id
              WHERE page.id = target.id AND source.id = share.entity_id
                AND source.is_deleted = false
                AND NOT is_page_folder_inheritance_blocked(source.id, target.id)
            ))
        )
    )

  UNION

  SELECT 'workspace:' || target.owner_id::text
  FROM target
  WHERE target.owner_id IS NOT NULL AND NOT is_page_path_restricted(target.id)

  UNION

  SELECT 'user:' || visit.user_id::text
  FROM target
  JOIN page_public_access_visits visit ON visit.page_id = target.id
  WHERE get_public_page_permission(target.id) IS NOT NULL

  UNION

  SELECT 'user:' || visit.user_id::text
  FROM target
  JOIN folder_public_access_visits visit ON true
  JOIN pages page ON page.id = target.id
  JOIN folder_closure parent_path ON parent_path.ancestor_id = visit.folder_id
    AND parent_path.descendant_id = page.parent_id
  WHERE get_public_page_permission(target.id) IS NOT NULL
    AND NOT is_page_folder_inheritance_blocked(visit.folder_id, target.id);
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION get_folder_search_access_tokens(p_folder_id uuid)
RETURNS TABLE(access_token text)
LANGUAGE sql STABLE
AS $function$
  WITH target AS (
    SELECT folder.id, get_root_folder_owner(folder.id) AS owner_id
    FROM folders folder
    WHERE folder.id = p_folder_id AND folder.is_deleted = false
  )
  SELECT DISTINCT 'user:' || account.user_id::text
  FROM target
  CROSS JOIN LATERAL get_folder_base_permissions(target.id) account
  WHERE account.user_id = target.owner_id
    OR is_folder_path_restricted(target.id)
    OR NOT EXISTS (
      SELECT 1 FROM workspace_members member
      WHERE member.workspace_owner_id = target.owner_id
        AND member.member_id = account.user_id
    )
    OR EXISTS (
      SELECT 1 FROM shares share
      JOIN folders source ON source.id = share.entity_id
      JOIN folder_closure path ON path.ancestor_id = source.id
        AND path.descendant_id = target.id
      WHERE share.recipient_user_id = account.user_id
        AND share.entity_type = 'folder' AND source.is_deleted = false
        AND (source.id = target.id OR NOT is_folder_inheritance_blocked(source.id, target.id))
    )

  UNION

  SELECT 'workspace:' || target.owner_id::text
  FROM target
  WHERE target.owner_id IS NOT NULL AND NOT is_folder_path_restricted(target.id)

  UNION

  SELECT 'user:' || visit.user_id::text
  FROM target
  JOIN folder_public_access_visits visit ON true
  JOIN folder_closure path ON path.ancestor_id = visit.folder_id
    AND path.descendant_id = target.id
  JOIN folders source ON source.id = visit.folder_id
  WHERE source.is_deleted = false
    AND get_public_folder_permission(source.id) IS NOT NULL
    AND (source.id = target.id OR NOT is_folder_inheritance_blocked(source.id, target.id));
$function$;
