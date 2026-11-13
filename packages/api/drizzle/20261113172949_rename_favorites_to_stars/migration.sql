ALTER TABLE "user_favorites" RENAME TO "user_stars";--> statement-breakpoint
ALTER TABLE "user_stars" RENAME CONSTRAINT "user_favorites_pkey" TO "user_stars_pkey";--> statement-breakpoint
ALTER TABLE "user_stars" RENAME CONSTRAINT "user_favorites_user_id_users_id_fkey" TO "user_stars_user_id_users_id_fkey";--> statement-breakpoint
ALTER TABLE "user_stars" RENAME CONSTRAINT "user_favorites_user_id_entity_type_entity_id_unique" TO "user_stars_user_id_entity_type_entity_id_unique";--> statement-breakpoint
ALTER TABLE "user_stars" RENAME CONSTRAINT "user_favorites_entity_type_check" TO "user_stars_entity_type_check";--> statement-breakpoint
ALTER INDEX "user_favorites_entity_idx" RENAME TO "user_stars_entity_idx";
