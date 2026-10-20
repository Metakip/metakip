package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func testRuntime(t *testing.T, handler http.Handler, jsonOutput bool) (*runtimeState, *bytes.Buffer) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	c, err := newClient(context.Background(), server.URL, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	output := &bytes.Buffer{}
	return &runtimeState{
		ctx: context.Background(), cli: &CLI{JSON: jsonOutput, Timeout: time.Second},
		stdin: bytes.NewReader(nil), stdout: output, stderr: io.Discard, clientValue: c,
	}, output
}

func TestPageListFetchesPagesAndFoldersConcurrently(t *testing.T) {
	arrived := make(chan string, 2)
	release := make(chan struct{})
	var releaseOnce sync.Once
	releaseRequests := func() { releaseOnce.Do(func() { close(release) }) }
	defer releaseRequests()
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		arrived <- request.URL.Path
		<-release
		switch request.URL.Path {
		case "/api/v1/pages":
			fmt.Fprint(response, `{"data":[{"id":"page","title":"Page"}],"nextCursor":null}`)
		case "/api/v1/folders":
			fmt.Fprint(response, `{"data":[],"nextCursor":null}`)
		default:
			http.Error(response, "unexpected path", http.StatusNotFound)
		}
	}), true)

	done := make(chan error, 1)
	go func() { done <- (&PageListCmd{}).Run(runtime) }()
	for range 2 {
		select {
		case <-arrived:
		case <-time.After(time.Second):
			t.Fatal("page and folder requests were not concurrent")
		}
	}
	releaseRequests()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestSearchSendsTrimmedQueryAndRendersPagesAndFolders(t *testing.T) {
	runtime, output := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.URL.Path != "/api/v1/search" {
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
		if request.URL.Query().Get("q") != "project notes" {
			t.Fatalf("unexpected search query %q", request.URL.Query().Get("q"))
		}
		fmt.Fprint(response, `{"data":[{"type":"page","id":"page-id","parentId":null,"title":"Project Notes","icon":"📝","cover":null,"properties":{"priority":"high"},"ownerId":"owner-id","permission":"view","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z","folderPath":"/Research","titleMatches":[{"start":0,"end":7}],"snippet":{"text":"Project notes in the body","matches":[{"start":0,"end":7}]}},{"type":"folder","id":"folder-id","parentId":null,"name":"Research","icon":null,"ownerId":"owner-id","permission":"view","createdAt":null,"updatedAt":null,"folderPath":"/Research","titleMatches":[{"start":0,"end":8}]}]}`)
	}), true)

	if err := (&SearchCmd{Query: "  project notes  "}).Run(runtime); err != nil {
		t.Fatal(err)
	}
	var results []searchResult
	if err := json.Unmarshal(output.Bytes(), &results); err != nil {
		t.Fatal(err)
	}
	if len(results) != 2 || results[0].ID != "page-id" || results[0].FolderPath != "/Research" || results[1].ID != "folder-id" || results[1].displayName() != "Research" {
		t.Fatalf("unexpected search results %#v", results)
	}
	if results[0].Snippet == nil || results[0].Snippet.Text != "Project notes in the body" || len(results[0].TitleMatches) != 1 {
		t.Fatalf("search highlights were not decoded: %#v", results[0])
	}
	var encoded []map[string]json.RawMessage
	if err := json.Unmarshal(output.Bytes(), &encoded); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"cover", "properties", "ownerId", "permission", "createdAt", "updatedAt", "snippet", "titleMatches"} {
		if _, ok := encoded[0][key]; !ok {
			t.Errorf("JSON output omitted API field %q", key)
		}
	}
	if _, ok := encoded[1]["name"]; !ok {
		t.Error("JSON output omitted folder name")
	}
	if _, ok := encoded[1]["ownerId"]; !ok {
		t.Error("JSON output omitted folder metadata")
	}
}

