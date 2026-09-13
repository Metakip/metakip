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
	"strings"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

type failingReadCloser struct {
	err error
}

func (reader *failingReadCloser) Read(buffer []byte) (int, error) {
	return copy(buffer, "partial response"), reader.err
}

func (reader *failingReadCloser) Close() error { return nil }

func TestClientSendsAuthenticationAndUserAgent(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/v1/me" {
			t.Fatalf("unexpected path %s", request.URL.Path)
		}
		if got := request.Header.Get("Authorization"); got != "Bearer secret" {
			t.Fatalf("unexpected authorization %q", got)
		}
		if got := request.Header.Get("User-Agent"); !strings.HasPrefix(got, "metakip-cli/") {
			t.Fatalf("unexpected user agent %q", got)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(response, `{"id":"user"}`)
	}))
	defer server.Close()

	client, err := newClient(context.Background(), server.URL, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.request(http.MethodGet, "/me", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
}

func TestClientRequiresHTTPSForRemoteServers(t *testing.T) {
	tests := []struct {
		name    string
		baseURL string
		valid   bool
	}{
		{name: "remote HTTPS", baseURL: "https://metakip.example", valid: true},
		{name: "remote HTTP", baseURL: "http://metakip.example", valid: false},
		{name: "localhost HTTP", baseURL: "http://localhost:3001", valid: true},
		{name: "absolute localhost HTTP", baseURL: "http://localhost.:3001", valid: true},
		{name: "IPv4 loopback HTTP", baseURL: "http://127.0.0.1:3001", valid: true},
		{name: "IPv4 loopback range HTTP", baseURL: "http://127.42.0.1:3001", valid: true},
		{name: "IPv6 loopback HTTP", baseURL: "http://[::1]:3001", valid: true},
		{name: "zoned IPv6 loopback HTTP", baseURL: "http://[::1%25lo]:3001", valid: true},
		{name: "localhost suffix attack", baseURL: "http://localhost.example:3001", valid: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := newClient(context.Background(), test.baseURL, "secret", time.Second)
			if test.valid && err != nil {
				t.Fatalf("expected URL to be accepted: %v", err)
			}
			if !test.valid && errorCode(err) != "invalid_arguments" {
				t.Fatalf("expected invalid_arguments, got %v", err)
			}
		})
	}
}

func TestClientReturnsStructuredAPIError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(response, `{"error":{"code":"insufficient_scope","message":"Token requires pages:write"}}`)
	}))
	defer server.Close()
	client, err := newClient(context.Background(), server.URL, "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.request(http.MethodPost, "/pages", []byte(`{}`), nil)
	typed, ok := err.(*cliError)
	if !ok {
		t.Fatalf("expected cliError, got %T", err)
	}
	if typed.Code != "insufficient_scope" || typed.StatusCode != http.StatusForbidden {
		t.Fatalf("unexpected error %#v", typed)
	}
}

func TestClientRejectsMalformedAPIErrorResponses(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "invalid JSON", body: `<html>bad gateway</html>`},
		{name: "invalid UTF-8", body: string([]byte{0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d})},
		{name: "missing envelope fields", body: `{"error":{"message":"bad gateway"}}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				response.WriteHeader(http.StatusBadGateway)
				_, _ = io.WriteString(response, test.body)
			}))
			defer server.Close()
			client, err := newClient(context.Background(), server.URL, "secret", time.Second)
			if err != nil {
				t.Fatal(err)
			}

			_, err = client.request(http.MethodGet, "/pages", nil, nil)
			typed, ok := err.(*cliError)
			if !ok {
				t.Fatalf("expected cliError, got %T", err)
			}
			if typed.Code != "invalid_response" || typed.StatusCode != http.StatusBadGateway {
				t.Fatalf("unexpected error %#v", typed)
			}
			if strings.Contains(typed.Message, test.body) {
				t.Fatalf("error exposed unstructured response body: %q", typed.Message)
			}
		})
	}
}

func TestClientPropagatesErrorResponseReadFailures(t *testing.T) {
	readFailure := errors.New("response body failed")
	client, err := newClient(context.Background(), "https://example.test", "secret", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	client.http.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusBadGateway,
			Header:     make(http.Header),
			Body:       &failingReadCloser{err: readFailure},
		}, nil
	})

	_, err = client.request(http.MethodGet, "/pages", nil, nil)
	if errorCode(err) != "network_error" {
		t.Fatalf("expected network_error, got %v", err)
	}
	if !errors.Is(err, readFailure) {
		t.Fatalf("expected wrapped read failure, got %v", err)
	}
}

func TestJSONErrorOutputIsMachineReadable(t *testing.T) {
	var output strings.Builder
	runtime := &runtimeState{cli: &CLI{JSON: true}, stdout: &output}
	runtime.printError(&cliError{Code: "conflict", Message: "page changed", Details: map[string]string{"etag": "abc"}})
	var result struct {
		Error struct {
			Code    string            `json:"code"`
			Message string            `json:"message"`
			Details map[string]string `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal([]byte(output.String()), &result); err != nil {
		t.Fatal(err)
	}
	if result.Error.Code != "conflict" || result.Error.Details["etag"] != "abc" {
		t.Fatalf("unexpected output %#v", result)
	}
}

