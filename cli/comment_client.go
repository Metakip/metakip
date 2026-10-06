package main

import (
	"fmt"
	"net/http"
	"net/url"
)

type commentAnchor struct {
	Quote  string  `json:"quote"`
	Prefix *string `json:"prefix,omitempty"`
	Suffix *string `json:"suffix,omitempty"`
}

type pageComment struct {
	ID         string  `json:"id"`
	ThreadID   string  `json:"threadId"`
	AuthorID   *string `json:"authorId"`
	AuthorName *string `json:"authorName"`
	Body       *string `json:"body"`
	CreatedAt  string  `json:"createdAt"`
	UpdatedAt  string  `json:"updatedAt"`
	DeletedAt  *string `json:"deletedAt"`
}

type pageCommentThread struct {
	ID         string        `json:"id"`
	PageID     string        `json:"pageId"`
	Anchor     commentAnchor `json:"anchor"`
	Status     string        `json:"status"`
	CreatedBy  *string       `json:"createdBy"`
	CreatedAt  string        `json:"createdAt"`
	UpdatedAt  string        `json:"updatedAt"`
	ResolvedBy *string       `json:"resolvedBy"`
	ResolvedAt *string       `json:"resolvedAt"`
	Comments   []pageComment `json:"comments"`
}

type pageCommentThreadResponse struct {
	Thread pageCommentThread `json:"thread"`
}

type pageCommentThreadsResponse struct {
	Data       []pageCommentThread `json:"data"`
	NextCursor *string             `json:"nextCursor"`
}

type pageCommentRequest struct {
	Body   string        `json:"body"`
	Anchor commentAnchor `json:"anchor"`
}

type commentThreadStatusRequest struct {
	Status string `json:"status"`
}

func (c *client) listPageComments(pageID, status, cursor string, limit int) (pageCommentThreadsResponse, error) {
	path := fmt.Sprintf("/pages/%s/comments?status=%s&limit=%d", url.PathEscape(pageID), url.QueryEscape(status), limit)
	if cursor != "" {
		path += "&cursor=" + url.QueryEscape(cursor)
	}
	response, err := c.request(http.MethodGet, path, nil, nil)
	if err != nil {
		return pageCommentThreadsResponse{}, err
	}
	var result pageCommentThreadsResponse
	return result, decodeJSON(response, &result)
}

func (c *client) createPageComment(pageID string, request pageCommentRequest) (pageCommentThread, error) {
	return c.mutatePageComment(pageID, "", http.MethodPost, request)
}

func (c *client) replyPageComment(pageID, threadID, body string) (pageCommentThread, error) {
	return c.mutatePageComment(pageID, "/"+url.PathEscape(threadID)+"/replies", http.MethodPost, struct {
		Body string `json:"body"`
	}{Body: body})
}

func (c *client) updatePageComment(pageID, commentID, body string) (pageCommentThread, error) {
	return c.mutatePageComment(pageID, "/"+url.PathEscape(commentID), http.MethodPatch, struct {
		Body string `json:"body"`
	}{Body: body})
}

func (c *client) deletePageComment(pageID, commentID string) (pageCommentThread, error) {
	return c.mutatePageComment(pageID, "/"+url.PathEscape(commentID), http.MethodDelete, nil)
}

func (c *client) setPageCommentThreadStatus(pageID, threadID, status string) (pageCommentThread, error) {
	return c.mutatePageComment(pageID, "/"+url.PathEscape(threadID)+"/status", http.MethodPatch, commentThreadStatusRequest{Status: status})
}

func (c *client) mutatePageComment(pageID, suffix, method string, request any) (pageCommentThread, error) {
	var body []byte
	var err error
	if request != nil {
		body, err = marshalBody(request)
		if err != nil {
			return pageCommentThread{}, err
		}
	}
	headers := map[string]string(nil)
	if request != nil {
		headers = map[string]string{"Content-Type": "application/json"}
	}
	path := "/pages/" + url.PathEscape(pageID) + "/comments" + suffix
	response, err := c.request(method, path, body, headers)
	if err != nil {
		return pageCommentThread{}, err
	}
	var result pageCommentThreadResponse
	err = decodeJSON(response, &result)
	return result.Thread, err
}