func TestSearchPlainOutputIncludesSnippetAndIcon(t *testing.T) {
	runtime, output := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		fmt.Fprint(response, `{"data":[{"type":"page","id":"page-id","title":"Project Notes","icon":"📝","folderPath":"/Research","titleMatches":[{"start":0,"end":7}],"snippet":{"text":"Project notes in the body","matches":[{"start":0,"end":7}]}}]}`)
	}), false)

	if err := (&SearchCmd{Query: "project"}).Run(runtime); err != nil {
		t.Fatal(err)
	}
	if got, want := output.String(), "page\tProject Notes\t/Research\tpage-id\t📝\tProject notes in the body\n"; got != want {
		t.Fatalf("search output = %q, want %q", got, want)
	}
}

func TestSearchRejectsBlankQueryBeforeMakingARequest(t *testing.T) {
	requests := 0
	runtime, _ := testRuntime(t, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		requests++
	}), true)

	err := (&SearchCmd{Query: "  "}).Run(runtime)
	if exitCode(err) != exitUsage {
		t.Fatalf("expected usage error, got %v", err)
	}
	if requests != 0 {
		t.Fatalf("made %d API requests", requests)
	}
}

func TestSearchReportsNoMatches(t *testing.T) {
	runtime, output := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/search" {
			t.Fatalf("unexpected request %s", request.URL.Path)
		}
		fmt.Fprint(response, `{"data":[]}`)
	}), false)

	if err := (&SearchCmd{Query: "missing"}).Run(runtime); err != nil {
		t.Fatal(err)
	}
	if output.String() != "No matching pages or folders found.\n" {
		t.Fatalf("unexpected output %q", output.String())
	}
}

func TestSearchMatchOffsetsUseUTF16CodeUnits(t *testing.T) {
	for _, test := range []struct {
		name   string
		offset int
		want   int
	}{
		{name: "before supplementary character", offset: 1, want: 1},
		{name: "after supplementary character", offset: 3, want: 5},
		{name: "after final character", offset: 4, want: 6},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := utf16ByteOffset("A😀B", test.offset); got != test.want {
				t.Fatalf("utf16ByteOffset(%q, %d) = %d, want %d", "A😀B", test.offset, got, test.want)
			}
		})
	}
}

func TestPageCreateSendsInitialMarkdown(t *testing.T) {
	markdownFile, err := os.CreateTemp(t.TempDir(), "page-*.md")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := markdownFile.WriteString("# Authored heading\n"); err != nil {
		t.Fatal(err)
	}
	markdownFile.Close()
	runtime, output := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/api/v1/pages" {
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["title"] != "Notes" || body["markdown"] != "# Authored heading\n" || body["icon"] != "📝" {
			t.Fatalf("unexpected body %#v", body)
		}
		response.WriteHeader(http.StatusCreated)
		fmt.Fprint(response, `{"id":"5d418de1-6b6f-4bb3-a35c-bc0c134b48dd","title":"Notes"}`)
	}), true)

	cmd := PageCreateCmd{Title: "Notes", Icon: "📝", ContentFile: markdownFile.Name()}
	if err := cmd.Run(runtime); err != nil {
		t.Fatal(err)
	}
	var created page
	if err := json.Unmarshal(output.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Title != "Notes" {
		t.Fatalf("unexpected page %#v", created)
	}
}

func TestPageUpdateUsesMetadataEndpoint(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/api/v1/pages/"+pageID:
			fmt.Fprintf(response, `{"id":%q,"title":"Old"}`, pageID)
		case request.Method == http.MethodPatch && request.URL.Path == "/api/v1/pages/"+pageID:
			var body map[string]any
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["title"] != "New" {
				t.Fatalf("unexpected body %#v", body)
			}
			fmt.Fprintf(response, `{"id":%q,"title":"New"}`, pageID)
		default:
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
	}), true)

	if err := (&PageUpdateCmd{Reference: pageID, Title: "New"}).Run(runtime); err != nil {
		t.Fatal(err)
	}
}

