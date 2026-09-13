package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"
)

const (
	maxReleaseArchiveBytes      int64 = 256 << 20
	maxReleaseBinaryBytes       int64 = 128 << 20
	maxReleaseArchiveEntries          = 1024
	maxReleaseZipDirectoryBytes       = 8 << 20
)

var releaseBaseURL = "https://github.com/Metakip/metakip/releases"

func validateReleaseVersion(version string) error {
	if version != "" && !releaseVersionPattern.MatchString(version) {
		return usageError("Version must be a semantic version such as v1.2.3.")
	}
	return nil
}

type updateTarget struct {
	exactVersion string
}

func newUpdateTarget(version string) updateTarget {
	if version == "" {
		return updateTarget{}
	}
	return updateTarget{exactVersion: "v" + strings.TrimPrefix(version, "v")}
}

func (target updateTarget) label() string {
	if target.exactVersion == "" {
		return "latest"
	}
	return target.exactVersion
}

func releaseAssetURL(version, asset string) string {
	if version == "" {
		return releaseBaseURL + "/latest/download/" + asset
	}
	return releaseBaseURL + "/download/cli/v" + strings.TrimPrefix(version, "v") + "/" + asset
}

func releaseArchiveName(version string) string {
	name := "metakip_"
	if version != "" {
		name += strings.TrimPrefix(version, "v") + "_"
	}
	name += runtime.GOOS + "_" + runtime.GOARCH
	if runtime.GOOS == "windows" {
		return name + ".zip"
	}
	return name + ".tar.gz"
}

func downloadReleaseAsset(
	ctx context.Context,
	client *http.Client,
	url string,
	limit int64,
	label string,
	progress updateProgressReporter,
) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create release request: %w", err)
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("download release asset: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("download release asset: unexpected HTTP status %s", response.Status)
	}
	reader := &downloadProgressReader{
		reader:   response.Body,
		total:    response.ContentLength,
		label:    label,
		progress: progress,
	}
	defer progress.finishDownload()
	data, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil {
		return nil, fmt.Errorf("read release asset: %w", err)
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("release asset exceeds %d bytes", limit)
	}
	return data, nil
}

type downloadProgressReader struct {
	reader   io.Reader
	received int64
	total    int64
	label    string
	progress updateProgressReporter
}

func (reader *downloadProgressReader) Read(buffer []byte) (int, error) {
	count, err := reader.reader.Read(buffer)
	reader.received += int64(count)
	if count > 0 {
		reader.progress.download(reader.label, reader.received, reader.total)
	}
	return count, err
}

func expectedReleaseChecksum(checksums []byte, asset string) (string, error) {
	result := ""
	for _, line := range strings.Split(string(checksums), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[1] == asset {
			if len(fields[0]) != 64 {
				return "", fmt.Errorf("checksums.txt contains an invalid SHA-256 value for %s", asset)
			}
			if _, err := hex.DecodeString(fields[0]); err != nil {
				return "", fmt.Errorf("checksums.txt contains an invalid SHA-256 value for %s", asset)
			}
			if result != "" {
				return "", fmt.Errorf("checksums.txt contains multiple entries for %s", asset)
			}
			result = strings.ToLower(fields[0])
		}
	}
	if result != "" {
		return result, nil
	}
	return "", fmt.Errorf("checksums.txt does not contain %s", asset)
}

