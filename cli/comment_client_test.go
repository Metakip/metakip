package main

import (
	"encoding/json"
	"testing"
)

func TestPageCommentThreadPreservesResolutionMetadata(t *testing.T) {
	const response = `{"thread":{"id":"thread-id","pageId":"page-id","anchor":{"quote":"text"},"status":"resolved","createdBy":"author-id","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-02T00:00:00.000Z","resolvedBy":"resolver-id","resolvedAt":"2026-01-02T00:00:00.000Z","comments":[]}}`
	var decoded pageCommentThreadResponse
	if err := json.Unmarshal([]byte(response), &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Thread.ResolvedBy == nil || *decoded.Thread.ResolvedBy != "resolver-id" {
		t.Fatalf("resolvedBy = %v, want resolver-id", decoded.Thread.ResolvedBy)
	}
	if decoded.Thread.ResolvedAt == nil || *decoded.Thread.ResolvedAt != "2026-01-02T00:00:00.000Z" {
		t.Fatalf("resolvedAt = %v, want timestamp", decoded.Thread.ResolvedAt)
	}

	encoded, err := json.Marshal(decoded)
	if err != nil {
		t.Fatal(err)
	}
	var roundTripped pageCommentThreadResponse
	if err := json.Unmarshal(encoded, &roundTripped); err != nil {
		t.Fatal(err)
	}
	if roundTripped.Thread.ResolvedBy == nil || *roundTripped.Thread.ResolvedBy != "resolver-id" {
		t.Fatalf("round-tripped resolvedBy = %v, want resolver-id", roundTripped.Thread.ResolvedBy)
	}
	if roundTripped.Thread.ResolvedAt == nil || *roundTripped.Thread.ResolvedAt != "2026-01-02T00:00:00.000Z" {
		t.Fatalf("round-tripped resolvedAt = %v, want timestamp", roundTripped.Thread.ResolvedAt)
	}
}
