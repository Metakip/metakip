package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type failingProgressWriter struct{}

func (failingProgressWriter) Write([]byte) (int, error) {
	return 0, fmt.Errorf("progress output is closed")
}

type recordingUpdateProgress struct {
	messages    []string
	downloads   []downloadSnapshot
	finishCount int
}

func (progress *recordingUpdateProgress) phase(message string) {
	progress.messages = append(progress.messages, message)
}

func (progress *recordingUpdateProgress) download(label string, received, total int64) {
	progress.downloads = append(progress.downloads, downloadSnapshot{label: label, received: received, total: total})
}

func (progress *recordingUpdateProgress) finishDownload() { progress.finishCount++ }

func TestDownloadProgressReaderSkipsEmptyReads(t *testing.T) {
	progress := &recordingUpdateProgress{}
	reader := &downloadProgressReader{
		reader:   strings.NewReader("release asset"),
		total:    int64(len("release asset")),
		label:    "asset.tar.gz",
		progress: progress,
	}
	buffer := make([]byte, 32)
	if _, err := reader.Read(buffer); err != nil {
		t.Fatal(err)
	}
	if _, err := reader.Read(buffer); err != io.EOF {
		t.Fatalf("empty read error = %v, want EOF", err)
	}
	if len(progress.downloads) != 1 {
		t.Fatalf("download updates = %d, want 1", len(progress.downloads))
	}
}

func TestUpdateOutcomeJSONIncludesStatusAndTarget(t *testing.T) {
	cases := []struct {
		status         updateStatus
		version        string
		versionPresent bool
		target         string
		updated        bool
		scheduled      bool
	}{
		{status: updateStatusUpToDate, version: "v1.2.3", versionPresent: true, target: "v1.2.3"},
		{status: updateStatusUpdated, version: "v1.2.3", versionPresent: true, target: "v1.2.3", updated: true},
		{status: updateStatusScheduled, version: "v1.2.3", versionPresent: true, target: "v1.2.3", scheduled: true},
		{status: updateStatusUpdated, target: "latest", updated: true},
	}
	for _, testCase := range cases {
		t.Run(string(testCase.status), func(t *testing.T) {
			data, err := json.Marshal(newUpdateOutcome(testCase.status, newUpdateTarget(testCase.version)))
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]json.RawMessage
			if err := json.Unmarshal(data, &fields); err != nil {
				t.Fatal(err)
			}
			status, ok := fields["status"]
			if !ok {
				t.Fatalf("JSON result omitted status: %s", data)
			}
			var actualStatus updateStatus
			if err := json.Unmarshal(status, &actualStatus); err != nil {
				t.Fatal(err)
			}
			if actualStatus != testCase.status {
				t.Fatalf("status = %q, want %q", actualStatus, testCase.status)
			}
			var actualTarget string
			if err := json.Unmarshal(fields["target"], &actualTarget); err != nil {
				t.Fatal(err)
			}
			if actualTarget != testCase.target {
				t.Fatalf("target = %q, want %q", actualTarget, testCase.target)
			}
			version, present := fields["version"]
			if present != testCase.versionPresent {
				t.Fatalf("version field present = %t, want %t", present, testCase.versionPresent)
			}
			if present {
				var actualVersion string
				if err := json.Unmarshal(version, &actualVersion); err != nil {
					t.Fatal(err)
				}
				if actualVersion != testCase.version {
					t.Fatalf("version = %q, want %q", actualVersion, testCase.version)
				}
			}
			var result updateOutcome
			if err := json.Unmarshal(data, &result); err != nil {
				t.Fatal(err)
			}
			if result.Updated != testCase.updated || result.Scheduled != testCase.scheduled {
				t.Fatalf("compatibility fields = %#v, want updated=%t scheduled=%t", result, testCase.updated, testCase.scheduled)
			}
		})
	}
}

func TestUpdateTargetDistinguishesLatestFromPinnedVersion(t *testing.T) {
	if got := newUpdateTarget("").label(); got != "latest" {
		t.Fatalf("latest target = %q, want latest", got)
	}
	if got := newUpdateTarget("1.2.3").label(); got != "v1.2.3" {
		t.Fatalf("pinned target = %q, want v1.2.3", got)
	}
}

