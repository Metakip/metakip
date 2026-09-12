#!/bin/bash

migrateEditorContent() {
    local repo_dir="$1"

    echo "[MIGRATION] Converting editor documents to Markdown Y.Text..."
    (
        cd "$repo_dir"
        pnpm --filter @markdawn/api db:migrate-editor-content
    )
}
