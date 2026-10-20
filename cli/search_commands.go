package main

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/lipgloss/table"
)

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
				"%s\t%s\t%s\t%s\n",
				terminalText(result.Type),
				terminalText(result.displayName()),
				terminalText(result.FolderPath),
				terminalText(result.ID),
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
			terminalText(result.displayName()),
			terminalText(result.FolderPath),
			r.style(dimStyle, terminalText(result.ID)),
		})
	}
	resultTable := table.New().Headers("TYPE", "NAME", "PATH", "ID").Rows(rows...).Border(lipgloss.HiddenBorder())
	_, err := fmt.Fprintln(r.stdout, resultTable.Render())
	return err
}
