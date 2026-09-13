package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type failingWriter struct {
	err error
}

func (writer failingWriter) Write([]byte) (int, error) {
	return 0, writer.err
}

func TestLifecycleBatchReturnsStructuredPartialFailure(t *testing.T) {
	runtime := &runtimeState{cli: &CLI{JSON: true}, stdout: &bytes.Buffer{}}
	err := finishLifecycleBatch(runtime, lifecycleBatchResult{Items: []lifecycleItemResult{
		{Reference: "ok", ID: "created", Status: "success"},
		{Reference: "denied", Status: "failed", Message: "Forbidden"},
	}})
	var commandError *cliError
	if !errors.As(err, &commandError) || commandError.Code != "lifecycle_partial_failure" {
		t.Fatalf("unexpected error %v", err)
	}
	result, ok := commandError.Details.(lifecycleBatchResult)
	if !ok || len(result.Items) != 2 || result.Items[1].Message != "Forbidden" {
		t.Fatalf("unexpected details %#v", commandError.Details)
	}
	runtime.printError(commandError)
	var output struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(runtime.stdout.(*bytes.Buffer).Bytes(), &output); err != nil {
		t.Fatal(err)
	}
	if output.Error.Message != "One or more items could not be processed." {
		t.Fatalf("unexpected JSON error message: %s", runtime.stdout.(*bytes.Buffer).String())
	}
}

func TestLifecycleBatchPreservesStructuredItemFailures(t *testing.T) {
	runtime := &runtimeState{cli: &CLI{JSON: true}, stdout: &bytes.Buffer{}}
	result := lifecycleBatchResult{Items: make([]lifecycleItemResult, 1)}
	selected := []lifecycleBatchSelection[struct{}]{{
		index: 0, reference: "page", id: "page-id",
	}}
	itemDetails := map[string]string{"requiredScope": "pages:write"}
	err := runResolvedLifecycleBatch(runtime, nil, result, selected, func(
		_ *client,
		_ struct{},
		_ string,
	) (lifecycleActionResult, error) {
		return lifecycleActionResult{}, &cliError{
			Code:       "insufficient_scope",
			Message:    "Token requires pages:write",
			StatusCode: http.StatusForbidden,
			Details:    itemDetails,
		}
	})
	var commandError *cliError
	if !errors.As(err, &commandError) {
		t.Fatalf("unexpected error %v", err)
	}
	batch, ok := commandError.Details.(lifecycleBatchResult)
	if !ok {
		t.Fatalf("unexpected details %#v", commandError.Details)
	}
	item := batch.Items[0]
	if item.Code != "insufficient_scope" || item.StatusCode != http.StatusForbidden {
		t.Fatalf("unexpected structured failure %#v", item)
	}
	if details, ok := item.Details.(map[string]string); !ok || details["requiredScope"] != "pages:write" {
		t.Fatalf("unexpected item details %#v", item.Details)
	}
}

func TestLifecycleBatchMarksUncertainMutationOutcomes(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		code string
	}{
		{
			name: "network failure",
			err:  &cliError{Code: "network_error", Message: "could not reach Metakip"},
			code: "network_error",
		},
		{
			name: "invalid response",
			err:  &cliError{Code: "invalid_response", Message: "invalid response"},
			code: "invalid_response",
		},
		{
			name: "server failure",
			err:  &cliError{Code: "internal_error", Message: "Internal Server Error", StatusCode: 500},
			code: "internal_error",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			runtime := &runtimeState{cli: &CLI{JSON: true}, stdout: &bytes.Buffer{}}
			result := lifecycleBatchResult{Items: make([]lifecycleItemResult, 1)}
			selected := []lifecycleBatchSelection[struct{}]{{
				index: 0, reference: "page", id: "page-id",
			}}
			err := runResolvedLifecycleBatch(runtime, nil, result, selected, func(
				_ *client,
				_ struct{},
				_ string,
			) (lifecycleActionResult, error) {
				return lifecycleActionResult{}, test.err
			})
			var commandError *cliError
			if !errors.As(err, &commandError) {
				t.Fatalf("unexpected error %v", err)
			}
			batch, ok := commandError.Details.(lifecycleBatchResult)
			if !ok {
				t.Fatalf("unexpected details %#v", commandError.Details)
			}
			item := batch.Items[0]
			if item.Status != "outcome_uncertain" || item.Code != test.code {
				t.Fatalf("unexpected uncertain result %#v", item)
			}
			if !strings.Contains(item.Message, "Check the item before retrying") {
				t.Fatalf("missing retry guidance %q", item.Message)
			}
		})
	}
}