func TestPageEditUsesRequestedEditorAndETag(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	editor := testEditorCommand(t)
	runtime, output := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/api/v1/pages/"+pageID:
			fmt.Fprintf(response, `{"id":%q,"title":"Page"}`, pageID)
		case request.Method == http.MethodGet && request.URL.Path == "/api/v1/pages/"+pageID+"/content":
			response.Header().Set("ETag", `"revision"`)
			fmt.Fprint(response, "Before")
		case request.Method == http.MethodPut && request.URL.Path == "/api/v1/pages/"+pageID+"/content":
			if request.Header.Get("If-Match") != `"revision"` {
				t.Fatalf("unexpected If-Match %q", request.Header.Get("If-Match"))
			}
			body, err := io.ReadAll(request.Body)
			if err != nil {
				t.Fatal(err)
			}
			if string(body) != "Edited" {
				t.Fatalf("unexpected content %q", body)
			}
			response.Header().Set("ETag", `"updated"`)
			response.WriteHeader(http.StatusNoContent)
		default:
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
	}), true)

	if err := (&PageEditInteractiveCmd{Reference: pageID, Editor: editor}).Run(runtime); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(output.Bytes(), []byte(`"changed": true`)) {
		t.Fatalf("unexpected output %s", output.String())
	}
}

func TestPageEditReturnsConflictWhenTargetDoesNotApply(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	oldFile := t.TempDir() + "/old.txt"
	newFile := t.TempDir() + "/new.txt"
	if err := os.WriteFile(oldFile, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(newFile, []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.Method {
		case http.MethodGet:
			fmt.Fprintf(response, `{"id":%q,"title":"Page"}`, pageID)
		case http.MethodPost:
			fmt.Fprint(response, `{"results":[{"id":"edit","status":"conflict","reason":"old_text_not_found"}],"etag":"etag"}`)
		}
	}), true)

	err := (&PageEditExactCmd{Reference: pageID, OldFile: oldFile, NewFile: newFile, EditID: "edit"}).Run(runtime)
	if exitCode(err) != exitConflict {
		t.Fatalf("expected conflict exit, got %v", err)
	}
}

func TestPageEditAcceptsStringInputsIncludingEmptyReplacement(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	oldText := "remove me"
	newText := ""
	runtime, output := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.Method {
		case http.MethodGet:
			fmt.Fprintf(response, `{"id":%q,"title":"Page"}`, pageID)
		case http.MethodPost:
			var body struct {
				Edits []struct {
					OldText string `json:"oldText"`
					NewText string `json:"newText"`
				} `json:"edits"`
			}
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if len(body.Edits) != 1 || body.Edits[0].OldText != oldText || body.Edits[0].NewText != newText {
				t.Fatalf("unexpected edit %#v", body.Edits)
			}
			fmt.Fprint(response, `{"results":[{"id":"edit","status":"applied"}],"etag":"etag"}`)
		default:
			t.Fatalf("unexpected request %s", request.Method)
		}
	}), true)

	if err := (&PageEditExactCmd{Reference: pageID, OldText: &oldText, NewText: &newText, EditID: "edit"}).Run(runtime); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(output.Bytes(), []byte(`"status": "applied"`)) {
		t.Fatalf("unexpected output %s", output.String())
	}
}

func TestPageEditExpectEmptySendsEmptyPrecondition(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	newText := "# Initial content"
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.Method {
		case http.MethodGet:
			fmt.Fprintf(response, `{"id":%q,"title":"Page"}`, pageID)
		case http.MethodPost:
			var body struct {
				Edits []exactEdit `json:"edits"`
			}
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if len(body.Edits) != 1 || body.Edits[0].OldText != "" || body.Edits[0].NewText != newText {
				t.Fatalf("unexpected edit %#v", body.Edits)
			}
			fmt.Fprint(response, `{"results":[{"id":"edit","status":"applied"}],"etag":"etag"}`)
		default:
			t.Fatalf("unexpected request %s", request.Method)
		}
	}), true)

	if err := (&PageEditExactCmd{Reference: pageID, ExpectEmpty: true, NewText: &newText, EditID: "edit"}).Run(runtime); err != nil {
		t.Fatal(err)
	}
}

