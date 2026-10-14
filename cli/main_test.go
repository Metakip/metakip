package main

import (
	"testing"

	"github.com/alecthomas/kong"
)

func TestLegacyPageEditReservedTitlesParseAsInteractiveReferences(t *testing.T) {
	for _, test := range []struct {
		name      string
		arguments []string
		title     string
	}{
		{name: "bare", arguments: []string{"page", "edit", "exact"}, title: "exact"},
		{name: "interactive title", arguments: []string{"page", "edit", "interactive"}, title: "interactive"},
		{name: "replace title", arguments: []string{"page", "edit", "replace"}, title: "replace"},
		{name: "append title", arguments: []string{"page", "edit", "append"}, title: "append"},
		{name: "global JSON", arguments: []string{"--json", "page", "edit", "exact"}, title: "exact"},
		{name: "editor flag", arguments: []string{"page", "edit", "exact", "--editor", "vim"}, title: "exact"},
		{name: "all reserved titles", arguments: []string{"page", "edit", "prepend"}, title: "prepend"},
	} {
		t.Run(test.name, func(t *testing.T) {
			cli := CLI{}
			parser, err := kong.New(&cli)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := parser.Parse(normalizeLegacyPageEditArguments(test.arguments)); err != nil {
				t.Fatal(err)
			}
			if cli.Page.Edit.Interactive.Reference != test.title {
				t.Fatalf("interactive reference = %q, want %q", cli.Page.Edit.Interactive.Reference, test.title)
			}
		})
	}
}

func TestSharingCommandsUseTopLevelShareGroup(t *testing.T) {
	tests := []struct {
		name      string
		arguments []string
		check     func(*CLI) bool
	}{
		{
			name:      "add page access",
			arguments: []string{"share", "page", "add", "Project notes", "reader@example.com", "--permission", "edit"},
			check: func(cli *CLI) bool {
				return cli.Share.Page.Add.Reference == "Project notes" &&
					cli.Share.Page.Add.Email == "reader@example.com" &&
					cli.Share.Page.Add.Permission == "edit"
			},
		},
		{
			name:      "enable link access with confirmation",
			arguments: []string{"share", "folder", "link", "Research", "--permission", "view", "--yes"},
			check: func(cli *CLI) bool {
				return cli.Share.Folder.Link.Reference == "Research" &&
					cli.Share.Folder.Link.Permission == "view" && cli.Share.Folder.Link.Yes
			},
		},
		{
			name:      "update page access by email",
			arguments: []string{"share", "page", "update", "Project notes", "reader@example.com", "--permission", "commenter"},
			check: func(cli *CLI) bool {
				return cli.Share.Page.Update.Reference == "Project notes" &&
					cli.Share.Page.Update.Email == "reader@example.com" &&
					cli.Share.Page.Update.Permission == "commenter"
			},
		},
		{
			name:      "remove folder access by email",
			arguments: []string{"share", "folder", "remove", "Research", "reader@example.com", "--yes"},
			check: func(cli *CLI) bool {
				return cli.Share.Folder.Remove.Reference == "Research" &&
					cli.Share.Folder.Remove.Email == "reader@example.com" && cli.Share.Folder.Remove.Yes
			},
		},
		{
			name:      "cancel pending folder invitation by email",
			arguments: []string{"share", "folder", "cancel", "Research", "invitee@example.com", "--yes"},
			check: func(cli *CLI) bool {
				return cli.Share.Folder.Cancel.Reference == "Research" &&
					cli.Share.Folder.Cancel.Email == "invitee@example.com" &&
					cli.Share.Folder.Cancel.Yes
			},
		},
		{
			name:      "leave a shared page",
			arguments: []string{"share", "page", "leave", "Project notes", "--yes"},
			check: func(cli *CLI) bool {
				return cli.Share.Page.Leave.Reference == "Project notes" && cli.Share.Page.Leave.Yes
			},
		},
		{
			name:      "turn inherited access off",
			arguments: []string{"share", "page", "inherit", "Project notes", "off"},
			check: func(cli *CLI) bool {
				return cli.Share.Page.Inherit.Reference == "Project notes" && cli.Share.Page.Inherit.State == "off"
			},
		},
		{
			name:      "resend pending page invitation by email",
			arguments: []string{"share", "page", "resend", "Project notes", "invitee@example.com"},
			check: func(cli *CLI) bool {
				return cli.Share.Page.Resend.Reference == "Project notes" &&
					cli.Share.Page.Resend.Email == "invitee@example.com"
			},
		},
		{
			name:      "add workspace member or send invitation",
			arguments: []string{"share", "workspace", "add", "person@example.com", "--role", "commenter"},
			check: func(cli *CLI) bool {
				return cli.Share.Workspace.Add.Email == "person@example.com" &&
					cli.Share.Workspace.Add.Role == "commenter"
			},
		},
		{
			name:      "leave a joined workspace",
			arguments: []string{"share", "workspace", "leave", "owner-id", "--yes"},
			check: func(cli *CLI) bool {
				return cli.Share.Workspace.Leave.OwnerID == "owner-id" && cli.Share.Workspace.Leave.Yes
			},
		},
		{
			name:      "update workspace member by email",
			arguments: []string{"share", "workspace", "update", "person@example.com", "--role", "commenter"},
			check: func(cli *CLI) bool {
				return cli.Share.Workspace.Update.Email == "person@example.com" &&
					cli.Share.Workspace.Update.Role == "commenter"
			},
		},
		{
			name:      "cancel workspace invitation by email",
			arguments: []string{"share", "workspace", "cancel", "invitee@example.com", "--yes"},
			check: func(cli *CLI) bool {
				return cli.Share.Workspace.Cancel.Email == "invitee@example.com" && cli.Share.Workspace.Cancel.Yes
			},
		},
		{
			name:      "show folder sharing",
			arguments: []string{"share", "folder", "show", "Research"},
			check: func(cli *CLI) bool {
				return cli.Share.Folder.Show.Reference == "Research"
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			cli := CLI{}
			parser, err := kong.New(&cli)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := parser.Parse(test.arguments); err != nil {
				t.Fatal(err)
			}
			if !test.check(&cli) {
				t.Fatalf("parsed sharing command did not match arguments: %#v", cli.Share)
			}
		})
	}
}