func TestUpdateOutcomeTextReportsLatestFallback(t *testing.T) {
	target := newUpdateTarget("").label()
	cases := []struct {
		status updateStatus
		want   string
	}{
		{updateStatusUpdated, "Metakip updated to latest."},
		{updateStatusScheduled, "Metakip update to latest is scheduled and will finish after this command exits."},
		{updateStatusUpToDate, "Metakip is already up to date: latest."},
	}
	for _, testCase := range cases {
		t.Run(string(testCase.status), func(t *testing.T) {
			got, err := updateOutcomeText(testCase.status, target)
			if err != nil {
				t.Fatal(err)
			}
			if got != testCase.want {
				t.Fatalf("outcome text = %q, want %q", got, testCase.want)
			}
		})
	}
	pinned, err := updateOutcomeText(updateStatusUpdated, newUpdateTarget("v1.2.3").label())
	if err != nil {
		t.Fatal(err)
	}
	if pinned != "Metakip updated to v1.2.3." {
		t.Fatalf("pinned outcome text = %q", pinned)
	}
}

func TestDownloadReleaseAssetFollowsRedirects(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/Metakip/metakip/releases/latest/download/asset.tar.gz" {
			http.Redirect(response, request, "/Metakip/metakip/releases/download/cli/v1.2.3/asset.tar.gz", http.StatusFound)
			return
		}
		if request.URL.Path == "/Metakip/metakip/releases/download/cli/v1.2.3/asset.tar.gz" {
			http.Redirect(response, request, "/objects.githubusercontent.com/github-production-release-asset/asset.tar.gz", http.StatusFound)
			return
		}
		if request.URL.Path == "/objects.githubusercontent.com/github-production-release-asset/asset.tar.gz" {
			_, _ = response.Write([]byte("release asset"))
			return
		}
		http.NotFound(response, request)
	}))
	t.Cleanup(server.Close)
	asset, err := downloadReleaseAsset(
		context.Background(),
		server.Client(),
		server.URL+"/Metakip/metakip/releases/latest/download/asset.tar.gz",
		1024,
		"asset.tar.gz",
		noOpUpdateProgress{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if string(asset) != "release asset" {
		t.Fatalf("downloaded asset = %q", asset)
	}
}

func TestUpdateProgressRendererIgnoresWriteErrors(t *testing.T) {
	progress := &updateProgressRenderer{writer: failingProgressWriter{}, marker: "==>"}
	progress.phase("Downloading release...")
}

func TestUpdateProgressRendererUsesPhaseOutput(t *testing.T) {
	output := &bytes.Buffer{}
	renderer := &updateProgressRenderer{writer: output, marker: "==>"}
	renderer.phase("Downloading asset.tar.gz...")
	if output.String() != "==> Downloading asset.tar.gz...\n" {
		t.Fatalf("progress output = %q", output.String())
	}
}

func TestUpdateProgressRendererShowsDownloadProgress(t *testing.T) {
	output := &bytes.Buffer{}
	renderer := &updateProgressRenderer{writer: output, marker: "==>"}
	renderer.download("asset.tar.gz", 50, 100)
	renderer.finishDownload()
	if output.String() != "\r\033[2K==> asset.tar.gz 50% (50/100 bytes)\n" {
		t.Fatalf("download progress output = %q", output.String())
	}
}

func TestUpdateProgressRendererFlushesUnknownLengthDownload(t *testing.T) {
	output := &bytes.Buffer{}
	renderer := &updateProgressRenderer{writer: output, marker: "==>"}
	renderer.download("asset.tar.gz", 50, 0)
	renderer.download("asset.tar.gz", 100, 0)
	renderer.finishDownload()
	if output.String() != "\r\033[2K==> asset.tar.gz 50 bytes\r\033[2K==> asset.tar.gz 100 bytes\n" {
		t.Fatalf("download progress output = %q", output.String())
	}
}

func TestBinariesMatchStreamsContents(t *testing.T) {
	directory := t.TempDir()
	leftPath := filepath.Join(directory, "left")
	rightPath := filepath.Join(directory, "right")
	payload := bytes.Repeat([]byte("metakip"), 8192)
	if err := os.WriteFile(leftPath, payload, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(rightPath, payload, 0o755); err != nil {
		t.Fatal(err)
	}
	match, err := binariesMatch(leftPath, rightPath)
	if err != nil {
		t.Fatal(err)
	}
	if !match {
		t.Fatal("identical binaries did not match")
	}
	if err := os.WriteFile(rightPath, append(payload, '!'), 0o755); err != nil {
		t.Fatal(err)
	}
	match, err = binariesMatch(leftPath, rightPath)
	if err != nil {
		t.Fatal(err)
	}
	if match {
		t.Fatal("different binaries matched")
	}
}

func TestExtractReleaseBinaryAcceptsDotSlashTarPath(t *testing.T) {
	var archive bytes.Buffer
	gzipWriter := gzip.NewWriter(&archive)
	tarWriter := tar.NewWriter(gzipWriter)
	payload := []byte("metakip binary")
	if err := tarWriter.WriteHeader(&tar.Header{Name: "./" + executableName(), Mode: 0o755, Size: int64(len(payload)), Typeflag: tar.TypeReg}); err != nil {
		t.Fatal(err)
	}
	if _, err := tarWriter.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), executableName())
	if err := extractReleaseBinary(archive.Bytes(), "metakip_linux_amd64.tar.gz", target); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(payload) {
		t.Fatalf("extracted binary = %q", actual)
	}
}

