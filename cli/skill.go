package main

import (
	"fmt"
	"os/exec"
)

const metakipSkillSource = "Metakip/metakip"

func (cmd *SkillInstallCmd) Run(r *runtimeState) error {
	arguments := []string{"skills", "add", metakipSkillSource, "--skill", "metakip"}
	if cmd.Global {
		arguments = append(arguments, "--global")
	}
	if cmd.Copy {
		arguments = append(arguments, "--copy")
	}
	if cmd.Yes {
		arguments = append(arguments, "--yes")
	}
	return runSkillsCommand(r, arguments)
}

func (cmd *SkillUpdateCmd) Run(r *runtimeState) error {
	if cmd.Global && cmd.Project {
		return usageError("The --global and --project options cannot be used together.")
	}
	arguments := []string{"skills", "update", "metakip"}
	if cmd.Global {
		arguments = append(arguments, "--global")
	}
	if cmd.Project {
		arguments = append(arguments, "--project")
	}
	if cmd.Yes {
		arguments = append(arguments, "--yes")
	}
	return runSkillsCommand(r, arguments)
}

func runSkillsCommand(r *runtimeState, arguments []string) error {
	if r.cli.JSON {
		return usageError("Skill commands do not support --json because npx skills owns their output.")
	}
	npx, err := exec.LookPath("npx")
	if err != nil {
		return &cliError{
			Code:    "npx_unavailable",
			Message: "The npx command is required for agent skill management. Install Node.js and try again",
			Cause:   err,
		}
	}
	// npx otherwise prompts before fetching the skills package, even when the caller
	// requested a non-interactive skills installation. The skills CLI retains its own
	// confirmation prompts unless the caller supplied --yes.
	command := exec.CommandContext(r.ctx, npx, append([]string{"--yes"}, arguments...)...)
	command.Stdin = r.stdin
	command.Stdout = r.stdout
	command.Stderr = r.stderr
	if err := command.Run(); err != nil {
		return fmt.Errorf("run npx skills: %w", err)
	}
	return nil
}
