package main

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"unicode/utf16"
)

func TestAddStandalonePathBlockRollsBackNewProfile(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "profile")
	installDir := filepath.Join(directory, "bin")
	ownedPath, restore, err := addStandalonePathBlock(path, installDir, "sh")
	if err != nil {
		t.Fatal(err)
	}
	if ownedPath != path {
		t.Fatalf("owned path = %q", ownedPath)
	}
	if err := restore(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("profile exists after rollback: %v", err)
	}
}

func TestAddStandalonePathBlockAddsOwnedBlockAlongsideForeignBlock(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "profile")
	contents := "# >>> metakip >>>\nexport PATH=\"/other:$PATH\"\n# <<< metakip <<<\n"
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	ownedPath, restore, err := addStandalonePathBlock(path, filepath.Join(directory, "bin"), "sh")
	if err != nil {
		t.Fatal(err)
	}
	if ownedPath != path {
		t.Fatalf("owned path = %q", ownedPath)
	}
	updated, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(updated) == contents || !blockContainsInstallPath(string(updated), filepath.Join(directory, "bin")) {
		t.Fatalf("owned PATH block was not added: %q", updated)
	}
	if err := restore(); err != nil {
		t.Fatal(err)
	}
	restored, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(restored) != contents {
		t.Fatalf("profile was not restored: %q", restored)
	}
}