func TestUpdateStandaloneVerifiesAndReplacesBinary(t *testing.T) {
	if executableName() != "metakip" {
		t.Skip("Unix replacement is covered by this test")
	}
	archive := releaseTarball(t, "./metakip", []byte("new binary"))
	checksum := fmt.Sprintf("%x", sha256.Sum256(archive))
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/latest/download/checksums.txt":
			http.Redirect(response, request, "/releases/download/cli/v1.2.3/checksums.txt", http.StatusFound)
		case "/latest/download/metakip_" + runtime.GOOS + "_" + runtime.GOARCH + ".tar.gz":
			http.Redirect(response, request, "/releases/download/cli/v1.2.3/metakip_"+runtime.GOOS+"_"+runtime.GOARCH+".tar.gz", http.StatusFound)
		case "/releases/download/cli/v1.2.3/checksums.txt":
			http.Redirect(response, request, "/objects.githubusercontent.com/github-production-release-asset/checksums.txt", http.StatusFound)
		case "/releases/download/cli/v1.2.3/metakip_" + runtime.GOOS + "_" + runtime.GOARCH + ".tar.gz":
			http.Redirect(response, request, "/objects.githubusercontent.com/github-production-release-asset/metakip_"+runtime.GOOS+"_"+runtime.GOARCH+".tar.gz", http.StatusFound)
		case "/objects.githubusercontent.com/github-production-release-asset/checksums.txt":
			_, _ = fmt.Fprintf(response, "%s  metakip_%s_%s.tar.gz\n", checksum, runtime.GOOS, runtime.GOARCH)
		case "/objects.githubusercontent.com/github-production-release-asset/metakip_" + runtime.GOOS + "_" + runtime.GOARCH + ".tar.gz":
			_, _ = response.Write(archive)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()
	previousBaseURL := releaseBaseURL
	releaseBaseURL = server.URL
	t.Cleanup(func() { releaseBaseURL = previousBaseURL })
	installDir := t.TempDir()
	binaryPath := filepath.Join(installDir, executableName())
	if err := os.WriteFile(binaryPath, []byte("old binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	receipt := installReceipt{InstallDir: installDir, BinaryPath: binaryPath}
	progress := &recordingUpdateProgress{}
	outcome, err := updateStandaloneWithProgress(context.Background(), receipt, "", server.Client(), progress)
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Status == updateStatusScheduled {
		t.Fatal("Unix update was deferred")
	}
	if outcome.Status != updateStatusUpdated {
		t.Fatal("Unix update was not applied")
	}
	if outcome.Version != "" || outcome.Target != "latest" {
		t.Fatalf("latest update returned unexpected target %#v", outcome)
	}
	wantPhases := []string{
		"Checking for the latest Metakip release...",
		"Downloading checksums.txt...",
		"Downloaded checksums.txt.",
		"Downloading the Metakip update...",
		"Downloaded the Metakip update.",
		"Verified the Metakip update.",
		"Installing the Metakip update...",
	}
	if strings.Join(progress.messages, "\n") != strings.Join(wantPhases, "\n") {
		t.Fatalf("update phases = %#v, want %#v", progress.messages, wantPhases)
	}
	labels := make(map[string]bool)
	for _, download := range progress.downloads {
		labels[download.label] = true
		if download.received <= 0 {
			t.Fatalf("download callback reported no bytes: %#v", download)
		}
	}
	if !labels["checksums.txt"] || !labels[releaseArchiveName("")] {
		t.Fatalf("download callbacks omitted an asset: %#v", progress.downloads)
	}
	if progress.finishCount != 2 {
		t.Fatalf("download finalization count = %d, want 2", progress.finishCount)
	}
	contents, err := os.ReadFile(binaryPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "new binary" {
		t.Fatalf("updated binary = %q", contents)
	}
	outcome, err = updateStandalone(context.Background(), receipt, "", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Status != updateStatusUpToDate {
		t.Fatalf("identical update was applied: %#v", outcome)
	}
}

func TestUpdateStandaloneAllowsUnknownDownloadedReleaseVersion(t *testing.T) {
	if executableName() != "metakip" {
		t.Skip("Unix replacement is covered by this test")
	}
	archive := releaseTarball(t, "./"+executableName(), []byte("new binary"))
	checksum := fmt.Sprintf("%x", sha256.Sum256(archive))
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/latest/download/checksums.txt":
			_, _ = fmt.Fprintf(response, "%s  %s\n", checksum, releaseArchiveName(""))
		case "/latest/download/" + releaseArchiveName(""):
			_, _ = response.Write(archive)
		default:
			http.NotFound(response, request)
		}
	}))
	t.Cleanup(server.Close)
	previousBaseURL := releaseBaseURL
	releaseBaseURL = server.URL
	t.Cleanup(func() { releaseBaseURL = previousBaseURL })
	installDir := t.TempDir()
	binaryPath := filepath.Join(installDir, executableName())
	if err := os.WriteFile(binaryPath, []byte("old binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	outcome, err := updateStandalone(context.Background(), installReceipt{InstallDir: installDir, BinaryPath: binaryPath}, "", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Status != updateStatusUpdated || outcome.Version != "" || outcome.Target != "latest" {
		t.Fatalf("unexpected update outcome: %#v", outcome)
	}
	contents, err := os.ReadFile(binaryPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "new binary" {
		t.Fatalf("updated binary = %q", contents)
	}
}

func TestUpdateStandaloneRejectsChecksumMismatch(t *testing.T) {
	archive := []byte("not an archive")
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/latest/download/checksums.txt" {
			_, _ = fmt.Fprintf(response, "%064d  %s\n", 0, releaseArchiveName(""))
			return
		}
		_, _ = response.Write(archive)
	}))
	defer server.Close()
	previousBaseURL := releaseBaseURL
	releaseBaseURL = server.URL
	t.Cleanup(func() { releaseBaseURL = previousBaseURL })
	_, err := updateStandalone(context.Background(), installReceipt{InstallDir: t.TempDir(), BinaryPath: filepath.Join(t.TempDir(), executableName())}, "", server.Client())
	if err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Fatalf("expected checksum failure, got %v", err)
	}
}