func TestWholePageEditsUseAppropriateConcurrencyControls(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	tests := []struct {
		name      string
		current   string
		content   string
		operation string
		run       func(*runtimeState) error
	}{
		{
			name:      "replace",
			current:   "Old document",
			content:   "New document\n",
			operation: "replace",
			run: func(runtime *runtimeState) error {
				return (&PageEditReplaceCmd{Reference: pageID, ContentText: pageContentPointer("New document\n")}).Run(runtime)
			},
		},
		{
			name:      "append",
			content:   "\nAdded",
			operation: "append",
			run: func(runtime *runtimeState) error {
				return (&PageEditAppendCmd{Reference: pageID, ContentText: pageContentPointer("\nAdded"), EditID: "append"}).Run(runtime)
			},
		},
		{
			name:      "prepend",
			content:   "Added\n\n",
			operation: "prepend",
			run: func(runtime *runtimeState) error {
				return (&PageEditPrependCmd{Reference: pageID, ContentText: pageContentPointer("Added\n\n"), EditID: "prepend"}).Run(runtime)
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				switch {
				case request.Method == http.MethodGet && request.URL.Path == "/api/v1/pages/"+pageID:
					fmt.Fprintf(response, `{"id":%q,"title":"Page"}`, pageID)
				case request.Method == http.MethodGet && request.URL.Path == "/api/v1/pages/"+pageID+"/content":
					response.Header().Set("ETag", `"current"`)
					fmt.Fprint(response, test.current)
				case request.Method == http.MethodPut && request.URL.Path == "/api/v1/pages/"+pageID+"/content":
					if test.operation != "replace" || request.Header.Get("If-Match") != `"current"` {
						t.Fatalf("unexpected replacement request")
					}
					body, err := io.ReadAll(request.Body)
					if err != nil || string(body) != test.content {
						t.Fatalf("unexpected replacement %q: %v", body, err)
					}
					response.Header().Set("ETag", `"updated"`)
				case request.Method == http.MethodPost && request.URL.Path == "/api/v1/pages/"+pageID+"/content-operations":
					var body contentBoundaryOperation
					if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
						t.Fatal(err)
					}
					if test.operation == "replace" || body.ID != test.operation || body.Operation != test.operation || body.Content != test.content {
						t.Fatalf("unexpected boundary operation %#v", body)
					}
					fmt.Fprintf(response, `{"id":%q,"etag":"etag"}`, body.ID)
				default:
					t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
				}
			}), true)
			if err := test.run(runtime); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPageEditReplaceReturnsConflictWhenRevisionChanges(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/api/v1/pages/"+pageID:
			fmt.Fprintf(response, `{"id":%q,"title":"Page"}`, pageID)
		case request.Method == http.MethodGet && request.URL.Path == "/api/v1/pages/"+pageID+"/content":
			response.Header().Set("ETag", `"before"`)
			fmt.Fprint(response, "Before")
		case request.Method == http.MethodPut && request.URL.Path == "/api/v1/pages/"+pageID+"/content":
			if request.Header.Get("If-Match") != `"before"` {
				t.Fatalf("unexpected If-Match %q", request.Header.Get("If-Match"))
			}
			response.Header().Set("Content-Type", "application/json")
			response.WriteHeader(http.StatusConflict)
			fmt.Fprint(response, `{"error":{"code":"content_conflict","message":"Page changed since it was read"}}`)
		default:
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
	}), true)

	err := (&PageEditReplaceCmd{Reference: pageID, ContentText: pageContentPointer("Replacement")}).Run(runtime)
	if exitCode(err) != exitConflict {
		t.Fatalf("expected revision conflict, got %v", err)
	}
	if errorCode(err) == "edit_outcome_uncertain" {
		t.Fatalf("revision conflict was reported as uncertain: %v", err)
	}
}

func TestAppendAndPrependRejectEmptyContent(t *testing.T) {
	for _, command := range []struct {
		name string
		run  func(*runtimeState) error
	}{
		{
			name: "append",
			run: func(runtime *runtimeState) error {
				empty := ""
				return (&PageEditAppendCmd{Reference: "page", ContentText: &empty}).Run(runtime)
			},
		},
		{
			name: "prepend",
			run: func(runtime *runtimeState) error {
				empty := ""
				return (&PageEditPrependCmd{Reference: "page", ContentText: &empty}).Run(runtime)
			},
		},
	} {
		t.Run(command.name, func(t *testing.T) {
			runtime, _ := testRuntime(t, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				t.Fatal("empty content made an API request")
			}), true)
			if err := command.run(runtime); exitCode(err) != exitUsage {
				t.Fatalf("expected usage error, got %v", err)
			}
		})
	}
}

