package main

import (
	"fmt"
	"net/http"
	"os"
)

type DoctorCmd struct{}

type doctorResult struct {
	Version        string                `json:"version"`
	ConfigPath     string                `json:"configPath"`
	Server         string                `json:"server"`
	Authentication doctorAuthentication  `json:"authentication"`
	Standalone     standaloneDoctorCheck `json:"standalone"`
	Skills         skillsDoctorCheck     `json:"skills"`
}

type doctorAuthentication struct {
	Status  doctorStatus `json:"status"`
	Source  string       `json:"source,omitempty"`
	User    string       `json:"user,omitempty"`
	Scopes  []tokenScope `json:"scopes,omitempty"`
	Message string       `json:"message,omitempty"`
}

type doctorStatus string

const (
	doctorStatusAuthenticated    doctorStatus = "authenticated"
	doctorStatusNotAuthenticated doctorStatus = "not_authenticated"
	doctorStatusHealthy          doctorStatus = "healthy"
	doctorStatusNotInstalled     doctorStatus = "not_installed"
	doctorStatusUnavailable      doctorStatus = "unavailable"
	doctorStatusAvailable        doctorStatus = "available"
	doctorStatusUnhealthy        doctorStatus = "unhealthy"
	doctorStatusUnknown          doctorStatus = "unknown"
)

func (status doctorStatus) humanLabel() string {
	switch status {
	case doctorStatusAuthenticated:
		return "Authenticated"
	case doctorStatusNotAuthenticated:
		return "Not authenticated"
	case doctorStatusHealthy:
		return "Healthy"
	case doctorStatusNotInstalled:
		return "Not installed"
	case doctorStatusUnavailable:
		return "Unavailable"
	case doctorStatusAvailable:
		return "Available"
	case doctorStatusUnhealthy:
		return "Unhealthy"
	case doctorStatusUnknown:
		return "Unknown"
	default:
		return string(status)
	}
}

type doctorOperation string

const (
	doctorOperationResolveReceiptPath  doctorOperation = "resolve_receipt_path"
	doctorOperationReadReceipt         doctorOperation = "read_receipt"
	doctorOperationDecodeReceipt       doctorOperation = "decode_receipt"
	doctorOperationInspectBinary       doctorOperation = "inspect_binary"
	doctorOperationFindRequiredCommand doctorOperation = "find_required_command"
)

func (cmd *DoctorCmd) Run(r *runtimeState) error {
	result := doctorResult{
		Version:    buildVersion(),
		Standalone: inspectStandaloneInstall(),
		Skills:     inspectSkillsTool(),
	}
	resolvedConfigPath, configPathErr := configPath()
	if configPathErr != nil {
		result.ConfigPath = "unavailable"
	} else {
		result.ConfigPath = resolvedConfigPath
	}
	server, err := r.serverURL()
	if err != nil {
		result.Server = "unavailable"
		result.Authentication = doctorAuthentication{Status: doctorStatusUnhealthy, Message: err.Error()}
		return renderDoctorHealthFailure(r, result, fmt.Errorf("determine server: %w", err))
	}
	result.Server = server
	cfg, err := r.config()
	if err != nil {
		result.Authentication = doctorAuthentication{Status: doctorStatusUnhealthy, Message: err.Error()}
		return renderDoctorHealthFailure(r, result, fmt.Errorf("load configuration: %w", err))
	}
	tokenSource := ""
	if os.Getenv("METAKIP_TOKEN") != "" {
		tokenSource = "METAKIP_TOKEN"
	} else if cfg.Token != "" {
		tokenSource = "saved configuration"
	}
	if tokenSource == "" {
		result.Authentication = doctorAuthentication{Status: doctorStatusNotAuthenticated}
		return renderDoctorResult(r, result)
	}
	c, err := r.client()
	if err != nil {
		result.Authentication = doctorAuthentication{Status: doctorStatusUnhealthy, Source: tokenSource, Message: err.Error()}
		return renderDoctorHealthFailure(r, result, fmt.Errorf("check authentication: %w", err))
	}
	response, err := c.request(http.MethodGet, "/me", nil, nil)
	if err != nil {
		result.Authentication = doctorAuthentication{Status: doctorStatusUnhealthy, Source: tokenSource, Message: err.Error()}
		return renderDoctorHealthFailure(r, result, fmt.Errorf("check authentication: %w", err))
	}
	var user authenticatedUser
	if err := decodeJSON(response, &user); err != nil {
		result.Authentication = doctorAuthentication{Status: doctorStatusUnhealthy, Source: tokenSource, Message: err.Error()}
		return renderDoctorHealthFailure(r, result, fmt.Errorf("check authentication: %w", err))
	}
	result.Authentication = doctorAuthentication{
		Status: doctorStatusAuthenticated,
		Source: tokenSource,
		User:   user.Email,
		Scopes: user.Scopes,
	}
	return renderDoctorResult(r, result)
}

func renderDoctorHealthFailure(r *runtimeState, result doctorResult, cause error) error {
	if err := renderDoctorResult(r, result); err != nil {
		return err
	}
	return &cliError{Code: "doctor_unhealthy", Message: "Doctor found unhealthy checks", Cause: cause, AlreadyRendered: true}
}

func renderDoctorResult(r *runtimeState, result doctorResult) error {
	if r.cli.JSON {
		return r.printJSON(result)
	}
	if _, err := fmt.Fprintf(r.stdout, "Metakip %s\n", terminalText(result.Version)); err != nil {
		return err
	}
	configPath := result.ConfigPath
	if configPath == "unavailable" {
		configPath = "Unavailable"
	}
	if _, err := fmt.Fprintf(r.stdout, "Configuration: %s\n", terminalText(configPath)); err != nil {
		return err
	}
	server := result.Server
	if server == "unavailable" {
		server = "Unavailable"
	}
	if _, err := fmt.Fprintf(r.stdout, "Server: %s\n", terminalText(server)); err != nil {
		return err
	}
	authentication := result.Authentication.Status.humanLabel()
	if result.Authentication.User != "" {
		authentication += " as " + result.Authentication.User
	}
	if result.Authentication.Source != "" {
		source := result.Authentication.Source
		if source == "saved configuration" {
			source = "Saved configuration"
		}
		authentication += " (" + source + ")"
	}
	if result.Authentication.Message != "" {
		authentication += " — " + result.Authentication.Message
	} else if result.Authentication.Status == doctorStatusNotAuthenticated {
		authentication += " — Run `metakip login` to authenticate."
	}
	if _, err := fmt.Fprintf(r.stdout, "Authentication: %s\n", terminalText(authentication)); err != nil {
		return err
	}
	if access := tokenAccess(result.Authentication.Scopes); access != "" {
		if _, err := fmt.Fprintf(r.stdout, "Token access: %s\n", terminalText(access)); err != nil {
			return err
		}
	}
	if _, err := fmt.Fprintf(r.stdout, "Standalone: %s — %s\n", terminalText(result.Standalone.Status.humanLabel()), terminalText(result.Standalone.Message)); err != nil {
		return err
	}
	_, err := fmt.Fprintf(r.stdout, "Skills tool: %s — %s\n", terminalText(result.Skills.Status.humanLabel()), terminalText(result.Skills.Message))
	return err
}