func extractReleaseBinary(archive []byte, asset, target string) error {
	name := executableName()
	if strings.HasSuffix(asset, ".zip") {
		if err := validateReleaseZipDirectory(archive); err != nil {
			return err
		}
		reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
		if err != nil {
			return fmt.Errorf("open release archive: %w", err)
		}
		var binary *zip.File
		for _, file := range reader.File {
			if file.Name == name {
				if binary != nil {
					return fmt.Errorf("release archive contains multiple %s binaries", name)
				}
				binary = file
			}
		}
		if binary == nil {
			return fmt.Errorf("release archive does not contain %s", name)
		}
		if !binary.FileInfo().Mode().IsRegular() {
			return fmt.Errorf("release archive %s entry is not a regular file", name)
		}
		if binary.UncompressedSize64 > uint64(maxReleaseBinaryBytes) {
			return fmt.Errorf("release binary exceeds %d bytes", maxReleaseBinaryBytes)
		}
		source, err := binary.Open()
		if err != nil {
			return err
		}
		defer source.Close()
		return writeStagedBinary(source, target)
	}
	gzipReader, err := gzip.NewReader(bytes.NewReader(archive))
	if err != nil {
		return fmt.Errorf("open release archive: %w", err)
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(&boundedReleaseReader{reader: gzipReader, limit: maxReleaseArchiveBytes})
	found := false
	entries := 0
	var declaredBytes int64
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("read release archive: %w", err)
		}
		entries++
		if entries > maxReleaseArchiveEntries {
			return fmt.Errorf("release archive contains more than %d entries", maxReleaseArchiveEntries)
		}
		if header.Size < 0 || header.Size > maxReleaseArchiveBytes-declaredBytes {
			return fmt.Errorf("release archive decompressed contents exceed %d bytes", maxReleaseArchiveBytes)
		}
		declaredBytes += header.Size
		if strings.TrimPrefix(header.Name, "./") == name {
			if header.Typeflag != tar.TypeReg {
				return fmt.Errorf("release archive %s entry is not a regular file", name)
			}
			if found {
				return fmt.Errorf("release archive contains multiple %s binaries", name)
			}
			if header.Size > maxReleaseBinaryBytes {
				return fmt.Errorf("release binary exceeds %d bytes", maxReleaseBinaryBytes)
			}
			if err := writeStagedBinary(tarReader, target); err != nil {
				return err
			}
			found = true
		}
	}
	if !found {
		return fmt.Errorf("release archive does not contain %s", name)
	}
	return nil
}

func validateReleaseZipDirectory(archive []byte) error {
	const (
		endSignature     = 0x06054b50
		endMinimumLength = 22
		endMaximumLength = endMinimumLength + 0xffff
		directorySig     = 0x02014b50
		directoryHeader  = 46
	)
	start := len(archive) - endMaximumLength
	if start < 0 {
		start = 0
	}
	for offset := len(archive) - endMinimumLength; offset >= start; offset-- {
		if binary.LittleEndian.Uint32(archive[offset:]) != endSignature {
			continue
		}
		commentLength := int(binary.LittleEndian.Uint16(archive[offset+20:]))
		if offset+endMinimumLength+commentLength != len(archive) {
			continue
		}
		entries := binary.LittleEndian.Uint16(archive[offset+10:])
		directorySize := binary.LittleEndian.Uint32(archive[offset+12:])
		directoryOffset := binary.LittleEndian.Uint32(archive[offset+16:])
		if entries == 0xffff || directorySize == 0xffffffff || directoryOffset == 0xffffffff {
			return fmt.Errorf("release ZIP archive uses unsupported ZIP64 metadata")
		}
		if entries > maxReleaseArchiveEntries {
			return fmt.Errorf("release ZIP archive contains more than %d entries", maxReleaseArchiveEntries)
		}
		if directorySize > maxReleaseZipDirectoryBytes {
			return fmt.Errorf("release ZIP central directory exceeds %d bytes", maxReleaseZipDirectoryBytes)
		}
		end := uint64(directoryOffset) + uint64(directorySize)
		if end > uint64(offset) {
			return fmt.Errorf("release ZIP central directory is invalid")
		}
		position := int(directoryOffset)
		directoryEnd := position + int(directorySize)
		for entry := uint16(0); entry < entries; entry++ {
			if position+directoryHeader > directoryEnd || binary.LittleEndian.Uint32(archive[position:]) != directorySig {
				return fmt.Errorf("release ZIP central directory is invalid")
			}
			nameLength := int(binary.LittleEndian.Uint16(archive[position+28:]))
			extraLength := int(binary.LittleEndian.Uint16(archive[position+30:]))
			commentLength := int(binary.LittleEndian.Uint16(archive[position+32:]))
			position += directoryHeader + nameLength + extraLength + commentLength
			if position > directoryEnd {
				return fmt.Errorf("release ZIP central directory is invalid")
			}
		}
		if position != directoryEnd {
			return fmt.Errorf("release ZIP central directory is invalid")
		}
		return nil
	}
	return fmt.Errorf("release ZIP end record is missing")
}