func TestSingletonLifecycleMutationsReturnUncertainOutcomes(t *testing.T) {
	for _, test := range []struct {
		name string
		path string
		run  func(*testing.T, *runtimeState) error
	}{
		{
			name: "page create",
			path: "/api/v1/pages",
			run: func(_ *testing.T, runtime *runtimeState) error {
				return (&PageCreateCmd{}).Run(runtime)
			},
		},
		{
			name: "folder create",
			path: "/api/v1/folders",
			run: func(_ *testing.T, runtime *runtimeState) error {
				return (&FolderCreateCmd{}).Run(runtime)
			},
		},
		{
			name: "page import",
			path: "/api/v1/imports/markdown",
			run: func(t *testing.T, runtime *runtimeState) error {
				file := filepath.Join(t.TempDir(), "page.md")
				if err := os.WriteFile(file, []byte("# Page"), 0o600); err != nil {
					t.Fatal(err)
				}
				return (&ImportPageCmd{Path: file}).Run(runtime)
			},
		},
		{
			name: "vault import",
			path: "/api/v1/imports/obsidian",
			run: func(t *testing.T, runtime *runtimeState) error {
				directory := t.TempDir()
				if err := os.WriteFile(filepath.Join(directory, "page.md"), []byte("# Page"), 0o600); err != nil {
					t.Fatal(err)
				}
				return (&ImportFolderCmd{Path: directory, Yes: true}).Run(runtime)
			},
		},
		{
			name: "empty trash",
			path: "/api/v1/trash/empty",
			run: func(_ *testing.T, runtime *runtimeState) error {
				return (&TrashEmptyCmd{Yes: true}).Run(runtime)
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				if request.URL.Path != test.path {
					t.Fatalf("unexpected request %s", request.URL.Path)
				}
				response.WriteHeader(http.StatusInternalServerError)
				fmt.Fprint(response, `{"error":{"code":"internal_error","message":"Internal Server Error"}}`)
			}), false)

			err := test.run(t, runtime)
			var commandError *cliError
			if !errors.As(err, &commandError) || commandError.Code != "outcome_uncertain" {
				t.Fatalf("expected uncertain outcome, got %v", err)
			}
			if !strings.Contains(commandError.Error(), "Check the item before retrying") {
				t.Fatalf("missing retry guidance %q", commandError.Error())
			}
		})
	}
}

func TestDestructiveLifecycleCommandRequiresYesWithoutTerminal(t *testing.T) {
	runtime := &runtimeState{cli: &CLI{}}
	err := confirmLifecycleAction(runtime, false, "Delete?")
	if errorCode(err) != "invalid_arguments" {
		t.Fatalf("expected --yes requirement, got %v", err)
	}
}

func TestFolderResolutionRejectsAmbiguousNameWithoutTerminal(t *testing.T) {
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/folders/resolve" {
			t.Fatalf("unexpected request %s", request.URL.Path)
		}
		fmt.Fprint(response, "{\"data\":[{\"id\":\"5d418de1-6b6f-4bb3-a35c-bc0c134b48dd\",\"name\":\"Folder\",\"folderPath\":\"/One\"},{\"id\":\"4b4d6a4f-4c1f-46c5-82a8-a7c3572d0f63\",\"name\":\"Folder\",\"folderPath\":\"/Two\"}]}")
	}), false)

	_, err := runtime.resolveFolder("Folder")
	if errorCode(err) != "folder_ambiguous" {
		t.Fatalf("expected ambiguous folder error, got %v", err)
	}
}

func TestTrashResolutionRejectsAmbiguousTitleWithoutTerminal(t *testing.T) {
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/trash/pages" {
			t.Fatalf("unexpected request %s", request.URL.Path)
		}
		fmt.Fprint(response, "[{\"id\":\"5d418de1-6b6f-4bb3-a35c-bc0c134b48dd\",\"title\":\"Untitled\"},{\"id\":\"4b4d6a4f-4c1f-46c5-82a8-a7c3572d0f63\",\"title\":\"Untitled\"}]")
	}), false)

	_, err := runtime.resolveTrashedPage("Untitled")
	if errorCode(err) != "page_ambiguous" {
		t.Fatalf("expected ambiguous page error, got %v", err)
	}
}

