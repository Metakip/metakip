package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type apiErrorEnvelope struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

type legacyAPIError struct {
	Message string `json:"message"`
}

type client struct {
	baseURL string
	token   string
	http    *http.Client
	ctx     context.Context
	timeout time.Duration
}

func newClient(ctx context.Context, baseURL, token string, timeout time.Duration) (*client, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	parsed, err := url.Parse(baseURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, usageError("Invalid Metakip URL %q.", baseURL)
	}
	if parsed.Scheme == "http" && !isLoopbackHost(parsed.Hostname()) {
		return nil, usageError("Remote Metakip URLs must use HTTPS.")
	}
	if strings.TrimSpace(token) == "" {
		return nil, &cliError{Code: "not_authenticated", Message: "Not logged in; run `metakip login` or set METAKIP_TOKEN.", StatusCode: http.StatusUnauthorized}
	}
	if timeout <= 0 {
		return nil, usageError("Timeout must be greater than zero.")
	}
	return &client{
		baseURL: baseURL,
		token:   strings.TrimSpace(token),
		http:    &http.Client{Timeout: timeout},
		ctx:     ctx,
		timeout: timeout,
	}, nil
}

func isLoopbackHost(host string) bool {
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	if host == "localhost" {
		return true
	}
	if zoneIndex := strings.LastIndexByte(host, '%'); zoneIndex >= 0 {
		host = host[:zoneIndex]
	}
	address := net.ParseIP(host)
	return address != nil && address.IsLoopback()
}

func (c *client) request(method, path string, body []byte, headers map[string]string) (*http.Response, error) {
	return c.requestWithContext(c.ctx, method, path, body, headers)
}

func (c *client) requestWithContext(ctx context.Context, method, path string, body []byte, headers map[string]string) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+"/api/v1"+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+c.token)
	request.Header.Set("Accept", "application/json, text/markdown")
	request.Header.Set("User-Agent", "metakip-cli/"+buildVersion())
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := c.http.Do(request)
	if err != nil {
		if response != nil && response.Body != nil {
			response.Body.Close()
		}
		return nil, &cliError{Code: "network_error", Message: "Could not reach Metakip", Cause: err}
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return response, nil
	}
	defer response.Body.Close()
	const maxErrorResponseBytes = 1 << 20
	data, err := io.ReadAll(io.LimitReader(response.Body, maxErrorResponseBytes+1))
	if err != nil {
		return nil, &cliError{
			Code: "network_error", Message: "Could not read Metakip error response", Cause: err,
		}
	}
	if len(data) > maxErrorResponseBytes {
		return nil, &cliError{
			Code: "invalid_response", Message: "Metakip error response exceeds the 1 MiB limit",
		}
	}
	var envelope apiErrorEnvelope
	if !utf8.Valid(data) {
		return nil, &cliError{
			Code: "invalid_response", Message: "Metakip returned an invalid error response",
			StatusCode: response.StatusCode,
		}
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, &cliError{
			Code: "invalid_response", Message: "Metakip returned an invalid error response",
			StatusCode: response.StatusCode, Cause: err,
		}
	}
	code := strings.TrimSpace(envelope.Error.Code)
	message := strings.TrimSpace(envelope.Error.Message)
	if code == "" || message == "" {
		var legacy legacyAPIError
		if err := json.Unmarshal(data, &legacy); err == nil && strings.TrimSpace(legacy.Message) != "" {
			code = "api_error"
			message = strings.TrimSpace(legacy.Message)
		} else {
			return nil, &cliError{
				Code: "invalid_response", Message: "Metakip returned an invalid error response",
				StatusCode: response.StatusCode,
			}
		}
	}
	retryAfter := time.Duration(0)
	if rawRetryAfter := response.Header.Get("Retry-After"); rawRetryAfter != "" {
		seconds, parseError := strconv.Atoi(rawRetryAfter)
		if parseError != nil || seconds < 0 {
			return nil, &cliError{
				Code: "invalid_response", Message: "Metakip returned an invalid Retry-After header",
				Cause: parseError,
			}
		}
		retryAfter = time.Duration(seconds) * time.Second
	}
	return nil, &cliError{
		Code: code, Message: message, StatusCode: response.StatusCode, RetryAfter: retryAfter,
	}
}

func decodeJSON(response *http.Response, target any) error {
	defer response.Body.Close()
	data, err := readBoundedContent(response.Body)
	if err != nil {
		if errorCode(err) == "payload_too_large" {
			return fmt.Errorf("read API response: %w", err)
		}
		return &cliError{Code: "network_error", Message: "Could not read Metakip response", Cause: err}
	}
	if !utf8.Valid(data) {
		return &cliError{Code: "invalid_response", Message: "Metakip returned invalid JSON"}
	}
	if err := json.Unmarshal(data, target); err != nil {
		return &cliError{Code: "invalid_response", Message: "Metakip returned invalid JSON", Cause: err}
	}
	return nil
}

func discardAndCloseResponse(response *http.Response) error {
	_, readErr := io.Copy(io.Discard, response.Body)
	closeErr := response.Body.Close()
	if readErr == nil && closeErr == nil {
		return nil
	}
	return &cliError{
		Code:    "network_error",
		Message: "Could not drain Metakip response",
		Cause:   errors.Join(readErr, closeErr),
	}
}