type boundedReleaseReader struct {
	reader io.Reader
	limit  int64
}

func (reader *boundedReleaseReader) Read(buffer []byte) (int, error) {
	if reader.limit < 0 {
		return 0, fmt.Errorf("release archive decompressed contents exceed %d bytes", maxReleaseArchiveBytes)
	}
	if int64(len(buffer)) > reader.limit+1 {
		buffer = buffer[:reader.limit+1]
	}
	read, err := reader.reader.Read(buffer)
	reader.limit -= int64(read)
	if reader.limit < 0 {
		return read, fmt.Errorf("release archive decompressed contents exceed %d bytes", maxReleaseArchiveBytes)
	}
	return read, err
}

func writeStagedBinary(source io.Reader, target string) error {
	file, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	written, copyErr := io.Copy(file, io.LimitReader(source, maxReleaseBinaryBytes+1))
	closeErr := file.Close()
	if copyErr != nil {
		return copyErr
	}
	if written > maxReleaseBinaryBytes {
		return fmt.Errorf("release binary exceeds %d bytes", maxReleaseBinaryBytes)
	}
	return closeErr
}

type updateOutcome struct {
	Updated   bool         `json:"updated"`
	Scheduled bool         `json:"scheduled"`
	Status    updateStatus `json:"status"`
	Target    string       `json:"target"`
	// Version is the exact requested version and is omitted for the latest channel.
	Version string `json:"version,omitempty"`
}

type updateStatus string

const (
	updateStatusUpToDate  updateStatus = "up_to_date"
	updateStatusUpdated   updateStatus = "updated"
	updateStatusScheduled updateStatus = "scheduled"
)

func updateOutcomeText(status updateStatus, target string) (string, error) {
	switch status {
	case updateStatusScheduled:
		return fmt.Sprintf("Metakip update to %s is scheduled and will finish after this command exits.", target), nil
	case updateStatusUpdated:
		return fmt.Sprintf("Metakip updated to %s.", target), nil
	case updateStatusUpToDate:
		return fmt.Sprintf("Metakip is already up to date: %s.", target), nil
	default:
		return "", fmt.Errorf("unknown standalone update status %q", status)
	}
}

func newUpdateOutcome(status updateStatus, target updateTarget) updateOutcome {
	return updateOutcome{
		Updated:   status == updateStatusUpdated,
		Scheduled: status == updateStatusScheduled,
		Status:    status,
		Target:    target.label(),
		Version:   target.exactVersion,
	}
}

func updateStandalone(ctx context.Context, receipt installReceipt, version string, client *http.Client) (updateOutcome, error) {
	return updateStandaloneWithProgress(ctx, receipt, version, client, noOpUpdateProgress{})
}