func TestPageZipExportRequiresOutputFile(t *testing.T) {
	const pageID = "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/pages/" + pageID:
			fmt.Fprintf(response, "{\"id\":%q,\"title\":\"With attachment\"}", pageID)
		case "/api/v1/pages/" + pageID + "/export/markdown":
			response.Header().Set("Content-Type", "application/zip")
			_, _ = response.Write([]byte("zip"))
		default:
			t.Fatalf("unexpected request %s", request.URL.Path)
		}
	}), false)

	err := (&ExportPageCmd{Reference: pageID}).Run(runtime)
	if errorCode(err) != "invalid_arguments" {
		t.Fatalf("expected output requirement, got %v", err)
	}
}

func TestScanImportFolderMatchesVaultExclusions(t *testing.T) {
	root := t.TempDir()
	markdownPath := filepath.Join(root, "notes", "note.MD")
	if err := os.MkdirAll(filepath.Dir(markdownPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(markdownPath, []byte("# Note"), 0o600); err != nil {
		t.Fatal(err)
	}
	obsidianPath := filepath.Join(root, ".obsidian", "hidden.md")
	if err := os.MkdirAll(filepath.Dir(obsidianPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(obsidianPath, []byte("# Hidden"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "diagram.svg"), []byte("<svg />"), 0o600); err != nil {
		t.Fatal(err)
	}

	files, preview, err := scanImportFolder(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 2 || preview.Notes != 1 || preview.Images != 1 || preview.Folders != 1 {
		t.Fatalf("unexpected scan result %#v %#v", files, preview)
	}
	paths := map[string]bool{}
	for _, file := range files {
		paths[file.Path] = true
	}
	if !paths["notes/note.MD"] || !paths["diagram.svg"] || paths[".obsidian/hidden.md"] {
		t.Fatalf("unexpected scanned paths %#v", paths)
	}
}

func TestFolderImportJSONOmitsUnsupportedTagCount(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("# Note"), 0o600); err != nil {
		t.Fatal(err)
	}
	runtime, output := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/imports/obsidian" {
			t.Fatalf("unexpected request %s", request.URL.Path)
		}
		response.Header().Set("Content-Type", "application/json")
		fmt.Fprint(response, `{"foldersCreated":0,"pagesCreated":1,"imagesUploaded":0,"backlinksCreated":0,"errors":[]}`)
	}), true)

	if err := (&ImportFolderCmd{Path: root, Yes: true}).Run(runtime); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(output.Bytes(), []byte("tagsCreated")) {
		t.Fatalf("import output reported an unsupported tag count: %s", output.String())
	}
}

func TestFolderImportStopsWhenPreviewOutputFails(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("# Note"), 0o600); err != nil {
		t.Fatal(err)
	}
	writeErr := errors.New("stdout failed")
	runtime := &runtimeState{
		cli:    &CLI{},
		stdout: failingWriter{err: writeErr},
	}

	err := (&ImportFolderCmd{Path: root, Yes: true}).Run(runtime)
	if !errors.Is(err, writeErr) {
		t.Fatalf("expected preview write error, got %v", err)
	}
}

func TestLifecycleBatchReturnsOutputFailures(t *testing.T) {
	writeErr := errors.New("stdout failed")
	runtime := &runtimeState{
		cli:    &CLI{},
		stdout: failingWriter{err: writeErr},
		stderr: &bytes.Buffer{},
	}

	err := finishLifecycleBatch(runtime, lifecycleBatchResult{Items: []lifecycleItemResult{{
		ID: "page-id", Status: "success",
	}}})
	if !errors.Is(err, writeErr) {
		t.Fatalf("expected lifecycle output error, got %v", err)
	}
}

func TestLifecycleBatchPlainCopyOutputIncludesSourceAndNewIDs(t *testing.T) {
	output := &bytes.Buffer{}
	runtime := &runtimeState{cli: &CLI{}, stdout: output, stderr: &bytes.Buffer{}}

	if err := finishLifecycleBatch(runtime, lifecycleBatchResult{Items: []lifecycleItemResult{{
		SourceID: "source-page",
		ID:       "copied-page",
		Status:   "success",
	}}}); err != nil {
		t.Fatal(err)
	}
	if got := output.String(); got != "source-page\tcopied-page\tsuccess\n" {
		t.Fatalf("unexpected copy output %q", got)
	}
}

