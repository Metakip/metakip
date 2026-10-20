package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
)

func (c *client) listPages(parentID string, limit int) ([]page, error) {
	if limit < 0 {
		return nil, usageError("Limit cannot be negative.")
	}
	capacity := 100
	if limit > 0 {
		capacity = min(limit, 100)
	}
	pages := make([]page, 0, capacity)
	cursor := ""
	for limit == 0 || len(pages) < limit {
		requestLimit := 100
		if limit > 0 {
			requestLimit = min(100, limit-len(pages))
		}
		path := fmt.Sprintf("/pages?limit=%d", requestLimit)
		if parentID != "" {
			path += "&parentId=" + url.QueryEscape(parentID)
		}
		if cursor != "" {
			path += "&cursor=" + url.QueryEscape(cursor)
		}
		response, err := c.request(http.MethodGet, path, nil, nil)
		if err != nil {
			return nil, err
		}
		var result pageList
		if err := decodeJSON(response, &result); err != nil {
			return nil, err
		}
		pages = append(pages, result.Data...)
		if result.NextCursor == nil || len(result.Data) == 0 {
			break
		}
		cursor = *result.NextCursor
	}
	return pages, nil
}

func (c *client) getPage(id string) (page, error) {
	response, err := c.request(http.MethodGet, "/pages/"+url.PathEscape(id), nil, nil)
	if err != nil {
		return page{}, err
	}
	var result page
	return result, decodeJSON(response, &result)
}

func (c *client) resolvePagesByTitle(title string) ([]pageResolutionItem, error) {
	response, err := c.request(
		http.MethodGet,
		"/pages/resolve?title="+url.QueryEscape(title),
		nil,
		nil,
	)
	if err != nil {
		return nil, err
	}
	var resolved pageResolution
	if err := decodeJSON(response, &resolved); err != nil {
		return nil, err
	}
	return resolved.Data, nil
}

type createPageRequest struct {
	Title    *string `json:"title,omitempty"`
	ParentID *string `json:"parentId,omitempty"`
	Icon     *string `json:"icon,omitempty"`
	Markdown *string `json:"markdown,omitempty"`
}

type updatePageRequest struct {
	Title     *string
	Icon      *string
	ClearIcon bool
}

func (request updatePageRequest) MarshalJSON() ([]byte, error) {
	payload := make(map[string]any)
	if request.Title != nil {
		payload["title"] = *request.Title
	}
	if request.Icon != nil {
		payload["icon"] = *request.Icon
	} else if request.ClearIcon {
		payload["icon"] = nil
	}
	return json.Marshal(payload)
}

type exactEditRequest struct {
	Edits []exactEdit `json:"edits"`
}

type exactEdit struct {
	ID      string `json:"id"`
	OldText string `json:"oldText"`
	NewText string `json:"newText"`
}

type contentBoundaryOperation struct {
	ID        string `json:"id"`
	Operation string `json:"operation"`
	Content   string `json:"content"`
}

type contentBoundaryOperationResponse struct {
	ID   string `json:"id"`
	ETag string `json:"etag"`
}

func (c *client) createPage(request createPageRequest) (page, error) {
	body, err := marshalBody(request)
	if err != nil {
		return page{}, err
	}
	response, err := c.request(http.MethodPost, "/pages", body, map[string]string{"Content-Type": "application/json"})
	if err != nil {
		return page{}, err
	}
	var created page
	return created, decodeJSON(response, &created)
}

func (c *client) getPageContent(id string) ([]byte, string, error) {
	response, err := c.request(http.MethodGet, "/pages/"+url.PathEscape(id)+"/content", nil, nil)
	if err != nil {
		return nil, "", err
	}
	defer response.Body.Close()
	content, err := readBoundedContent(response.Body)
	return content, response.Header.Get("ETag"), err
}

func (c *client) replacePageContent(id string, markdown []byte, etag string) (string, error) {
	response, err := c.request(http.MethodPut, "/pages/"+url.PathEscape(id)+"/content", markdown, map[string]string{
		"Content-Type": "text/markdown", "If-Match": etag,
	})
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	return response.Header.Get("ETag"), nil
}

func (c *client) updatePage(id string, request updatePageRequest) (page, error) {
	body, err := marshalBody(request)
	if err != nil {
		return page{}, err
	}
	response, err := c.request(http.MethodPatch, "/pages/"+url.PathEscape(id), body, map[string]string{"Content-Type": "application/json"})
	if err != nil {
		return page{}, err
	}
	var updated page
	return updated, decodeJSON(response, &updated)
}

func (c *client) applyPageExactEdit(id string, edit exactEdit, idempotencyKey string) (editResponse, error) {
	body, err := marshalBody(exactEditRequest{Edits: []exactEdit{edit}})
	if err != nil {
		return editResponse{}, err
	}
	headers := map[string]string{
		"Content-Type": "application/json", "Idempotency-Key": idempotencyKey,
	}
	response, err := c.request(http.MethodPost, "/pages/"+url.PathEscape(id)+"/edits", body, headers)
	if err != nil {
		return editResponse{}, err
	}
	var result editResponse
	return result, decodeJSON(response, &result)
}

func (c *client) applyPageContentBoundaryOperation(
	id string,
	operation contentBoundaryOperation,
	idempotencyKey string,
) (contentBoundaryOperationResponse, error) {
	body, err := marshalBody(operation)
	if err != nil {
		return contentBoundaryOperationResponse{}, err
	}
	response, err := c.request(
		http.MethodPost,
		"/pages/"+url.PathEscape(id)+"/content-operations",
		body,
		map[string]string{"Content-Type": "application/json", "Idempotency-Key": idempotencyKey},
	)
	if err != nil {
		return contentBoundaryOperationResponse{}, err
	}
	var result contentBoundaryOperationResponse
	return result, decodeJSON(response, &result)
}
