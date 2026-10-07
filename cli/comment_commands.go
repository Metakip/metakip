package main

import (
	"fmt"
	"strings"
)

type PageCommentsCmd struct {
	Add     PageCommentAddCmd    `cmd:"" help:"Start a comment thread on selected page text."`
	Delete  PageCommentDeleteCmd `cmd:"" help:"Delete one of your comments, or a comment you can moderate."`
	Edit    PageCommentEditCmd   `cmd:"" help:"Edit one of your comments."`
	List    PageCommentListCmd   `cmd:"" help:"List comment threads on a page."`
	Reopen  PageCommentReopenCmd `cmd:"" help:"Reopen a comment thread."`
	Reply   PageCommentReplyCmd  `cmd:"" help:"Reply in a linear comment thread."`
	Resolve PageCommentStatusCmd `cmd:"" help:"Resolve a comment thread."`
}

type PageCommentListCmd struct {
	Reference string `arg:"" name:"page" help:"Page UUID; page titles aren't supported."`
	Status    string `help:"Filter by thread status." default:"open" enum:"open,resolved,all"`
}

type PageCommentAddCmd struct {
	Reference string  `arg:"" name:"page" help:"Page UUID; page titles aren't supported."`
	Body      string  `help:"Comment text." placeholder:"TEXT"`
	Quote     string  `required:"" help:"Exact selected text to anchor the thread to; select all page text to comment on the page as a whole." placeholder:"TEXT"`
	Prefix    *string `help:"Text immediately before the selected quote to disambiguate it." placeholder:"TEXT"`
	Suffix    *string `help:"Text immediately after the selected quote to disambiguate it." placeholder:"TEXT"`
}

type PageCommentReplyCmd struct {
	Reference string `arg:"" name:"page" help:"Page UUID; page titles aren't supported."`
	ThreadID  string `arg:"" name:"thread-id" help:"Comment thread UUID."`
	Body      string `help:"Reply text." placeholder:"TEXT"`
}

type PageCommentEditCmd struct {
	Reference string `arg:"" name:"page" help:"Page UUID; page titles aren't supported."`
	CommentID string `arg:"" name:"comment-id" help:"Comment UUID."`
	Body      string `help:"Replacement comment text." placeholder:"TEXT"`
}

type PageCommentDeleteCmd struct {
	Reference string `arg:"" name:"page" help:"Page UUID; page titles aren't supported."`
	CommentID string `arg:"" name:"comment-id" help:"Comment UUID."`
}

type PageCommentStatusCmd struct {
	Reference string `arg:"" name:"page" help:"Page UUID; page titles aren't supported."`
	ThreadID  string `arg:"" name:"thread-id" help:"Comment thread UUID."`
}

type PageCommentReopenCmd PageCommentStatusCmd

func (cmd *PageCommentListCmd) Run(r *runtimeState) error {
	selected, c, err := resolveCommentPage(r, cmd.Reference)
	if err != nil {
		return err
	}
	threads := make([]pageCommentThread, 0)
	cursor := ""
	for {
		response, requestErr := c.listPageComments(selected.ID, cmd.Status, cursor, 100)
		if requestErr != nil {
			return requestErr
		}
		threads = append(threads, response.Data...)
		if response.NextCursor == nil || *response.NextCursor == "" {
			break
		}
		cursor = *response.NextCursor
	}
	if r.cli.JSON {
		return r.printJSON(pageCommentThreadsResponse{Data: threads})
	}
	if len(threads) == 0 {
		_, err = fmt.Fprintf(r.stdout, "No %s comment threads on %s.\n", cmd.Status, terminalText(selected.Title))
		return err
	}
	for index, thread := range threads {
		if index > 0 {
			if _, err := fmt.Fprintln(r.stdout); err != nil {
				return err
			}
		}
		if err := renderPageCommentThread(r, thread); err != nil {
			return err
		}
	}
	return nil
}
func (cmd *PageCommentAddCmd) Run(r *runtimeState) error {
	if strings.TrimSpace(cmd.Body) == "" {
		return usageError("Comment text is required.")
	}
	if strings.TrimSpace(cmd.Quote) == "" {
		return usageError("Exact selected text is required with --quote.")
	}
	request := pageCommentRequest{
		Body:   cmd.Body,
		Anchor: commentAnchor{Quote: cmd.Quote, Prefix: cmd.Prefix, Suffix: cmd.Suffix},
	}
	selected, c, err := resolveCommentPage(r, cmd.Reference)
	if err != nil {
		return err
	}
	thread, err := c.createPageComment(selected.ID, request)
	return renderCommentMutation(r, thread, err)
}

