CREATE TABLE "data_migrations" (
	"name" text PRIMARY KEY,
	"completed_at" timestamp DEFAULT now() NOT NULL
);

-- A database with no pages was created directly on the Markdown editor
-- schema and has no legacy content to convert.
INSERT INTO "data_migrations" ("name")
SELECT 'milkdown_to_codemirror_markdown_v1'
WHERE NOT EXISTS (SELECT 1 FROM "pages");
