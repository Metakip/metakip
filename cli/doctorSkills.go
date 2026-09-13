package main

import "os/exec"

type skillsDoctorCheck struct {
	Status          doctorStatus    `json:"status"`
	Message         string          `json:"message"`
	Operation       doctorOperation `json:"operation,omitempty"`
	Error           string          `json:"error,omitempty"`
	RequiredCommand string          `json:"requiredCommand,omitempty"`
	InstallCommand  string          `json:"installCommand,omitempty"`
}

func inspectSkillsTool() skillsDoctorCheck {
	const installCommand = "npx skills add Metakip/metakip --skill metakip"
	if _, err := exec.LookPath("npx"); err != nil {
		return skillsDoctorCheck{
			Status: doctorStatusUnavailable, Message: "Install Node.js to manage the optional agent skill.",
			Operation: doctorOperationFindRequiredCommand, Error: err.Error(), RequiredCommand: "npx",
		}
	}
	return skillsDoctorCheck{
		Status: doctorStatusAvailable, Message: "Install the skill with: " + installCommand,
		RequiredCommand: "npx", InstallCommand: installCommand,
	}
}