func TestExpectedReleaseChecksumRejectsDuplicateAndMalformedEntries(t *testing.T) {
	asset := "metakip_linux_amd64.tar.gz"
	valid := strings.Repeat("a", 64)
	if _, err := expectedReleaseChecksum([]byte(valid+"  "+asset+"\n"+valid+"  "+asset+"\n"), asset); err == nil || !strings.Contains(err.Error(), "multiple") {
		t.Fatalf("expected duplicate checksum failure, got %v", err)
	}
	if _, err := expectedReleaseChecksum([]byte(strings.Repeat("z", 64)+"  "+asset+"\n"), asset); err == nil || !strings.Contains(err.Error(), "invalid") {
		t.Fatalf("expected malformed checksum failure, got %v", err)
	}
}

func TestExtractReleaseBinaryAcceptsZipBinary(t *testing.T) {
	var archive bytes.Buffer
	zipWriter := zip.NewWriter(&archive)
	file, err := zipWriter.Create(executableName())
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte("windows binary")
	if _, err := file.Write(payload); err != nil {
		t.Fatal(err)
	}
	if err := zipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), executableName())
	if err := extractReleaseBinary(archive.Bytes(), "metakip_windows_amd64.zip", target); err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(actual) != string(payload) {
		t.Fatalf("extracted binary = %q", actual)
	}
}

