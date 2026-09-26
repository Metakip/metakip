package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"
)

const (
	exitOK          = 0
	exitFailure     = 1
	exitUsage       = 2
	exitAuth        = 4
	exitConflict    = 5
	exitInterrupted = 130
	exitInternal    = 70
)

type cliError struct {
	Code             string
	Message          string
	StatusCode       int
	Details          any
	Cause            error
	RetryAfter       time.Duration
	Presentation     cliErrorPresentation
	AlreadyRendered  bool
	OutcomeUncertain bool
}

func (e *cliError) Error() string {
	if e.Message != "" && e.Cause != nil {
		return e.Message + ": " + e.Cause.Error()
	}
	if e.Message != "" {
		return e.Message
	}
	if e.Cause != nil {
		return e.Cause.Error()
	}
	return e.Code
}

func (e *cliError) Unwrap() error { return e.Cause }

type cliErrorPresentation struct {
	HumanParagraphs  []string
	HumanDetailLines []string
}

func usageError(format string, values ...any) error {
	return &cliError{Code: "invalid_arguments", Message: fmt.Sprintf(format, values...), StatusCode: http.StatusBadRequest}
}

func errorCode(err error) string {
	var typed *cliError
	if errors.As(err, &typed) {
		return typed.Code
	}
	return ""
}

func mutationOutcomeUncertain(err error) bool {
	var requestError *cliError
	return errors.Is(err, context.Canceled) ||
		errors.Is(err, context.DeadlineExceeded) ||
		errorCode(err) == "network_error" ||
		errorCode(err) == "invalid_response" ||
		(errors.As(err, &requestError) &&
			requestError.StatusCode >= http.StatusInternalServerError &&
			requestError.StatusCode <= 599)
}

func exitCode(err error) int {
	var typed *cliError
	if !errors.As(err, &typed) {
		return exitFailure
	}
	if typed.Code == "invalid_arguments" || typed.StatusCode == http.StatusBadRequest {
		return exitUsage
	}
	if typed.StatusCode == http.StatusUnauthorized || typed.StatusCode == http.StatusForbidden {
		return exitAuth
	}
	if typed.StatusCode == http.StatusConflict || typed.StatusCode == http.StatusPreconditionRequired {
		return exitConflict
	}
	return exitFailure
}

type ambiguousPageDetails struct {
	Reference  string          `json:"reference"`
	Candidates []pageCandidate `json:"candidates"`
}