func TestFolderLifecycleBatchSkipsSelectedDescendants(t *testing.T) {
	const rootID = "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	const intermediateID = "f33e29e6-8f4e-4e69-9d68-3b8b8734f21d"
	const childID = "4b4d6a4f-4c1f-46c5-82a8-a7c3572d0f63"

	for _, command := range []struct {
		name       string
		method     string
		actionPath string
		run        func(*runtimeState) error
	}{
		{
			name:       "move",
			method:     http.MethodPatch,
			actionPath: "/api/v1/folders/" + rootID,
			run: func(runtime *runtimeState) error {
				return (&FolderMoveCmd{References: []string{rootID, childID}}).Run(runtime)
			},
		},
		{
			name:       "delete",
			method:     http.MethodDelete,
			actionPath: "/api/v1/folders/" + rootID + "/trash",
			run: func(runtime *runtimeState) error {
				return (&FolderDeleteCmd{References: []string{rootID, childID}, Yes: true}).Run(runtime)
			},
		},
		{
			name:       "copy",
			method:     http.MethodPost,
			actionPath: "/api/v1/folders/" + rootID + "/copy",
			run: func(runtime *runtimeState) error {
				return (&FolderCopyCmd{References: []string{rootID, childID}}).Run(runtime)
			},
		},
	} {
		t.Run(command.name, func(t *testing.T) {
			actioned := make([]string, 0, 1)
			runtime, output := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				switch {
				case request.Method == http.MethodGet && request.URL.Path == "/api/v1/folders/"+rootID:
					fmt.Fprintf(response, "{\"id\":%q,\"name\":\"Root\"}", rootID)
				case request.Method == http.MethodGet && request.URL.Path == "/api/v1/folders/"+childID:
					fmt.Fprintf(response, "{\"id\":%q,\"name\":\"Child\",\"parentId\":%q}", childID, intermediateID)
				case request.Method == http.MethodGet && request.URL.Path == "/api/v1/folders/"+intermediateID:
					fmt.Fprintf(response, "{\"id\":%q,\"name\":\"Intermediate\",\"parentId\":%q}", intermediateID, rootID)
				case request.Method == command.method && request.URL.Path == command.actionPath:
					actioned = append(actioned, rootID)
					if command.method == http.MethodPatch {
						var body map[string]json.RawMessage
						if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
							t.Fatal(err)
						}
						if parentID, ok := body["parentId"]; !ok || string(parentID) != "null" {
							t.Fatalf("unexpected move body %s", parentID)
						}
						fmt.Fprintf(response, "{\"id\":%q,\"name\":\"Root\"}", rootID)
					} else if command.method == http.MethodPost {
						fmt.Fprintf(response, "{\"id\":%q,\"skippedRestrictedItems\":false}", rootID)
					}
				default:
					t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
				}
			}), true)

			if err := command.run(runtime); err != nil {
				t.Fatal(err)
			}
			if len(actioned) != 1 || actioned[0] != rootID {
				t.Fatalf("unexpected lifecycle actions %#v", actioned)
			}
			var result lifecycleBatchResult
			if err := json.Unmarshal(output.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if len(result.Items) != 2 || result.Items[0].Status != "success" {
				t.Fatalf("unexpected lifecycle result %#v", result)
			}
			child := result.Items[1]
			if child.ID != childID || child.Status != "skipped" || child.Message != "Included in selected folder "+rootID+"." {
				t.Fatalf("unexpected descendant result %#v", child)
			}
		})
	}
}

func TestFolderLifecycleBatchRunsDescendantAfterDefinitiveAncestorFailure(t *testing.T) {
	const rootID = "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	const childID = "4b4d6a4f-4c1f-46c5-82a8-a7c3572d0f63"
	actioned := make([]string, 0, 2)
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/folders/" + rootID:
			fmt.Fprintf(response, "{\"id\":%q,\"name\":\"Root\"}", rootID)
		case "/api/v1/folders/" + childID:
			fmt.Fprintf(response, "{\"id\":%q,\"name\":\"Child\",\"parentId\":%q}", childID, rootID)
		default:
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
	}), true)

	err := runFolderLifecycleBatch(runtime, []string{childID, rootID}, func(_ *client, folderID string) (lifecycleActionResult, error) {
		actioned = append(actioned, folderID)
		if folderID == rootID {
			return lifecycleActionResult{}, &cliError{Code: "forbidden", Message: "Forbidden", StatusCode: http.StatusForbidden}
		}
		return lifecycleActionResult{}, nil
	})
	var commandError *cliError
	if !errors.As(err, &commandError) || commandError.Code != "lifecycle_partial_failure" {
		t.Fatalf("unexpected error %v", err)
	}
	if got := strings.Join(actioned, ","); got != rootID+","+childID {
		t.Fatalf("unexpected lifecycle actions %q", got)
	}
	result, ok := commandError.Details.(lifecycleBatchResult)
	if !ok || result.Items[0].Status != "success" || result.Items[1].Status != "failed" {
		t.Fatalf("unexpected lifecycle result %#v", commandError.Details)
	}
}

