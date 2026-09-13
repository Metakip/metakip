package main

import (
	"errors"
	"os"
)

type standaloneDoctorCheck struct {
	Status      doctorStatus    `json:"status"`
	Message     string          `json:"message"`
	Operation   doctorOperation `json:"operation,omitempty"`
	Error       string          `json:"error,omitempty"`
	ReceiptPath string          `json:"receiptPath,omitempty"`
	BinaryPath  string          `json:"binaryPath,omitempty"`
}

func inspectStandaloneInstall() standaloneDoctorCheck {
	path, err := installReceiptPath()
	if err != nil {
		return standaloneDoctorCheck{
			Status: doctorStatusUnknown, Message: err.Error(),
			Operation: doctorOperationResolveReceiptPath, Error: err.Error(),
		}
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return standaloneDoctorCheck{
			Status: doctorStatusNotInstalled, Message: "Install Metakip with the standalone installer.", ReceiptPath: path,
		}
	}
	if err != nil {
		return standaloneDoctorCheck{
			Status: doctorStatusUnhealthy, Message: "Read receipt: " + err.Error(),
			Operation: doctorOperationReadReceipt, Error: err.Error(), ReceiptPath: path,
		}
	}
	receipt, err := decodeInstallReceipt(data)
	if err != nil {
		return standaloneDoctorCheck{
			Status: doctorStatusUnhealthy, Message: "Invalid receipt: " + err.Error(),
			Operation: doctorOperationDecodeReceipt, Error: err.Error(), ReceiptPath: path,
		}
	}
	info, err := os.Stat(receipt.BinaryPath)
	if err != nil {
		return standaloneDoctorCheck{
			Status: doctorStatusUnhealthy, Message: "Inspect binary: " + err.Error(),
			Operation: doctorOperationInspectBinary, Error: err.Error(),
			ReceiptPath: path, BinaryPath: receipt.BinaryPath,
		}
	}
	if !info.Mode().IsRegular() {
		return standaloneDoctorCheck{
			Status: doctorStatusUnhealthy, Message: "Standalone binary is not a regular file.",
			Operation: doctorOperationInspectBinary, Error: "not a regular file",
			ReceiptPath: path, BinaryPath: receipt.BinaryPath,
		}
	}
	return standaloneDoctorCheck{
		Status: doctorStatusHealthy, Message: "Installed at " + receipt.BinaryPath + ".",
		ReceiptPath: path, BinaryPath: receipt.BinaryPath,
	}
}
