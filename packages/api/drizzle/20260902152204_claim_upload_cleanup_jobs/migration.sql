DROP INDEX "upload_deletion_queue_updated_at_id_idx";--> statement-breakpoint
ALTER TABLE "upload_deletion_queue" ADD COLUMN "delete_after" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_deletion_queue" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
CREATE INDEX "upload_deletion_queue_ready_idx" ON "upload_deletion_queue" ("delete_after","updated_at","id");