func TestFolderLifecycleBatchBlocksDescendantAfterUncertainAncestorFailure(t *testing.T) {
	const rootID = "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	const childID = "4b4d6a4f-4c1f-46c5-82a8-a7c3572d0f63"
	actioned := make([]string, 0, 1)
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/folders/" + rootID:
			fmt.Fprintf(response, "{\"id\":%q,\"name\":\"Root\"}", rootID)
		case "/api/v1/folders/" + childID:
			fmt.Fprintf(response, "{\"id\":%q,\"name\":\"Child\",\"parentId\":%q}", childID, rootID)
		default:
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
	}), true)

	err := runFolderLifecycleBatch(runtime, []string{rootID, childID}, func(_ *client, folderID string) (lifecycleActionResult, error) {
		actioned = append(actioned, folderID)
		return lifecycleActionResult{}, &cliError{Code: "network_error", Message: "could not reach Metakip"}
	})
	var commandError *cliError
	if !errors.As(err, &commandError) || commandError.Code != "lifecycle_partial_failure" {
		t.Fatalf("unexpected error %v", err)
	}
	if got := strings.Join(actioned, ","); got != rootID {
		t.Fatalf("unexpected lifecycle actions %q", got)
	}
	result, ok := commandError.Details.(lifecycleBatchResult)
	if !ok || result.Items[0].Status != "outcome_uncertain" || result.Items[1].Status != "skipped" {
		t.Fatalf("unexpected lifecycle result %#v", commandError.Details)
	}
	if !strings.Contains(result.Items[1].Message, "Check folder "+rootID+" before retrying.") {
		t.Fatalf("unexpected descendant message %q", result.Items[1].Message)
	}
}

func TestFolderLifecycleBatchContinuesAfterAncestryPreflightFailure(t *testing.T) {
	const childID = "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	const parentID = "4b4d6a4f-4c1f-46c5-82a8-a7c3572d0f63"
	const unavailableAncestorID = "f33e29e6-8f4e-4e69-9d68-3b8b8734f21d"
	const independentID = "bc3e29e6-8f4e-4e69-9d68-3b8b8734f21d"
	actioned := make([]string, 0, 1)
	runtime, _ := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/v1/folders/" + childID:
			fmt.Fprintf(response, "{\"id\":%q,\"name\":\"Child\",\"parentId\":%q}", childID, parentID)
		case "/api/v1/folders/" + parentID:
			fmt.Fprintf(response, "{\"id\":%q,\"name\":\"Parent\",\"parentId\":%q}", parentID, unavailableAncestorID)
		case "/api/v1/folders/" + independentID:
			fmt.Fprintf(response, "{\"id\":%q,\"name\":\"Independent\"}", independentID)
		case "/api/v1/folders/" + unavailableAncestorID:
			response.WriteHeader(http.StatusServiceUnavailable)
			fmt.Fprint(response, `{"error":{"code":"internal_error","message":"Unavailable"}}`)
		default:
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
	}), true)

	err := runFolderLifecycleBatch(runtime, []string{childID, parentID, independentID}, func(_ *client, folderID string) (lifecycleActionResult, error) {
		actioned = append(actioned, folderID)
		return lifecycleActionResult{}, nil
	})
	var commandError *cliError
	if !errors.As(err, &commandError) || commandError.Code != "lifecycle_partial_failure" {
		t.Fatalf("unexpected error %v", err)
	}
	if got := strings.Join(actioned, ","); got != independentID {
		t.Fatalf("unexpected lifecycle actions %q", got)
	}
	result, ok := commandError.Details.(lifecycleBatchResult)
	if !ok || result.Items[0].Status != "failed" || result.Items[1].Status != "failed" || result.Items[2].Status != "success" {
		t.Fatalf("unexpected lifecycle result %#v", commandError.Details)
	}
	if !strings.Contains(result.Items[0].Message, "selected folder's ancestry could not be resolved for folder "+parentID) {
		t.Fatalf("unexpected descendant result %#v", result.Items[0])
	}
	if !strings.Contains(result.Items[1].Message, "resolve selected folder ancestry") {
		t.Fatalf("unexpected ancestor result %#v", result.Items[1])
	}
}