func TestWholePageEditsRequireInspectionAfterUncertainOutcome(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	for _, test := range []struct {
		name string
		run  func(*runtimeState) error
	}{
		{
			name: "replace",
			run: func(runtime *runtimeState) error {
				return (&PageEditReplaceCmd{Reference: pageID, ContentText: pageContentPointer("Replacement")}).Run(runtime)
			},
		},
		{
			name: "append",
			run: func(runtime *runtimeState) error {
				return (&PageEditAppendCmd{Reference: pageID, ContentText: pageContentPointer("Appendix")}).Run(runtime)
			},
		},
		{
			name: "prepend",
			run: func(runtime *runtimeState) error {
				return (&PageEditPrependCmd{Reference: pageID, ContentText: pageContentPointer("Introduction")}).Run(runtime)
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				switch {
				case request.Method == http.MethodGet && request.URL.Path == "/api/v1/pages/"+pageID:
					fmt.Fprintf(response, `{"id":%q,"title":"Page"}`, pageID)
				case request.Method == http.MethodGet && request.URL.Path == "/api/v1/pages/"+pageID+"/content":
					fmt.Fprint(response, "Current content")
				case request.Method == http.MethodPut && request.URL.Path == "/api/v1/pages/"+pageID+"/content":
					time.Sleep(250 * time.Millisecond)
				case request.Method == http.MethodPost && request.URL.Path == "/api/v1/pages/"+pageID+"/content-operations":
					time.Sleep(250 * time.Millisecond)
				default:
					t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
				}
			}), true)
			runtime.clientValue.timeout = 100 * time.Millisecond
			runtime.clientValue.http.Timeout = 100 * time.Millisecond
			err := test.run(runtime)
			var uncertain *cliError
			if !errors.As(err, &uncertain) || uncertain.Code != "edit_outcome_uncertain" {
				t.Fatalf("expected uncertain edit error, got %v", err)
			}
			if !strings.Contains(uncertain.Message, "Check the page") || strings.Contains(uncertain.Message, "retry with") {
				t.Fatalf("unsafe retry guidance: %q", uncertain.Message)
			}
		})
	}
}

func TestPageEditReportsLostResponseAsUncertain(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	oldText := "before"
	newText := "after"
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/api/v1/pages/"+pageID:
			fmt.Fprintf(response, `{"id":%q,"title":"Page"}`, pageID)
		case request.Method == http.MethodPost && request.URL.Path == "/api/v1/pages/"+pageID+"/edits":
			hijacker, ok := response.(http.Hijacker)
			if !ok {
				t.Fatal("test server does not support connection hijacking")
			}
			connection, buffered, err := hijacker.Hijack()
			if err != nil {
				t.Fatal(err)
			}
			_, _ = fmt.Fprint(buffered, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 200\r\nConnection: close\r\n\r\n{\"results\":")
			if err := buffered.Flush(); err != nil {
				t.Fatal(err)
			}
			connection.Close()
		default:
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
	}), true)
	err := (&PageEditExactCmd{
		Reference: pageID,
		OldText:   &oldText,
		NewText:   &newText,
		EditID:    "edit",
	}).Run(runtime)
	var uncertain *cliError
	if !errors.As(err, &uncertain) || uncertain.Code != "edit_outcome_uncertain" {
		t.Fatalf("expected uncertain edit error, got %v", err)
	}
	details, ok := uncertain.Details.(*uncertainEditDetails)
	if !ok || details.EditID != "edit" || details.IdempotencyKey == "" {
		t.Fatalf("missing uncertain edit details: %#v", uncertain.Details)
	}
}

func TestUncertainWriteOutcomeRecognizesUnknownServiceFailures(t *testing.T) {
	err := uncertainWriteOutcome(
		&cliError{Code: "COLLABORATION_FAILURE", StatusCode: http.StatusServiceUnavailable},
		"edit",
		"key",
	)
	if errorCode(err) != "edit_outcome_uncertain" {
		t.Fatalf("expected uncertain outcome, got %v", err)
	}
}

