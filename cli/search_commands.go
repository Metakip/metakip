package main

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/lipgloss/table"
)

var searchMatchStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("11"))

type SearchCmd struct {
	Query string `arg:"" name:"query" help:"Text to search for in page titles, Markdown bodies, and folder names."`
}

func (cmd *SearchCmd) Run(r *runtimeState) error {
	query := strings.TrimSpace(cmd.Query)
	if query == "" {
		return usageError("A search query is required.")
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	results, err := c.search(query)
	if err != nil {
		return err
	}
	return renderSearchResults(r, results)
}

func renderSearchResults(r *runtimeState, results []searchResult) error {
	if r.cli.JSON {
		return r.printJSON(results)
	}
	if len(results) == 0 {
		_, err := fmt.Fprintln(r.stdout, "No matching pages or folders found.")
		return err
	}
	if !r.stdoutTTY || r.cli.Plain {
		for _, result := range results {
			if _, err := fmt.Fprintf(
				r.stdout,
				"%s\t%s\t%s\t%s\t%s\t%s\n",
				terminalText(result.Type),
				renderSearchText(r, result.displayName(), result.TitleMatches),
				terminalText(result.FolderPath),
				terminalText(result.ID),
				terminalText(valueOrEmpty(result.Icon)),
				result.snippetText(r),
			); err != nil {
				return err
			}
		}
		return nil
	}
	rows := make([][]string, 0, len(results))
	for _, result := range results {
		rows = append(rows, []string{
			terminalText(result.Type),
			renderSearchText(r, result.displayName(), result.TitleMatches),
			terminalText(result.FolderPath),
			r.style(dimStyle, terminalText(result.ID)),
			terminalText(valueOrEmpty(result.Icon)),
			result.snippetText(r),
		})
	}
	resultTable := table.New().Headers("TYPE", "NAME", "PATH", "ID", "ICON", "SNIPPET").Rows(rows...).Border(lipgloss.HiddenBorder())
	_, err := fmt.Fprintln(r.stdout, resultTable.Render())
	return err
}

func (result searchResult) snippetText(r *runtimeState) string {
	if result.Snippet == nil {
		return ""
	}
	return renderSearchText(r, result.Snippet.Text, result.Snippet.Matches)
}

func renderSearchText(r *runtimeState, text string, matches []searchTextMatch) string {
	if len(matches) == 0 {
		return terminalText(text)
	}

	var rendered strings.Builder
	cursor := 0
	for _, match := range matches {
		start := utf16ByteOffset(text, match.Start)
		end := utf16ByteOffset(text, match.End)
		if start < cursor || end <= start {
			continue
		}
		rendered.WriteString(terminalText(text[cursor:start]))
		rendered.WriteString(r.style(searchMatchStyle, terminalText(text[start:end])))
		cursor = end
	}
	rendered.WriteString(terminalText(text[cursor:]))
	return rendered.String()
}

// Search match offsets are UTF-16 code units from the JavaScript API.
func utf16ByteOffset(text string, offset int) int {
	if offset <= 0 {
		return 0
	}

	codeUnits := 0
	for byteOffset, character := range text {
		characterUnits := 1
		if character > 0xffff {
			characterUnits = 2
		}
		nextCodeUnits := codeUnits + characterUnits
		if offset <= nextCodeUnits {
			if offset == nextCodeUnits {
				return byteOffset + utf8.RuneLen(character)
			}
			return byteOffset
		}
		codeUnits = nextCodeUnits
	}
	return len(text)
}