func TestPageLifecycleBatchSkipsDuplicateReferences(t *testing.T) {
	const pageID = "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"

	for _, command := range []struct {
		name   string
		method string
		path   string
		run    func(*runtimeState) error
	}{
		{
			name:   "move",
			method: http.MethodPatch,
			path:   "/api/v1/pages/" + pageID + "/move",
			run: func(runtime *runtimeState) error {
				return (&PageMoveCmd{References: []string{pageID, pageID}}).Run(runtime)
			},
		},
		{
			name:   "copy",
			method: http.MethodPost,
			path:   "/api/v1/pages/" + pageID + "/copy",
			run: func(runtime *runtimeState) error {
				return (&PageCopyCmd{References: []string{pageID, pageID}}).Run(runtime)
			},
		},
		{
			name:   "delete",
			method: http.MethodDelete,
			path:   "/api/v1/pages/" + pageID + "/trash",
			run: func(runtime *runtimeState) error {
				return (&PageDeleteCmd{References: []string{pageID, pageID}, Yes: true}).Run(runtime)
			},
		},
	} {
		t.Run(command.name, func(t *testing.T) {
			resolutions := 0
			actions := 0
			runtime, output := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				switch {
				case request.Method == http.MethodGet && request.URL.Path == "/api/v1/pages/"+pageID:
					resolutions++
					fmt.Fprintf(response, "{\"id\":%q,\"title\":\"Page\"}", pageID)
				case request.Method == command.method && request.URL.Path == command.path:
					actions++
					if command.method == http.MethodPost {
						fmt.Fprint(response, `{"id":"copied-page"}`)
					} else if command.method == http.MethodPatch {
						fmt.Fprintf(response, "{\"id\":%q}", pageID)
					}
				default:
					t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
				}
			}), true)

			if err := command.run(runtime); err != nil {
				t.Fatal(err)
			}
			if resolutions != 1 || actions != 1 {
				t.Fatalf("expected one resolution and action, got %d resolutions and %d actions", resolutions, actions)
			}
			var result lifecycleBatchResult
			if err := json.Unmarshal(output.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if len(result.Items) != 2 || result.Items[0].Status != "success" {
				t.Fatalf("unexpected lifecycle result %#v", result)
			}
			if item := result.Items[1]; item.ID != pageID || item.Status != "skipped" || item.Message != "Duplicate selection; included once." {
				t.Fatalf("unexpected duplicate result %#v", item)
			}
		})
	}
}

func TestTrashLifecycleBatchUsesOneSnapshotAndSkipsDuplicates(t *testing.T) {
	const pageID = "5d418de1-6b6f-4bb3-a35c-bc0c134b48dd"
	snapshots := 0
	actions := 0
	runtime, output := testRuntime(t, http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/api/v1/trash/pages":
			snapshots++
			fmt.Fprintf(response, "[{\"id\":%q,\"title\":\"Trashed\"}]", pageID)
		case request.Method == http.MethodPatch && request.URL.Path == "/api/v1/pages/"+pageID+"/restore":
			actions++
		default:
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.Path)
		}
	}), true)

	if err := (&TrashRestoreCmd{EntityType: "page", References: []string{pageID, pageID}}).Run(runtime); err != nil {
		t.Fatal(err)
	}
	if snapshots != 1 || actions != 1 {
		t.Fatalf("expected one snapshot and action, got %d snapshots and %d actions", snapshots, actions)
	}
	var result lifecycleBatchResult
	if err := json.Unmarshal(output.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if len(result.Items) != 2 || result.Items[0].Status != "success" {
		t.Fatalf("unexpected lifecycle result %#v", result)
	}
	if item := result.Items[1]; item.ID != pageID || item.Status != "skipped" || item.Message != "Duplicate selection; included once." {
		t.Fatalf("unexpected duplicate result %#v", item)
	}
}