func TestJSONErrorOutputOmitsHumanGuidanceLayout(t *testing.T) {
	var output strings.Builder
	runtime := &runtimeState{cli: &CLI{JSON: true}, stdout: &output}
	runtime.printError(unmanagedUpdateError())
	var result jsonErrorEnvelope
	if err := json.Unmarshal([]byte(output.String()), &result); err != nil {
		t.Fatal(err)
	}
	want := "Cannot update this binary because it is not managed by the standalone installer."
	if result.Error.Message != want {
		t.Fatalf("JSON error message = %q, want %q", result.Error.Message, want)
	}
}

func TestCLIErrorComposesSummaryAndCauseOnce(t *testing.T) {
	err := &cliError{
		Message: "Token validation failed",
		Cause:   errors.New("x509: certificate signed by unknown authority"),
	}
	if got := err.Error(); got != "Token validation failed: x509: certificate signed by unknown authority" {
		t.Fatalf("canonical composed error = %q", got)
	}
	var output strings.Builder
	runtime := &runtimeState{cli: &CLI{}, stderr: &output}
	runtime.printError(err)
	if got := output.String(); got != "Error: Token validation failed: x509: certificate signed by unknown authority\n" {
		t.Fatalf("human composed error = %q", got)
	}
	output.Reset()
	jsonRuntime := &runtimeState{cli: &CLI{JSON: true}, stdout: &output}
	jsonRuntime.printError(err)
	var envelope jsonErrorEnvelope
	if decodeErr := json.Unmarshal([]byte(output.String()), &envelope); decodeErr != nil {
		t.Fatal(decodeErr)
	}
	if envelope.Error.Message != err.Error() {
		t.Fatalf("JSON composed error = %q, want %q", envelope.Error.Message, err.Error())
	}
}

func TestUsageErrorKeepsCanonicalMessage(t *testing.T) {
	err := usageError("authored message")
	typed, ok := err.(*cliError)
	if !ok {
		t.Fatalf("usage error type = %T", err)
	}
	if typed.Message != "authored message" {
		t.Fatalf("usage error message = %q", typed.Message)
	}
}

func TestHumanErrorOutputPreservesGuidanceLines(t *testing.T) {
	var output strings.Builder
	runtime := &runtimeState{cli: &CLI{}, stderr: &output}
	runtime.printError(fmt.Errorf("update command failed: %w", unmanagedUpdateError()))
	want := "Error: Cannot update this binary because it is not managed by the standalone installer.\n\nIf this was installed with Go, update it with: go install github.com/Metakip/metakip/cli@latest\n\nOtherwise, reinstall it using the standalone installer.\n"
	if output.String() != want {
		t.Fatalf("human error output = %q, want %q", output.String(), want)
	}
}

func TestHumanErrorOutputPreservesDynamicTechnicalMessages(t *testing.T) {
	var output strings.Builder
	runtime := &runtimeState{cli: &CLI{}, stderr: &output}
	runtime.printError(&cliError{Code: "network_error", Message: "x509: certificate signed by unknown authority"})
	if output.String() != "Error: x509: certificate signed by unknown authority\n" {
		t.Fatalf("dynamic error output = %q", output.String())
	}

	output.Reset()
	runtime.printError(&cliError{Code: "network_error", Message: "Could not reach Metakip."})
	if output.String() != "Error: Could not reach Metakip.\n" {
		t.Fatalf("authored error output = %q", output.String())
	}
}

func TestHumanErrorOutputPreservesOpaqueErrors(t *testing.T) {
	var output strings.Builder
	runtime := &runtimeState{cli: &CLI{}, stderr: &output}
	runtime.printError(fmt.Errorf("read config: %w", errors.New("x509: certificate rejected")))
	if output.String() != "Error: read config: x509: certificate rejected\n" {
		t.Fatalf("technical error output = %q", output.String())
	}

	output.Reset()
	runtime.printError(errors.New("x509: certificate rejected"))
	if output.String() != "Error: x509: certificate rejected\n" {
		t.Fatalf("dynamic technical error output = %q", output.String())
	}
}

func TestInterruptedErrorUsesTheHumanErrorBoundary(t *testing.T) {
	var output strings.Builder
	runtime := &runtimeState{cli: &CLI{}, stderr: &output}
	if code := reportRunError(runtime, context.Canceled); code != exitInterrupted {
		t.Fatalf("exit code = %d, want %d", code, exitInterrupted)
	}
	if output.String() != "Error: Interrupted.\n" {
		t.Fatalf("interrupted output = %q", output.String())
	}
}

func TestDecodeJSONRejectsTrailingData(t *testing.T) {
	response := &http.Response{Body: io.NopCloser(strings.NewReader(`{"id":"one"}{"id":"two"}`))}
	var result page
	if err := decodeJSON(response, &result); err == nil {
		t.Fatal("expected trailing JSON data to fail")
	}
}

func TestDecodeJSONRejectsInvalidUTF8(t *testing.T) {
	response := &http.Response{Body: io.NopCloser(bytes.NewReader([]byte{0x7b, 0x22, 0xff, 0x22, 0x7d}))}
	var result page
	if err := decodeJSON(response, &result); errorCode(err) != "invalid_response" {
		t.Fatalf("expected invalid_response, got %v", err)
	}
}