func TestBoundaryOperationCancellationReportsUncertainOutcome(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	for _, test := range []struct {
		operation string
		label     string
	}{
		{operation: "append", label: "Appended"},
		{operation: "prepend", label: "Prepended"},
	} {
		t.Run(test.operation, func(t *testing.T) {
			requestStarted := make(chan struct{})
			releaseRequest := make(chan struct{})
			defer close(releaseRequest)
			runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				switch {
				case request.Method == http.MethodGet && request.URL.Path == "/api/v1/pages/"+pageID:
					fmt.Fprintf(response, `{"id":%q,"title":"Page"}`, pageID)
				case request.Method == http.MethodPost && request.URL.Path == "/api/v1/pages/"+pageID+"/content-operations":
					close(requestStarted)
					<-releaseRequest
				default:
					t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
				}
			}), false)
			stderr := &bytes.Buffer{}
			runtime.stderr = stderr
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			runtime.clientValue.ctx = ctx

			done := make(chan error, 1)
			go func() {
				done <- runContentBoundaryOperation(
					runtime,
					pageID,
					pageContentPointer("Added"),
					"",
					"edit-id",
					"idempotency-key",
					test.operation,
					test.label,
				)
			}()
			select {
			case <-requestStarted:
			case <-time.After(time.Second):
				t.Fatal("boundary operation was not transmitted")
			}
			cancel()
			err := <-done
			if errorCode(err) != "edit_outcome_uncertain" || !errors.Is(err, context.Canceled) {
				t.Fatalf("expected uncertain canceled write, got %v", err)
			}
			if got := reportRunError(runtime, err); got != exitFailure {
				t.Fatalf("unexpected exit code %d", got)
			}
			output := stderr.String()
			if !strings.Contains(output, "The edit may have succeeded. Check the page before issuing another edit:") ||
				!strings.Contains(output, "Edit ID: edit-id") ||
				!strings.Contains(output, "Idempotency key: idempotency-key") {
				t.Fatalf("uncertain cancellation details were not displayed: %q", output)
			}
		})
	}
}

func pageContentPointer(value string) *string {
	return &value
}

func TestPageEditExactRejectsEmptyOldInputWithoutExpectEmpty(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	requests := 0
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests++
		response.WriteHeader(http.StatusInternalServerError)
	}), true)

	empty := ""
	err := (&PageEditExactCmd{Reference: pageID, OldText: &empty, NewText: &empty}).Run(runtime)
	if exitCode(err) != exitUsage {
		t.Fatalf("expected usage error for empty old text, got %v", err)
	}
	if requests != 0 {
		t.Fatalf("made %d requests for empty old text", requests)
	}

	emptyFile := t.TempDir() + "/empty.txt"
	if err := os.WriteFile(emptyFile, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	err = (&PageEditExactCmd{Reference: pageID, OldFile: emptyFile, NewText: &empty}).Run(runtime)
	if exitCode(err) != exitUsage {
		t.Fatalf("expected usage error for empty old file, got %v", err)
	}
	if requests != 0 {
		t.Fatalf("made %d requests for empty old file", requests)
	}
}