func TestExtractReleaseBinaryRejectsDuplicateZipBinary(t *testing.T) {
	var archive bytes.Buffer
	zipWriter := zip.NewWriter(&archive)
	for range 2 {
		file, err := zipWriter.Create(executableName())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte("windows binary")); err != nil {
			t.Fatal(err)
		}
	}
	if err := zipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	err := extractReleaseBinary(archive.Bytes(), "metakip_windows_amd64.zip", filepath.Join(t.TempDir(), executableName()))
	if err == nil || !strings.Contains(err.Error(), "multiple") {
		t.Fatalf("expected duplicate binary failure, got %v", err)
	}
}

func TestExtractReleaseBinaryRejectsZipWithTooManyEntries(t *testing.T) {
	var archive bytes.Buffer
	zipWriter := zip.NewWriter(&archive)
	for index := 0; index <= maxReleaseArchiveEntries; index++ {
		if _, err := zipWriter.Create(fmt.Sprintf("entry-%d", index)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	err := extractReleaseBinary(archive.Bytes(), "metakip_windows_amd64.zip", filepath.Join(t.TempDir(), executableName()))
	if err == nil || !strings.Contains(err.Error(), "entries") {
		t.Fatalf("expected ZIP entry limit failure, got %v", err)
	}
}

func TestExtractReleaseBinaryRejectsDuplicateTarBinary(t *testing.T) {
	archive := releaseTarballEntries(t, []string{executableName(), "./" + executableName()}, []byte("metakip binary"))
	err := extractReleaseBinary(archive, "metakip_linux_amd64.tar.gz", filepath.Join(t.TempDir(), executableName()))
	if err == nil || !strings.Contains(err.Error(), "multiple") {
		t.Fatalf("expected duplicate binary failure, got %v", err)
	}
}

func TestExtractReleaseBinaryRejectsOversizedTarBinary(t *testing.T) {
	var archive bytes.Buffer
	gzipWriter := gzip.NewWriter(&archive)
	tarWriter := tar.NewWriter(gzipWriter)
	if err := tarWriter.WriteHeader(&tar.Header{Name: executableName(), Mode: 0o755, Size: maxReleaseBinaryBytes + 1, Typeflag: tar.TypeReg}); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err == nil {
		t.Fatal("tar writer accepted missing oversized payload")
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), executableName())
	err := extractReleaseBinary(archive.Bytes(), "metakip_linux_amd64.tar.gz", target)
	if err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("expected oversized binary failure, got %v", err)
	}
}

func TestExtractReleaseBinaryRejectsTarWithTooManyEntries(t *testing.T) {
	names := make([]string, maxReleaseArchiveEntries+1)
	for index := range names {
		names[index] = fmt.Sprintf("entry-%d", index)
	}
	archive := releaseTarballEntries(t, names, nil)
	err := extractReleaseBinary(archive, "metakip_linux_amd64.tar.gz", filepath.Join(t.TempDir(), executableName()))
	if err == nil || !strings.Contains(err.Error(), "entries") {
		t.Fatalf("expected archive entry limit failure, got %v", err)
	}
}

func TestExtractReleaseBinaryRejectsOversizedTarContents(t *testing.T) {
	var archive bytes.Buffer
	gzipWriter := gzip.NewWriter(&archive)
	tarWriter := tar.NewWriter(gzipWriter)
	if err := tarWriter.WriteHeader(&tar.Header{Name: "payload", Mode: 0o644, Size: maxReleaseArchiveBytes + 1, Typeflag: tar.TypeReg}); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err == nil {
		t.Fatal("tar writer accepted missing oversized payload")
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	err := extractReleaseBinary(archive.Bytes(), "metakip_linux_amd64.tar.gz", filepath.Join(t.TempDir(), executableName()))
	if err == nil || !strings.Contains(err.Error(), "decompressed") {
		t.Fatalf("expected decompressed contents failure, got %v", err)
	}
}

func releaseTarball(t *testing.T, name string, payload []byte) []byte {
	return releaseTarballEntries(t, []string{name}, payload)
}

func releaseTarballEntries(t *testing.T, names []string, payload []byte) []byte {
	t.Helper()
	var result bytes.Buffer
	gzipWriter := gzip.NewWriter(&result)
	tarWriter := tar.NewWriter(gzipWriter)
	for _, name := range names {
		if err := tarWriter.WriteHeader(&tar.Header{Name: name, Mode: 0o755, Size: int64(len(payload)), Typeflag: tar.TypeReg}); err != nil {
			t.Fatal(err)
		}
		if _, err := tarWriter.Write(payload); err != nil {
			t.Fatal(err)
		}
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	return result.Bytes()
}
