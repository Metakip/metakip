package main

import (
	"bytes"
	"fmt"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
)

const maxImageUploadBytes = 10 * 1024 * 1024

type UploadImageCmd struct {
	Path           string `arg:"" name:"file" help:"JPEG, PNG, GIF, or WebP image to upload." type:"existingfile"`
	Page           string `required:"" help:"Page ID or exact title." placeholder:"PAGE"`
	Alt            string `help:"Alternative text used in the returned Markdown." placeholder:"TEXT"`
	IdempotencyKey string `help:"Safe-retry key for this request." placeholder:"KEY"`
}

type uploadedImage struct {
	ID           string `json:"id"`
	URL          string `json:"url"`
	Markdown     string `json:"markdown"`
	Filename     string `json:"filename"`
	OriginalName string `json:"originalName"`
	MIMEType     string `json:"mimeType"`
	Size         int64  `json:"size"`
}

func imageMIMEType(path string) (string, error) {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".jpg", ".jpeg":
		return "image/jpeg", nil
	case ".png":
		return "image/png", nil
	case ".gif":
		return "image/gif", nil
	case ".webp":
		return "image/webp", nil
	default:
		return "", usageError("Image must be a JPEG, PNG, GIF, or WebP file.")
	}
}

func (cmd *UploadImageCmd) Run(r *runtimeState) error {
	selected, err := r.resolvePage(cmd.Page)
	if err != nil {
		return err
	}
	info, err := os.Stat(cmd.Path)
	if err != nil {
		return err
	}
	if info.Size() > maxImageUploadBytes {
		return usageError("Image must be 10MB or less.")
	}
	mimeType, err := imageMIMEType(cmd.Path)
	if err != nil {
		return err
	}
	content, err := os.ReadFile(cmd.Path)
	if err != nil {
		return err
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{
		"name":     "file",
		"filename": filepath.Base(cmd.Path),
	}))
	header.Set("Content-Type", mimeType)
	part, err := writer.CreatePart(header)
	if err != nil {
		return err
	}
	if _, err := part.Write(content); err != nil {
		return err
	}
	if cmd.Alt != "" {
		if err := writer.WriteField("alt", cmd.Alt); err != nil {
			return err
		}
	}
	if err := writer.Close(); err != nil {
		return err
	}
	key := strings.TrimSpace(cmd.IdempotencyKey)
	if key == "" {
		key, err = randomRequestID()
		if err != nil {
			return err
		}
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	response, err := c.request(
		http.MethodPost,
		fmt.Sprintf("/pages/%s/images", selected.ID),
		body.Bytes(),
		map[string]string{
			"Content-Type":    writer.FormDataContentType(),
			"Idempotency-Key": key,
		},
	)
	if err != nil {
		return uncertainUploadOutcome(err, key)
	}
	var result uploadedImage
	if err := decodeJSON(response, &result); err != nil {
		return uncertainUploadOutcome(err, key)
	}
	if r.cli.JSON {
		return r.printJSON(result)
	}
	_, err = fmt.Fprintln(r.stdout, result.Markdown)
	return err
}

func uncertainUploadOutcome(err error, idempotencyKey string) error {
	return uncertainMutationOutcome(
		err,
		"",
		idempotencyKey,
		"upload_outcome_uncertain",
		"The image upload may have succeeded. Retry the same upload with the reported idempotency key",
	)
}