func (cmd *PageCommentReplyCmd) Run(r *runtimeState) error {
	if !isUUID(cmd.ThreadID) {
		return usageError("The thread ID must be a UUID.")
	}
	if strings.TrimSpace(cmd.Body) == "" {
		return usageError("Reply text is required.")
	}
	selected, c, err := resolveCommentPage(r, cmd.Reference)
	if err != nil {
		return err
	}
	thread, err := c.replyPageComment(selected.ID, cmd.ThreadID, cmd.Body)
	return renderCommentMutation(r, thread, err)
}

func (cmd *PageCommentEditCmd) Run(r *runtimeState) error {
	if !isUUID(cmd.CommentID) {
		return usageError("The comment ID must be a UUID.")
	}
	if strings.TrimSpace(cmd.Body) == "" {
		return usageError("Comment text is required.")
	}
	selected, c, err := resolveCommentPage(r, cmd.Reference)
	if err != nil {
		return err
	}
	thread, err := c.updatePageComment(selected.ID, cmd.CommentID, cmd.Body)
	return renderCommentMutation(r, thread, err)
}

func (cmd *PageCommentDeleteCmd) Run(r *runtimeState) error {
	if !isUUID(cmd.CommentID) {
		return usageError("The comment ID must be a UUID.")
	}
	selected, c, err := resolveCommentPage(r, cmd.Reference)
	if err != nil {
		return err
	}
	thread, err := c.deletePageComment(selected.ID, cmd.CommentID)
	return renderCommentMutation(r, thread, err)
}

func (cmd *PageCommentStatusCmd) Run(r *runtimeState) error {
	return runPageCommentStatus(r, cmd.Reference, cmd.ThreadID, "resolved")
}

func (cmd *PageCommentReopenCmd) Run(r *runtimeState) error {
	return runPageCommentStatus(r, cmd.Reference, cmd.ThreadID, "open")
}

func runPageCommentStatus(r *runtimeState, reference, threadID, status string) error {
	if !isUUID(threadID) {
		return usageError("The thread ID must be a UUID.")
	}
	selected, c, err := resolveCommentPage(r, reference)
	if err != nil {
		return err
	}
	thread, err := c.setPageCommentThreadStatus(selected.ID, threadID, status)
	return renderCommentMutation(r, thread, err)
}

func resolveCommentPage(r *runtimeState, reference string) (page, *client, error) {
	if !isUUID(reference) {
		return page{}, nil, usageError("Comment commands require a page UUID so comment-only tokens do not need page-read access.")
	}
	c, err := r.client()
	if err != nil {
		return page{}, nil, err
	}
	return page{ID: reference, Title: reference}, c, nil
}

func renderCommentMutation(r *runtimeState, thread pageCommentThread, err error) error {
	if err != nil {
		return err
	}
	if r.cli.JSON {
		return r.printJSON(pageCommentThreadResponse{Thread: thread})
	}
	return renderPageCommentThread(r, thread)
}

func renderPageCommentThread(r *runtimeState, thread pageCommentThread) error {
	quote := []rune(thread.Anchor.Quote)
	if len(quote) > 120 {
		quote = append(quote[:117], '…')
	}
	label := fmt.Sprintf("Selection: %q", string(quote))
	if _, err := fmt.Fprintf(r.stdout, "%s · %s · %s\n", terminalText(label), terminalText(thread.Status), terminalText(thread.ID)); err != nil {
		return err
	}
	for _, comment := range thread.Comments {
		author := "Former user"
		if comment.AuthorName != nil && strings.TrimSpace(*comment.AuthorName) != "" {
			author = *comment.AuthorName
		}
		body := "[deleted]"
		if comment.Body != nil {
			body = *comment.Body
		}
		if _, err := fmt.Fprintf(r.stdout, "  %s (%s): %s\n", terminalText(author), terminalText(comment.CreatedAt), terminalText(body)); err != nil {
			return err
		}
	}
	return nil
}
