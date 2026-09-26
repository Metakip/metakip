package main

import (
	"context"
	"fmt"
	"net/http"
	"strings"
)

type PageListCmd struct {
	Parent string `help:"Only list pages directly inside this folder ID." placeholder:"FOLDER_ID"`
	Limit  int    `help:"Maximum number of pages to return; 0 returns all pages." default:"0"`
}

type PageSearchCmd struct {
	Query string `arg:"" name:"query" help:"Text to search for in page titles."`
}

type PageViewCmd struct {
	Reference string `arg:"" name:"page" help:"Page ID or exact title."`
	Raw       bool   `help:"Print page Markdown without terminal rendering."`
}

type PageCreateCmd struct {
	Title       string `help:"Page title; defaults to Untitled." placeholder:"TITLE"`
	Parent      string `help:"Parent folder ID." placeholder:"FOLDER_ID"`
	Icon        string `help:"Set the page icon." placeholder:"ICON"`
	ContentFile string `name:"content-file" short:"f" help:"Read initial Markdown from a file, or - for stdin." placeholder:"FILE"`
}

type PageEditCmd struct {
	Append      PageEditAppendCmd      `cmd:"" help:"Append Markdown after one blank line."`
	Exact       PageEditExactCmd       `cmd:"" help:"Apply an exact Markdown edit."`
	Interactive PageEditInteractiveCmd `cmd:"" default:"withargs" help:"Open a page in the configured editor."`
	Prepend     PageEditPrependCmd     `cmd:"" help:"Prepend Markdown before one blank line."`
	Replace     PageEditReplaceCmd     `cmd:"" help:"Replace all page Markdown safely."`
}

type PageEditInteractiveCmd struct {
	Reference string `arg:"" name:"page" help:"Page ID or exact title."`
	Editor    string `help:"Use this editor command instead of configured editor variables." placeholder:"COMMAND"`
}

type PageEditExactCmd struct {
	Reference      string  `arg:"" name:"page" help:"Page ID or exact title."`
	OldText        *string `help:"Exact current passage to replace." placeholder:"TEXT"`
	NewText        *string `help:"Replacement text; an empty value deletes the passage." placeholder:"TEXT"`
	OldFile        string  `help:"File containing the exact current passage, or - for stdin." placeholder:"FILE"`
	NewFile        string  `help:"File containing replacement text; an empty file deletes the passage." placeholder:"FILE"`
	ExpectEmpty    bool    `help:"Require the page Markdown to be empty before writing the replacement."`
	EditID         string  `name:"id" help:"Caller-defined edit identifier." placeholder:"ID"`
	IdempotencyKey string  `help:"Safe-retry key for this request." placeholder:"KEY"`
}

type PageEditReplaceCmd struct {
	Reference   string  `arg:"" name:"page" help:"Page ID or exact title."`
	ContentText *string `help:"Replacement Markdown; an empty value clears the page." placeholder:"TEXT"`
	ContentFile string  `help:"File containing replacement Markdown, or - for stdin." placeholder:"FILE"`
}

type PageEditAppendCmd struct {
	Reference      string  `arg:"" name:"page" help:"Page ID or exact title."`
	ContentText    *string `help:"Markdown to append." placeholder:"TEXT"`
	ContentFile    string  `help:"File containing Markdown to append, or - for stdin." placeholder:"FILE"`
	EditID         string  `name:"id" help:"Caller-defined edit identifier." placeholder:"ID"`
	IdempotencyKey string  `help:"Safe-retry key for this request." placeholder:"KEY"`
}

type PageEditPrependCmd struct {
	Reference      string  `arg:"" name:"page" help:"Page ID or exact title."`
	ContentText    *string `help:"Markdown to prepend." placeholder:"TEXT"`
	ContentFile    string  `help:"File containing Markdown to prepend, or - for stdin." placeholder:"FILE"`
	EditID         string  `name:"id" help:"Caller-defined edit identifier." placeholder:"ID"`
	IdempotencyKey string  `help:"Safe-retry key for this request." placeholder:"KEY"`
}