func TestStandaloneFinalizeLeavesExistingPathBlockWhenProfileChanges(t *testing.T) {
	directory := t.TempDir()
	stateDir := filepath.Join(directory, "state")
	installDir := filepath.Join(directory, "bin")
	firstProfile := filepath.Join(directory, "first-profile")
	secondProfile := filepath.Join(directory, "second-profile")
	t.Setenv("METAKIP_INSTALL_STATE_DIR", stateDir)
	if err := (&StandaloneFinalizeCmd{InstallDir: installDir, PathFile: firstProfile, PathStyle: "sh"}).Run(nil); err != nil {
		t.Fatal(err)
	}
	if err := (&StandaloneFinalizeCmd{InstallDir: installDir, PathFile: secondProfile, PathStyle: "sh"}).Run(nil); err != nil {
		t.Fatal(err)
	}
	firstContents, err := os.ReadFile(firstProfile)
	if err != nil {
		t.Fatal(err)
	}
	if !blockContainsInstallPath(string(firstContents), installDir) {
		t.Fatalf("existing profile lost installer PATH block: %q", firstContents)
	}
	secondContents, err := os.ReadFile(secondProfile)
	if err != nil {
		t.Fatal(err)
	}
	if !blockContainsInstallPath(string(secondContents), installDir) {
		t.Fatalf("new profile does not contain installer PATH block: %q", secondContents)
	}
	receipt, err := os.ReadFile(filepath.Join(stateDir, "install.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(receipt), "pathFile") {
		t.Fatalf("new receipt retains obsolete pathFile: %s", receipt)
	}
	decoded, err := decodeInstallReceipt(receipt)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.PathFile != "" {
		t.Fatalf("receipt pathFile = %q, want empty", decoded.PathFile)
	}
}

func TestStandaloneFinalizeRollsBackNewProfileAfterFailedBinaryPublication(t *testing.T) {
	directory := t.TempDir()
	stateDir := filepath.Join(directory, "state")
	installDir := filepath.Join(directory, "bin")
	if err := os.Mkdir(installDir, 0o700); err != nil {
		t.Fatal(err)
	}
	binaryPath := filepath.Join(installDir, executableName())
	if err := os.Mkdir(binaryPath, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("METAKIP_INSTALL_STATE_DIR", stateDir)
	if err := os.Mkdir(stateDir, 0o700); err != nil {
		t.Fatal(err)
	}
	receiptPath, err := installReceiptPath()
	if err != nil {
		t.Fatal(err)
	}
	missingProfile := filepath.Join(directory, "deleted-profile")
	if err := writeStandaloneReceipt(receiptPath, installReceipt{
		SchemaVersion: 1,
		InstallMethod: standaloneInstallMethod,
		InstallDir:    installDir,
		BinaryPath:    binaryPath,
		PathFile:      missingProfile,
	}); err != nil {
		t.Fatal(err)
	}
	newProfile := filepath.Join(directory, "new-profile")
	err = (&StandaloneFinalizeCmd{InstallDir: installDir, PathFile: newProfile, PathStyle: "sh"}).Run(nil)
	if err == nil {
		t.Fatal("finalize unexpectedly succeeded")
	}
	if _, err := os.Stat(newProfile); !os.IsNotExist(err) {
		t.Fatalf("new profile remains after failed finalize: %v", err)
	}
}

func TestAddStandalonePathBlockPreservesUTF16LEProfile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Microsoft.PowerShell_profile.ps1")
	installDir := `C:\Metakip`
	contents := "before\r\nafter\r\n"
	units := utf16.Encode([]rune(contents))
	data := make([]byte, 2+len(units)*2)
	data[0], data[1] = 0xff, 0xfe
	for index, unit := range units {
		binary.LittleEndian.PutUint16(data[2+index*2:], unit)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := addStandalonePathBlock(path, installDir, "powershell"); err != nil {
		t.Fatal(err)
	}
	updated, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(updated) < 2 || updated[0] != 0xff || updated[1] != 0xfe {
		t.Fatalf("profile encoding was not preserved: %x", updated)
	}
	decoded, encoding, err := decodeProfile(updated)
	if err != nil {
		t.Fatal(err)
	}
	if encoding != profileUTF16LE || !strings.Contains(decoded, standalonePathEntry(installDir, "powershell")) {
		t.Fatalf("updated UTF-16 profile = %q (%v)", decoded, encoding)
	}
}

func TestAddStandalonePathBlockPreservesProfilePermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows file permissions are enforced through ACLs rather than Unix mode bits")
	}
	path := filepath.Join(t.TempDir(), "profile")
	if err := os.WriteFile(path, []byte("existing profile\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0o640); err != nil {
		t.Fatal(err)
	}
	if _, _, err := addStandalonePathBlock(path, "/tmp/metakip", "sh"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o640 {
		t.Fatalf("profile permissions = %o", info.Mode().Perm())
	}
}

func TestAddStandalonePathBlockPreservesSymlinkedProfile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows symlink creation requires privileges not guaranteed in CI")
	}
	directory := t.TempDir()
	targetPath := filepath.Join(directory, "profile-target")
	profilePath := filepath.Join(directory, "profile")
	if err := os.WriteFile(targetPath, []byte("existing profile\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(targetPath, profilePath); err != nil {
		t.Fatal(err)
	}
	if _, _, err := addStandalonePathBlock(profilePath, "/tmp/metakip", "sh"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(profilePath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		t.Fatal("profile symlink was replaced")
	}
	updated, err := os.ReadFile(targetPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(updated), standalonePathEntry("/tmp/metakip", "sh")) {
		t.Fatalf("profile target was not updated: %q", updated)
	}
}

func TestAddStandalonePathBlockRejectsMalformedBlock(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "profile")
	contents := "# >>> metakip >>>\n# >>> metakip >>>\n"
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := addStandalonePathBlock(path, filepath.Join(directory, "bin"), "sh"); err == nil {
		t.Fatal("malformed PATH block was accepted")
	}
	updated, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(updated) != contents {
		t.Fatalf("malformed profile was modified: %q", updated)
	}
}

func TestAddStandalonePathBlockRejectsInvalidUTF16BOM(t *testing.T) {
	for _, data := range [][]byte{{0xff, 0xff}, {0xfe, 0xfe}} {
		path := filepath.Join(t.TempDir(), "profile")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
		if _, _, err := addStandalonePathBlock(path, "/tmp/metakip", "sh"); err == nil {
			t.Fatalf("invalid BOM %x was accepted", data)
		}
		updated, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if string(updated) != string(data) {
			t.Fatalf("invalid-BOM profile was modified: %x", updated)
		}
	}
}

func TestStandaloneFinalizePublishesReceipt(t *testing.T) {
	directory := t.TempDir()
	stateDir := filepath.Join(directory, "state")
	installDir := filepath.Join(directory, "bin")
	t.Setenv("METAKIP_INSTALL_STATE_DIR", stateDir)
	if err := (&StandaloneFinalizeCmd{InstallDir: installDir}).Run(nil); err != nil {
		t.Fatal(err)
	}
	receipt, err := os.ReadFile(filepath.Join(stateDir, "install.json"))
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeInstallReceipt(receipt)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.InstallDir != installDir || decoded.BinaryPath != filepath.Join(installDir, executableName()) {
		t.Fatalf("receipt = %#v", decoded)
	}
}

func TestReplaceStandaloneBinaryRejectsNonRegularDestination(t *testing.T) {
	directory := t.TempDir()
	staged := filepath.Join(directory, "staged")
	destination := filepath.Join(directory, executableName())
	if err := os.WriteFile(staged, []byte("binary"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(destination, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := replaceStandaloneBinary(staged, destination); err == nil {
		t.Fatal("non-regular destination was accepted")
	}
	if _, err := os.Stat(destination); err != nil {
		t.Fatalf("destination was changed: %v", err)
	}
}
