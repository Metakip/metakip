package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/charmbracelet/huh"
	"github.com/charmbracelet/lipgloss"
)

func (cmd *UninstallCmd) Run(r *runtimeState) error {
	receipt, receiptPath, err := managedInstall()
	if err != nil {
		return err
	}
	configPathValue := ""
	if cmd.Purge {
		configPathValue, err = configPath()
		if err != nil {
			return err
		}
	}
	if cmd.DryRun {
		return printUninstallPlan(r, receipt, receiptPath, configPathValue)
	}
	if !cmd.Yes {
		if !r.interactive() {
			return usageError("Uninstall requires confirmation; pass --yes when terminal input is disabled.")
		}
		if err := confirmUninstall(r); err != nil {
			return err
		}
	}
	deferred, err := removeStandaloneBinary(receipt.BinaryPath, receiptPath, configPathValue)
	if err != nil {
		return err
	}
	if r.cli.JSON {
		return r.printJSON(uninstallResult{Uninstalled: !deferred, Scheduled: deferred})
	}
	if deferred {
		_, err = fmt.Fprintln(r.stdout, "Metakip uninstall is scheduled and will finish after this command exits.")
		return err
	}
	_, err = fmt.Fprintln(r.stdout, "Metakip uninstalled.")
	return err
}

func removeStandaloneConfig(path string) error {
	if path == "" {
		return nil
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove Metakip configuration: %w", err)
	}
	if os.Getenv("METAKIP_CONFIG_DIR") == "" {
		if err := os.Remove(filepath.Dir(path)); err != nil && !errors.Is(err, os.ErrNotExist) && !errors.Is(err, syscallENOTEMPTY()) {
			return fmt.Errorf("remove Metakip configuration directory: %w", err)
		}
	}
	return nil
}

func printUninstallPlan(r *runtimeState, receipt installReceipt, receiptPath, configPathValue string) error {
	paths := []string{receipt.BinaryPath, receiptPath}
	if configPathValue != "" {
		paths = append(paths, configPathValue)
	}
	if r.cli.JSON {
		return r.printJSON(uninstallPlan{DryRun: true, Paths: paths})
	}
	for _, path := range paths {
		if _, err := fmt.Fprintln(r.stdout, "Would remove:", path); err != nil {
			return err
		}
	}
	return nil
}

type uninstallResult struct {
	Uninstalled bool `json:"uninstalled"`
	Scheduled   bool `json:"scheduled"`
}

type uninstallPlan struct {
	DryRun bool     `json:"dryRun"`
	Paths  []string `json:"paths"`
}

func confirmUninstall(r *runtimeState) error {
	confirmed := false
	form := huh.NewForm(huh.NewGroup(
		huh.NewConfirm().
			Title("Remove this standalone Metakip installation?").
			Value(&confirmed).
			WithButtonAlignment(lipgloss.Left),
	))
	err := form.WithInput(r.stdin).WithOutput(r.stderr).RunWithContext(r.ctx)
	if errors.Is(err, huh.ErrUserAborted) {
		return &cliError{Code: "aborted", Message: "Uninstall cancelled."}
	}
	if err != nil {
		return err
	}
	if !confirmed {
		return &cliError{Code: "aborted", Message: "Uninstall cancelled."}
	}
	return nil
}
