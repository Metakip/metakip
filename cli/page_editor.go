package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func preferredEditor(override string) string {
	if value := strings.TrimSpace(override); value != "" {
		return value
	}
	for _, name := range []string{"METAKIP_EDITOR", "VISUAL", "EDITOR"} {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

func editPageInEditor(
	r *runtimeState,
	title string,
	content []byte,
	editorOverride string,
) ([]byte, bool, error) {
	dir, err := os.MkdirTemp("", "metakip-edit-*")
	if err != nil {
		return nil, false, err
	}
	defer os.RemoveAll(dir)
	filename := allocateFilename(title, ".md", make(map[string]struct{}), "Untitled")
	path := filepath.Join(dir, filename)
	if err := os.WriteFile(path, content, 0o600); err != nil {
		return nil, false, err
	}
	editor := preferredEditor(editorOverride)
	if editor == "" {
		return nil, false, usageError("Set METAKIP_EDITOR, VISUAL, or EDITOR, or pass --editor.")
	}
	parts, err := parseEditorCommand(editor)
	if err != nil || len(parts) == 0 {
		return nil, false, usageError("Invalid editor command %q.", editor)
	}
	command := exec.CommandContext(r.ctx, parts[0], append(parts[1:], path)...)
	command.Stdin, command.Stdout, command.Stderr = r.stdin, r.stdout, r.stderr
	if err := command.Run(); err != nil {
		return nil, false, fmt.Errorf("editor failed: %w", err)
	}
	updated, err := readContentFile(path, r.stdin)
	if err != nil {
		return nil, false, err
	}
	return updated, !bytes.Equal(content, updated), nil
}