func updateStandaloneWithProgress(
	ctx context.Context,
	receipt installReceipt,
	version string,
	client *http.Client,
	progress updateProgressReporter,
) (updateOutcome, error) {
	if err := checkDeferredUpdateFailure(); err != nil {
		return updateOutcome{}, err
	}
	if err := validateReleaseVersion(version); err != nil {
		return updateOutcome{}, err
	}
	asset := releaseArchiveName(version)
	target := newUpdateTarget(version)
	if target.exactVersion == "" {
		progress.phase("Checking for the latest Metakip release...")
	} else {
		progress.phase("Checking for Metakip " + target.exactVersion + "...")
	}
	progress.phase("Downloading checksums.txt...")
	checksums, err := downloadReleaseAsset(
		ctx,
		client,
		releaseAssetURL(version, "checksums.txt"),
		1<<20,
		"checksums.txt",
		progress,
	)
	if err != nil {
		return updateOutcome{}, err
	}
	progress.phase("Downloaded checksums.txt.")
	expected, err := expectedReleaseChecksum(checksums, asset)
	if err != nil {
		return updateOutcome{}, err
	}
	progress.phase("Downloading the Metakip update...")
	archive, err := downloadReleaseAsset(
		ctx,
		client,
		releaseAssetURL(version, asset),
		maxReleaseArchiveBytes,
		asset,
		progress,
	)
	if err != nil {
		return updateOutcome{}, err
	}
	progress.phase("Downloaded the Metakip update.")
	actual := fmt.Sprintf("%x", sha256.Sum256(archive))
	if actual != expected {
		return updateOutcome{}, fmt.Errorf("SHA-256 verification failed for %s", asset)
	}
	progress.phase("Verified the Metakip update.")
	staged, err := os.CreateTemp(receipt.InstallDir, ".metakip-update-*")
	if err != nil {
		return updateOutcome{}, fmt.Errorf("create staged binary: %w", err)
	}
	stagedPath := staged.Name()
	if err := staged.Close(); err != nil {
		os.Remove(stagedPath)
		return updateOutcome{}, err
	}
	if err := os.Remove(stagedPath); err != nil {
		return updateOutcome{}, err
	}
	if err := extractReleaseBinary(archive, asset, stagedPath); err != nil {
		os.Remove(stagedPath)
		return updateOutcome{}, err
	}
	identical, err := binariesMatch(receipt.BinaryPath, stagedPath)
	if err != nil {
		os.Remove(stagedPath)
		return updateOutcome{}, err
	}
	if identical {
		os.Remove(stagedPath)
		return newUpdateOutcome(updateStatusUpToDate, target), nil
	}
	progress.phase("Installing the Metakip update...")
	deferred, err := replaceUpdatedBinary(receipt.BinaryPath, stagedPath)
	if err != nil {
		os.Remove(stagedPath)
		return updateOutcome{}, err
	}
	if !deferred {
		os.Remove(stagedPath)
	}
	if deferred {
		return newUpdateOutcome(updateStatusScheduled, target), nil
	}
	return newUpdateOutcome(updateStatusUpdated, target), nil
}

func binariesMatch(leftPath, rightPath string) (bool, error) {
	leftInfo, err := os.Stat(leftPath)
	if err != nil {
		return false, fmt.Errorf("read installed binary: %w", err)
	}
	rightInfo, err := os.Stat(rightPath)
	if err != nil {
		return false, fmt.Errorf("read staged binary: %w", err)
	}
	if leftInfo.Size() != rightInfo.Size() {
		return false, nil
	}
	left, err := os.Open(leftPath)
	if err != nil {
		return false, fmt.Errorf("open installed binary: %w", err)
	}
	defer left.Close()
	right, err := os.Open(rightPath)
	if err != nil {
		return false, fmt.Errorf("open staged binary: %w", err)
	}
	defer right.Close()

	const bufferSize = 32 * 1024
	leftBuffer := make([]byte, bufferSize)
	rightBuffer := make([]byte, bufferSize)
	for {
		leftCount, leftErr := io.ReadFull(left, leftBuffer)
		rightCount, rightErr := io.ReadFull(right, rightBuffer)
		if leftErr != nil && !errors.Is(leftErr, io.EOF) && !errors.Is(leftErr, io.ErrUnexpectedEOF) {
			return false, fmt.Errorf("read installed binary: %w", leftErr)
		}
		if rightErr != nil && !errors.Is(rightErr, io.EOF) && !errors.Is(rightErr, io.ErrUnexpectedEOF) {
			return false, fmt.Errorf("read staged binary: %w", rightErr)
		}
		if leftCount != rightCount || !bytes.Equal(leftBuffer[:leftCount], rightBuffer[:rightCount]) {
			return false, nil
		}
		leftDone := errors.Is(leftErr, io.EOF) || errors.Is(leftErr, io.ErrUnexpectedEOF)
		rightDone := errors.Is(rightErr, io.EOF) || errors.Is(rightErr, io.ErrUnexpectedEOF)
		if leftDone || rightDone {
			return leftDone && rightDone, nil
		}
	}
}
