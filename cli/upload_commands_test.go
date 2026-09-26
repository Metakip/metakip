package main

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
)

func TestUncertainUploadOutcomeGuidesIdempotentReplay(t *testing.T) {
	err := uncertainUploadOutcome(&cliError{Code: "network_error"}, "upload-key")
	var uncertain *cliError
	if !errors.As(err, &uncertain) || uncertain.Code != "upload_outcome_uncertain" {
		t.Fatalf("expected uncertain upload error, got %v", err)
	}
	details, ok := uncertain.Details.(*uncertainEditDetails)
	if !ok || details.IdempotencyKey != "upload-key" || details.EditID != "" {
		t.Fatalf("missing uncertain upload details: %#v", uncertain.Details)
	}
	if !strings.Contains(uncertain.Message, "Retry the same upload with the reported idempotency key") {
		t.Fatalf("unsafe upload retry guidance: %q", uncertain.Message)
	}
}

func TestUncertainUploadOutcomeRecognizesGatewayFailures(t *testing.T) {
	err := uncertainUploadOutcome(
		&cliError{Code: "bad_gateway", StatusCode: http.StatusBadGateway},
		"upload-key",
	)
	if errorCode(err) != "upload_outcome_uncertain" {
		t.Fatalf("expected uncertain upload error, got %v", err)
	}
}

func TestCanceledUploadPreservesRecoveryDetails(t *testing.T) {
	var stderr strings.Builder
	runtime := &runtimeState{cli: &CLI{}, stderr: &stderr}
	err := uncertainUploadOutcome(
		&cliError{Code: "network_error", Cause: context.Canceled},
		"upload-key",
	)

	if got := reportRunError(runtime, err); got != exitFailure {
		t.Fatalf("unexpected exit code %d", got)
	}
	output := stderr.String()
	if strings.Contains(output, "Interrupted") || !strings.Contains(output, "upload-key") {
		t.Fatalf("upload recovery details were not preserved: %q", output)
	}
}