type PageUpdateCmd struct {
	Reference string `arg:"" name:"page" help:"Page ID or exact title."`
	Title     string `help:"Set the page title." placeholder:"TITLE"`
	Icon      string `help:"Set the page icon." placeholder:"ICON"`
	ClearIcon bool   `help:"Remove the page icon."`
}

type PageMoveCmd struct {
	References []string `arg:"" required:"" name:"pages" help:"Page IDs or exact titles."`
	Parent     string   `help:"Destination folder ID; omit for workspace root." placeholder:"FOLDER_ID"`
}

type PageCopyCmd struct {
	References []string `arg:"" required:"" name:"pages" help:"Page IDs or exact titles."`
	Parent     string   `help:"Destination folder ID; omit for workspace root." placeholder:"FOLDER_ID"`
}

type PageDeleteCmd struct {
	References []string `arg:"" required:"" name:"pages" help:"Page IDs or exact titles."`
	Yes        bool     `short:"y" help:"Skip the Trash confirmation."`
}

type uncertainEditDetails struct {
	IdempotencyKey string `json:"idempotencyKey,omitempty"`
	EditID         string `json:"editId,omitempty"`
}

func (cmd *PageListCmd) Run(r *runtimeState) error {
	if cmd.Limit < 0 || cmd.Limit > 10000 {
		return usageError("The --limit value must be between 0 and 10000.")
	}
	if cmd.Parent != "" && !isUUID(cmd.Parent) {
		return usageError("The --parent value must be a folder UUID.")
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(r.ctx)
	defer cancel()
	requestClient := *c
	requestClient.ctx = ctx
	type pageResult struct {
		pages []page
		err   error
	}
	type folderResult struct {
		folders []folder
		err     error
	}
	pagesDone := make(chan pageResult, 1)
	foldersDone := make(chan folderResult, 1)
	go func() {
		pages, listErr := requestClient.listPages(cmd.Parent, cmd.Limit)
		pagesDone <- pageResult{pages: pages, err: listErr}
	}()
	go func() {
		folders, listErr := listFolders(&requestClient)
		foldersDone <- folderResult{folders: folders, err: listErr}
	}()

	var pages []page
	var folders []folder
	for pagesDone != nil || foldersDone != nil {
		select {
		case result := <-pagesDone:
			pagesDone = nil
			if result.err != nil {
				cancel()
				return result.err
			}
			pages = result.pages
		case result := <-foldersDone:
			foldersDone = nil
			if result.err != nil {
				cancel()
				return result.err
			}
			folders = result.folders
		}
	}
	paths := folderPaths(folders)
	items := make([]pageListItem, 0, len(pages))
	for _, item := range pages {
		folderPath := "/"
		if item.ParentID != nil && paths[*item.ParentID] != "" {
			folderPath = "/" + paths[*item.ParentID]
		}
		items = append(items, pageListItem{page: item, FolderPath: folderPath})
	}
	return renderPageList(r, items)
}

func (cmd *PageSearchCmd) Run(r *runtimeState) error {
	query := strings.TrimSpace(cmd.Query)
	if query == "" {
		return usageError("A search query is required.")
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	results, err := c.searchPages(query)
	if err != nil {
		return err
	}
	items := make([]pageListItem, 0, len(results))
	for _, result := range results {
		items = append(items, pageListItem{page: result.page, FolderPath: result.FolderPath})
	}
	return renderPageListWithEmptyMessage(r, items, "No matching pages found.")
}

func (cmd *PageViewCmd) Run(r *runtimeState) error {
	selected, err := r.resolvePage(cmd.Reference)
	if err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	content, etag, err := c.getPageContent(selected.ID)
	if err != nil {
		return err
	}
	return renderPageView(r, selected, content, etag, cmd.Raw)
}

func (cmd *PageCreateCmd) Run(r *runtimeState) error {
	if cmd.Parent != "" && !isUUID(cmd.Parent) {
		return usageError("The --parent value must be a folder UUID.")
	}
	request := createPageRequest{}
	if cmd.Title != "" {
		request.Title = &cmd.Title
	}
	if cmd.Parent != "" {
		request.ParentID = &cmd.Parent
	}
	if cmd.Icon != "" {
		request.Icon = &cmd.Icon
	}
	if cmd.ContentFile != "" {
		content, err := readContentFile(cmd.ContentFile, r.stdin)
		if err != nil {
			return err
		}
		markdown := string(content)
		request.Markdown = &markdown
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	created, err := c.createPage(request)
	if err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	if r.cli.JSON {
		return r.printJSON(created)
	}
	_, err = fmt.Fprintf(
		r.stdout,
		"Created %s  %s\n",
		terminalText(created.Title),
		r.style(dimStyle, terminalText(created.ID)),
	)
	return err
}

func (cmd *PageEditInteractiveCmd) Run(r *runtimeState) error {
	selected, err := r.resolvePage(cmd.Reference)
	if err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	content, etag, err := c.getPageContent(selected.ID)
	if err != nil {
		return err
	}
	updated, changed, err := editPageInEditor(r, selected.Title, content, cmd.Editor)
	if err != nil {
		return err
	}
	if !changed {
		if r.cli.JSON {
			return r.printJSON(pageEditResult{Changed: false, Page: selected})
		}
		_, err = fmt.Fprintln(r.stdout, "No changes.")
		return err
	}
	updatedEtag, err := c.replacePageContent(selected.ID, updated, etag)
	if err != nil {
		return err
	}
	if r.cli.JSON {
		return r.printJSON(pageEditResult{Changed: true, Page: selected, ETag: updatedEtag})
	}
	_, err = fmt.Fprintf(r.stdout, "Saved %s\n", terminalText(selected.Title))
	return err
}

func updatePage(r *runtimeState, reference string, request updatePageRequest) (page, error) {
	selected, err := r.resolvePage(reference)
	if err != nil {
		return page{}, err
	}
	c, err := r.client()
	if err != nil {
		return page{}, err
	}
	return c.updatePage(selected.ID, request)
}

func (cmd *PageUpdateCmd) Run(r *runtimeState) error {
	if cmd.Title == "" && cmd.Icon == "" && !cmd.ClearIcon {
		return usageError("Provide --title, --icon, or --clear-icon.")
	}
	if cmd.Icon != "" && cmd.ClearIcon {
		return usageError("The --icon and --clear-icon options cannot be used together.")
	}
	request := updatePageRequest{}
	if cmd.Title != "" {
		request.Title = &cmd.Title
	}
	if cmd.Icon != "" {
		request.Icon = &cmd.Icon
	} else if cmd.ClearIcon {
		request.ClearIcon = true
	}
	updated, err := updatePage(r, cmd.Reference, request)
	if err != nil {
		return err
	}
	if r.cli.JSON {
		return r.printJSON(updated)
	}
	_, err = fmt.Fprintf(
		r.stdout,
		"Updated %s  %s\n",
		terminalText(updated.Title),
		r.style(dimStyle, terminalText(updated.ID)),
	)
	return err
}

func pageDestination(parent string) (*string, error) {
	if parent != "" && !isUUID(parent) {
		return nil, usageError("The --parent value must be a folder UUID.")
	}
	if parent == "" {
		return nil, nil
	}
	return &parent, nil
}

func (cmd *PageMoveCmd) Run(r *runtimeState) error {
	parent, err := pageDestination(cmd.Parent)
	if err != nil {
		return err
	}
	return runPageLifecycleBatch(r, cmd.References, func(c *client, pageID string) error {
		_, moveErr := c.movePage(pageID, parent)
		return moveErr
	})
}

func (cmd *PageCopyCmd) Run(r *runtimeState) error {
	parent, err := pageDestination(cmd.Parent)
	if err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	result, selected := resolveLifecycleBatch(cmd.References, r.resolvePage, func(item page) string {
		return item.ID
	})
	return runResolvedLifecycleBatch(r, c, result, selected, func(c *client, item page, id string) (lifecycleActionResult, error) {
		copied, copyErr := c.copyPage(id, parent)
		if copyErr != nil {
			return lifecycleActionResult{SourceID: id}, copyErr
		}
		return lifecycleActionResult{ID: copied.ID, SourceID: id}, nil
	})
}

func (cmd *PageDeleteCmd) Run(r *runtimeState) error {
	if err := confirmLifecycleAction(r, cmd.Yes, "Move selected pages to Trash?"); err != nil {
		return err
	}
	return runPageLifecycleBatch(r, cmd.References, func(c *client, pageID string) error {
		return c.trashPage(pageID)
	})
}

func (cmd *PageEditExactCmd) Run(r *runtimeState) error {
	if cmd.OldFile == "-" && cmd.NewFile == "-" {
		return usageError("Only one replacement file may read from stdin.")
	}
	var oldText []byte
	var err error
	if cmd.ExpectEmpty {
		if cmd.OldText != nil || cmd.OldFile != "" {
			return usageError("The --expect-empty option cannot be used with --old-text or --old-file.")
		}
	} else {
		oldText, err = replacementInput(cmd.OldText, cmd.OldFile, r.stdin, "old")
		if err != nil {
			return err
		}
		if len(oldText) == 0 {
			return usageError("Empty old content requires --expect-empty.")
		}
	}
	newText, err := replacementInput(cmd.NewText, cmd.NewFile, r.stdin, "new")
	if err != nil {
		return err
	}
	selected, err := r.resolvePage(cmd.Reference)
	if err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	result, editID, err := applyExactPageEdit(c, selected.ID, exactEdit{
		OldText: string(oldText), NewText: string(newText),
	}, cmd.EditID, cmd.IdempotencyKey)
	if err != nil {
		return err
	}
	if r.cli.JSON {
		return r.printJSON(result)
	}
	_, err = fmt.Fprintf(r.stdout, "Applied exact edit %s\n", terminalText(editID))
	return err
}

func (cmd *PageEditReplaceCmd) Run(r *runtimeState) error {
	content, err := replacementInput(cmd.ContentText, cmd.ContentFile, r.stdin, "content")
	if err != nil {
		return err
	}
	selected, err := r.resolvePage(cmd.Reference)
	if err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	_, etag, err := c.getPageContent(selected.ID)
	if err != nil {
		return err
	}
	updatedETag, err := c.replacePageContent(selected.ID, content, etag)
	if err != nil {
		return uncertainWriteOutcome(err, "", "")
	}
	if r.cli.JSON {
		return r.printJSON(pageEditResult{Changed: true, Page: selected, ETag: updatedETag})
	}
	_, err = fmt.Fprintf(r.stdout, "Replaced %s\n", terminalText(selected.Title))
	return err
}

func (cmd *PageEditAppendCmd) Run(r *runtimeState) error {
	return runContentBoundaryOperation(
		r,
		cmd.Reference,
		cmd.ContentText,
		cmd.ContentFile,
		cmd.EditID,
		cmd.IdempotencyKey,
		"append",
		"Appended",
	)
}

func (cmd *PageEditPrependCmd) Run(r *runtimeState) error {
	return runContentBoundaryOperation(
		r,
		cmd.Reference,
		cmd.ContentText,
		cmd.ContentFile,
		cmd.EditID,
		cmd.IdempotencyKey,
		"prepend",
		"Prepended",
	)
}

func runContentBoundaryOperation(
	r *runtimeState,
	reference string,
	contentText *string,
	contentFile string,
	editID string,
	idempotencyKey string,
	operation string,
	label string,
) error {
	content, err := replacementInput(contentText, contentFile, r.stdin, "content")
	if err != nil {
		return err
	}
	if len(content) == 0 {
		return usageError("The --content-text or --content-file value must not be empty for %s.", operation)
	}
	selected, err := r.resolvePage(reference)
	if err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	result, err := applyContentBoundaryOperation(c, selected.ID, contentBoundaryOperation{
		Operation: operation,
		Content:   string(content),
	}, editID, idempotencyKey)
	if err != nil {
		return err
	}
	if r.cli.JSON {
		return r.printJSON(result)
	}
	_, err = fmt.Fprintf(r.stdout, "%s %s\n", label, terminalText(selected.Title))
	return err
}

func applyExactPageEdit(
	c *client,
	pageID string,
	edit exactEdit,
	requestedEditID string,
	requestedIdempotencyKey string,
) (editResponse, string, error) {
	editID := requestedEditID
	if editID == "" {
		generatedID, err := randomRequestID()
		if err != nil {
			return editResponse{}, "", err
		}
		editID = generatedID
	}
	idempotencyKey := requestedIdempotencyKey
	if idempotencyKey == "" {
		generatedKey, err := randomRequestID()
		if err != nil {
			return editResponse{}, "", err
		}
		idempotencyKey = generatedKey
	}
	edit.ID = editID
	result, err := c.applyPageExactEdit(pageID, edit, idempotencyKey)
	if err != nil {
		return editResponse{}, "", uncertainWriteOutcome(err, editID, idempotencyKey)
	}
	if len(result.Results) != 1 || result.Results[0].Status != "applied" {
		reason := "edit was not applied"
		if len(result.Results) == 1 && result.Results[0].Reason != "" {
			reason = result.Results[0].Reason
		}
		return editResponse{}, "", &cliError{Code: "edit_conflict", Message: reason, StatusCode: http.StatusConflict, Details: result}
	}
	return result, editID, nil
}

func applyContentBoundaryOperation(
	c *client,
	pageID string,
	operation contentBoundaryOperation,
	requestedID string,
	requestedIdempotencyKey string,
) (contentBoundaryOperationResponse, error) {
	operation.ID = requestedID
	if operation.ID == "" {
		generatedID, err := randomRequestID()
		if err != nil {
			return contentBoundaryOperationResponse{}, err
		}
		operation.ID = generatedID
	}
	idempotencyKey := requestedIdempotencyKey
	if idempotencyKey == "" {
		generatedKey, err := randomRequestID()
		if err != nil {
			return contentBoundaryOperationResponse{}, err
		}
		idempotencyKey = generatedKey
	}
	result, err := c.applyPageContentBoundaryOperation(pageID, operation, idempotencyKey)
	if err != nil {
		return contentBoundaryOperationResponse{}, uncertainWriteOutcome(err, operation.ID, idempotencyKey)
	}
	return result, nil
}

func uncertainWriteOutcome(err error, editID string, idempotencyKey string) error {
	if errorCode(err) == "collaboration_busy" {
		return err
	}
	return uncertainMutationOutcome(
		err,
		editID,
		idempotencyKey,
		"edit_outcome_uncertain",
		"The edit may have succeeded. Check the page before issuing another edit",
	)
}

func uncertainMutationOutcome(
	err error,
	editID string,
	idempotencyKey string,
	code string,
	message string,
) error {
	if mutationOutcomeUncertain(err) {
		details := &uncertainEditDetails{IdempotencyKey: idempotencyKey, EditID: editID}
		detailLines := make([]string, 0, 2)
		if details.EditID != "" {
			detailLines = append(detailLines, "Edit ID: "+details.EditID)
		}
		if details.IdempotencyKey != "" {
			detailLines = append(detailLines, "Idempotency key: "+details.IdempotencyKey)
		}
		return &cliError{
			Code:             code,
			Message:          message,
			Details:          details,
			Cause:            err,
			Presentation:     cliErrorPresentation{HumanDetailLines: detailLines},
			OutcomeUncertain: true,
		}
	}
	return err
}
