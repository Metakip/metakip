package main

import (
	"fmt"
	"net/http"
	"net/url"
)

func (c *client) search(query string) ([]searchResult, error) {
	response, err := c.request(http.MethodGet, "/search?q="+url.QueryEscape(query), nil, nil)
	if err != nil {
		return nil, err
	}
	var result struct {
		Data []searchResult `json:"data"`
	}
	if err := decodeJSON(response, &result); err != nil {
		return nil, fmt.Errorf("decode search results: %w", err)
	}
	return result.Data, nil
}