func TestPageEditReportsUncertainOutcomeAndAllowsCallerManagedReplay(t *testing.T) {
	pageID := "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	oldText := "anchor"
	newText := "inserted"
	var lock sync.Mutex
	committedKeys := map[string]bool{}
	applications := 0
	runtime, output := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.Method {
		case http.MethodGet:
			fmt.Fprintf(response, `{"id":%q,"title":"Page"}`, pageID)
		case http.MethodPost:
			key := request.Header.Get("Idempotency-Key")
			lock.Lock()
			alreadyCommitted := committedKeys[key]
			if !alreadyCommitted {
				committedKeys[key] = true
				applications++
			}
			lock.Unlock()
			if !alreadyCommitted {
				time.Sleep(250 * time.Millisecond)
			}
			fmt.Fprint(response, `{"results":[{"id":"edit","status":"applied"}],"etag":"etag"}`)
		default:
			t.Fatalf("unexpected request %s", request.Method)
		}
	}), true)
	runtime.clientValue.timeout = 100 * time.Millisecond
	runtime.clientValue.http.Timeout = 100 * time.Millisecond

	first := &PageEditExactCmd{
		Reference: pageID,
		OldText:   &oldText,
		NewText:   &newText,
		EditID:    "edit",
	}
	err := first.Run(runtime)
	var uncertain *cliError
	if !errors.As(err, &uncertain) || uncertain.Code != "edit_outcome_uncertain" {
		t.Fatalf("expected uncertain edit error, got %v", err)
	}
	details, ok := uncertain.Details.(*uncertainEditDetails)
	if !ok || details.IdempotencyKey == "" || details.EditID != "edit" {
		t.Fatalf("missing uncertain edit details: %#v", uncertain.Details)
	}
	if !strings.Contains(uncertain.Message, "Check the page") || strings.Contains(uncertain.Message, details.IdempotencyKey) {
		t.Fatalf("unsafe retry guidance: %q", uncertain.Message)
	}
	runtime.printError(err)
	var errorOutput struct {
		Error struct {
			Message string               `json:"message"`
			Details uncertainEditDetails `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(output.Bytes(), &errorOutput); err != nil {
		t.Fatal(err)
	}
	if errorOutput.Error.Details.IdempotencyKey != details.IdempotencyKey || errorOutput.Error.Details.EditID != details.EditID {
		t.Fatalf("JSON error omitted uncertain edit details: %s", output.String())
	}
	if !strings.HasPrefix(errorOutput.Error.Message, "The edit may have succeeded. Check the page before issuing another edit:") {
		t.Fatalf("JSON error used unexpected edit guidance: %s", output.String())
	}

	runtime.clientValue.timeout = time.Second
	runtime.clientValue.http.Timeout = time.Second
	replay := &PageEditExactCmd{
		Reference:      pageID,
		OldText:        &oldText,
		NewText:        &newText,
		EditID:         "edit",
		IdempotencyKey: details.IdempotencyKey,
	}
	if err := replay.Run(runtime); err != nil {
		t.Fatal(err)
	}
	lock.Lock()
	defer lock.Unlock()
	if applications != 1 {
		t.Fatalf("edit applied %d times", applications)
	}
}

func TestReplacementInputRequiresOneSource(t *testing.T) {
	if _, err := replacementInput(nil, "", bytes.NewReader(nil), "old"); exitCode(err) != exitUsage {
		t.Fatalf("expected usage error, got %v", err)
	}
	value := "text"
	if _, err := replacementInput(&value, "passage.md", bytes.NewReader(nil), "old"); exitCode(err) != exitUsage {
		t.Fatalf("expected usage error, got %v", err)
	}
}

func TestReadContentFileEnforcesLimitForStdinAndFiles(t *testing.T) {
	exact := bytes.Repeat([]byte("x"), maxContentInputBytes)
	content, err := readContentFile("-", bytes.NewReader(exact))
	if err != nil {
		t.Fatal(err)
	}
	if len(content) != maxContentInputBytes {
		t.Fatalf("read %d bytes", len(content))
	}

	tooLarge := append(exact, 'x')
	if _, err := readContentFile("-", bytes.NewReader(tooLarge)); errorCode(err) != "payload_too_large" {
		t.Fatalf("expected stdin payload_too_large, got %v", err)
	}
	path := t.TempDir() + "/bounded.md"
	if err := os.WriteFile(path, exact, 0o600); err != nil {
		t.Fatal(err)
	}
	if content, err := readContentFile(path, bytes.NewReader(nil)); err != nil || len(content) != maxContentInputBytes {
		t.Fatalf("expected exact-size file, got %d bytes and %v", len(content), err)
	}
	if err := os.WriteFile(path, tooLarge, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readContentFile(path, bytes.NewReader(nil)); errorCode(err) != "payload_too_large" {
		t.Fatalf("expected file payload_too_large, got %v", err)
	}
}

func TestOversizedStdinFailsBeforeAPIRequest(t *testing.T) {
	requests := 0
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests++
		response.WriteHeader(http.StatusInternalServerError)
	}), true)
	runtime.stdin = bytes.NewReader(bytes.Repeat([]byte("x"), maxContentInputBytes+1))

	err := (&PageCreateCmd{Title: "Too large", ContentFile: "-"}).Run(runtime)
	if errorCode(err) != "payload_too_large" {
		t.Fatalf("expected payload_too_large, got %v", err)
	}
	if requests != 0 {
		t.Fatalf("made %d API requests", requests)
	}
}
