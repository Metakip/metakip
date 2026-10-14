package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSharingClientUsesVersionedSharingEndpoints(t *testing.T) {
	invitationID := "00000000-0000-4000-8000-000000000004"
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/api/v1/shares/entity/page/page-id":
			_, _ = io.WriteString(response, `{"entity":{"type":"page","id":"page-id","title":"Notes","ownerId":"owner"},"publicAccess":{"permission":"private","url":"https://app.example.com/notes"},"inheritance":{"policy":"inherit"},"grants":[]}`)
		case request.Method == http.MethodGet && request.URL.Path == "/api/v1/shares/entity/folder/folder-id":
			_, _ = io.WriteString(response, `{"visibility":"limited","entity":{"type":"folder","id":"folder-id","title":"Shared folder","ownerId":null},"publicAccess":{"permission":"private","url":"https://app.example.com/folder"},"grants":[]}`)
		case request.Method == http.MethodPost && request.URL.Path == "/api/v1/shares/entity/folder/folder-id/grants":
			var body map[string]string
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Errorf("decode grant request: %v", err)
			}
			if body["email"] != "reader@example.com" || body["permission"] != "view" {
				t.Errorf("unexpected grant body %#v", body)
			}
			response.WriteHeader(http.StatusAccepted)
			_, _ = io.WriteString(response, `{"ok":true,"message":"Invitation queued","invitation":{"id":"`+invitationID+`","email":"reader@example.com"}}`)
		case request.Method == http.MethodPatch && request.URL.Path == "/api/v1/shares/entity/page/page-id/grants/by-email/reader@example.com":
			_, _ = io.WriteString(response, `{"ok":true,"message":"Permission updated"}`)
		case request.Method == http.MethodDelete && request.URL.Path == "/api/v1/shares/entity/page/page-id/grants/by-email/reader@example.com":
			_, _ = io.WriteString(response, `{"ok":true,"message":"Share removed"}`)
		case request.Method == http.MethodPost && request.URL.Path == "/api/v1/shares/entity/page/page-id/leave":
			_, _ = io.WriteString(response, `{"ok":true,"message":"Removed from your view"}`)
		case request.Method == http.MethodPatch && request.URL.Path == "/api/v1/shares/entity/page/page-id/public-access":
			_, _ = io.WriteString(response, `{"permission":"view","url":"https://app.example.com/notes","message":"Public view enabled"}`)
		case request.Method == http.MethodPatch && request.URL.Path == "/api/v1/shares/entity/folder/folder-id/inheritance":
			_, _ = io.WriteString(response, `{"policy":"restricted","message":"Inheritance restricted"}`)
		case request.Method == http.MethodPost && request.URL.Path == "/api/v1/shares/entity/page/page-id/invitations/by-email/reader@example.com/resend":
			_, _ = io.WriteString(response, `{"message":"Invitation queued","invitation":{"id":"`+invitationID+`","email":"reader@example.com"}}`)
		case request.Method == http.MethodDelete && request.URL.Path == "/api/v1/shares/entity/page/page-id/invitations/by-email/reader@example.com":
			_, _ = io.WriteString(response, `{"ok":true,"message":"Invitation revoked"}`)
		case request.Method == http.MethodPost && request.URL.Path == "/api/v1/shares/workspace/invitations/by-email/invitee@example.com/resend":
			_, _ = io.WriteString(response, `{"message":"Invitation queued","invitation":{"id":"`+invitationID+`","email":"invitee@example.com"}}`)
		case request.Method == http.MethodDelete && request.URL.Path == "/api/v1/shares/workspace/invitations/by-email/invitee@example.com":
			_, _ = io.WriteString(response, `{"ok":true,"message":"Invitation revoked"}`)
		case request.Method == http.MethodGet && request.URL.Path == "/api/v1/shares/workspace":
			_, _ = io.WriteString(response, `{"ownerId":"owner-id","ownerName":"Owner","members":[],"memberships":[],"pendingInvitations":[]}`)
		case request.Method == http.MethodPost && request.URL.Path == "/api/v1/shares/workspace/members":
			var body map[string]string
			if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
				t.Errorf("decode workspace add request: %v", err)
			}
			if body["email"] != "member@example.com" || body["role"] != "editor" {
				t.Errorf("unexpected workspace add body %#v", body)
			}
			_, _ = io.WriteString(response, `{"ok":true,"memberId":"member-id","message":"Member added"}`)
		case request.Method == http.MethodPatch && request.URL.Path == "/api/v1/shares/workspace/members/by-email/member@example.com":
			_, _ = io.WriteString(response, `{"ok":true,"message":"Role updated"}`)
		case request.Method == http.MethodDelete && request.URL.Path == "/api/v1/shares/workspace/members/by-email/member@example.com":
			_, _ = io.WriteString(response, `{"ok":true,"message":"Member removed"}`)
		case request.Method == http.MethodDelete && request.URL.Path == "/api/v1/shares/workspace/memberships/owner-id":
			_, _ = io.WriteString(response, `{"ok":true,"message":"Left the workspace"}`)
		default:
			t.Errorf("unexpected request %s %s", request.Method, request.URL.Path)
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	c, err := newClient(context.Background(), server.URL, "token", time.Second)
	if err != nil {
		t.Fatal(err)
	}

	summary, err := c.getSharingSummary("page", "page-id")
	if err != nil || summary.Entity.Title != "Notes" || summary.PublicAccess.Permission != "private" {
		t.Fatalf("unexpected sharing summary %#v, error %v", summary, err)
	}
	if summary.Inheritance == nil || summary.Inheritance.Policy != "inherit" {
		t.Fatalf("full summary lost inheritance policy: %#v", summary)
	}
	limited, err := c.getSharingSummary("folder", "folder-id")
	if err != nil || limited.Inheritance != nil {
		t.Fatalf("limited summary exposed a placeholder inheritance policy: %#v, error %v", limited, err)
	}
	limitedJSON, err := json.Marshal(limited)
	if err != nil {
		t.Fatal(err)
	}
	var limitedFields map[string]json.RawMessage
	if err := json.Unmarshal(limitedJSON, &limitedFields); err != nil {
		t.Fatal(err)
	}
	if _, present := limitedFields["inheritance"]; present {
		t.Fatalf("limited JSON still exposes a placeholder inheritance policy: %s", limitedJSON)
	}
	grant, err := c.grantEntityAccess("folder", "folder-id", "reader@example.com", "view")
	if err != nil || grant.Invitation == nil || grant.Invitation.ID != invitationID {
		t.Fatalf("unexpected grant response %#v, error %v", grant, err)
	}
	if _, err := c.updateSharePermission("page", "page-id", "reader@example.com", "edit"); err != nil {
		t.Fatalf("update share permission: %v", err)
	}
	if _, err := c.revokeShare("page", "page-id", "reader@example.com"); err != nil {
		t.Fatalf("revoke share: %v", err)
	}
	left, err := c.leaveSharedEntity("page", "page-id")
	if err != nil || left.Message != "Removed from your view" {
		t.Fatalf("unexpected leave response %#v, error %v", left, err)
	}
	public, err := c.updatePublicAccess("page", "page-id", "view")
	if err != nil || public.Permission != "view" {
		t.Fatalf("unexpected public-access response %#v, error %v", public, err)
	}
	inheritance, err := c.updateSharingInheritance("folder", "folder-id", "restricted")
	if err != nil || inheritance.Policy != "restricted" {
		t.Fatalf("unexpected inheritance response %#v, error %v", inheritance, err)
	}
	if _, err := c.resendEntityInvitation("page", "page-id", "reader@example.com"); err != nil {
		t.Fatalf("resend invitation: %v", err)
	}
	if _, err := c.revokeEntityInvitation("page", "page-id", "reader@example.com"); err != nil {
		t.Fatalf("revoke invitation: %v", err)
	}
	workspace, err := c.getWorkspaceSharingSummary()
	if err != nil || workspace.OwnerName == nil || *workspace.OwnerName != "Owner" {
		t.Fatalf("unexpected workspace summary %#v, error %v", workspace, err)
	}
	added, err := c.addWorkspaceMember("member@example.com", "editor")
	if err != nil || added.MemberID != "member-id" {
		t.Fatalf("unexpected workspace add result %#v, error %v", added, err)
	}
	if _, err := c.updateWorkspaceMemberRole("member@example.com", "viewer"); err != nil {
		t.Fatalf("update workspace role: %v", err)
	}
	if _, err := c.removeWorkspaceMember("member@example.com"); err != nil {
		t.Fatalf("remove workspace member: %v", err)
	}
	if _, err := c.leaveWorkspace("owner-id"); err != nil {
		t.Fatalf("leave workspace: %v", err)
	}
	if _, err := c.resendWorkspaceInvitation("invitee@example.com"); err != nil {
		t.Fatalf("resend workspace invitation: %v", err)
	}
	if _, err := c.revokeWorkspaceInvitation("invitee@example.com"); err != nil {
		t.Fatalf("revoke workspace invitation: %v", err)
	}
}

func TestSharingSummaryDisplaysEffectiveAccess(t *testing.T) {
	var output bytes.Buffer
	r := &runtimeState{cli: &CLI{}, stdout: &output}
	name := "Reader"
	folder := "Research"
	readerEmail := "reader@example.com"
	summary := shareSummary{
		Visibility:         "full",
		Entity:             shareEntity{Type: "page", ID: "page-id", Title: "Notes"},
		PublicAccess:       sharePublic{Permission: "private"},
		Inheritance:        &shareInheritance{Policy: "inherit"},
		Collaborators:      []shareCollaborator{{UserID: "reader-id", Name: &name, Permission: "edit"}},
		Grants:             []shareGrant{{ID: "internal-grant-id", RecipientEmail: &readerEmail, Permission: "edit"}},
		PendingInvitations: []shareInvitation{{ID: "internal-invitation-id", Email: "invitee@example.com", Permission: "view", DeliveryStatus: "sent"}},
		InheritedAccessors: []shareInheritedAccessor{{UserID: "reader-id", Name: &name, Permission: "edit", Source: "folder", FolderName: &folder}},
		InheritedPublic:    []shareInheritedPublic{{EntityID: "folder-id", EntityTitle: folder, Permission: "view", URL: "https://app.example.com/research"}},
	}
	if err := printSharingSummary(r, summary); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "Person: Reader\tedit") ||
		!strings.Contains(output.String(), "Share: reader@example.com\tedit") ||
		!strings.Contains(output.String(), "Invitation: invitee@example.com\tview\tsent") ||
		!strings.Contains(output.String(), "Inherited: Reader\tedit\tvia Research") ||
		!strings.Contains(output.String(), "Inherited public: Research\tview\thttps://app.example.com/research") ||
		strings.Contains(output.String(), "internal-grant-id") ||
		strings.Contains(output.String(), "internal-invitation-id") {
		t.Fatalf("effective access missing from human output: %s", output.String())
	}
}

func TestWorkspaceSharingSummaryDistinguishesOwnAndJoinedWorkspaces(t *testing.T) {
	var output bytes.Buffer
	r := &runtimeState{cli: &CLI{}, stdout: &output}
	ownerName := "My workspace"
	joinedOwnerName := "Workspace owner"
	memberName := "Casey"
	summary := workspaceShareSummary{
		OwnerID:   "my-owner-id",
		OwnerName: &ownerName,
		Members: []workspaceMember{{
			MemberID:    "internal-member-id",
			MemberName:  &memberName,
			MemberEmail: "casey@example.com",
			Role:        "commenter",
		}},
		PendingInvitations: []shareInvitation{{
			ID:             "internal-invitation-id",
			Email:          "invitee@example.com",
			Permission:     "editor",
			DeliveryStatus: "sent",
		}},
		Memberships: []workspaceMembership{{
			OwnerID:   "joined-owner-id",
			OwnerName: &joinedOwnerName,
			Role:      "commenter",
		}},
	}
	if err := printWorkspaceSharingSummary(r, summary); err != nil {
		t.Fatal(err)
	}
	text := output.String()
	if !strings.Contains(text, "Your workspace: My workspace\tOwner ID: my-owner-id") ||
		!strings.Contains(text, "Member: Casey <casey@example.com>\tcommenter") ||
		!strings.Contains(text, "Invitation: invitee@example.com\teditor\tsent") ||
		!strings.Contains(text, "Joined workspace: Workspace owner\tcommenter\tOwner ID: joined-owner-id") ||
		strings.Contains(text, "No joined workspaces.") ||
		strings.Contains(text, "internal-member-id") ||
		strings.Contains(text, "internal-invitation-id") {
		t.Fatalf("workspace ownership wasn't clear in the output: %s", text)
	}
}

func TestLimitedSharingSummaryDisplaysCollaboratorsWithoutManagementDetails(t *testing.T) {
	var output bytes.Buffer
	r := &runtimeState{cli: &CLI{}, stdout: &output}
	name := "Reader"
	summary := shareSummary{
		Visibility:    "limited",
		Entity:        shareEntity{Type: "page", ID: "page-id", Title: "Notes"},
		PublicAccess:  sharePublic{Permission: "private"},
		Collaborators: []shareCollaborator{{UserID: "reader-id", Name: &name, Permission: "view"}},
	}
	if err := printSharingSummary(r, summary); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "Person: Reader\tview") || strings.Contains(output.String(), "Inheritance:") {
		t.Fatalf("limited sharing summary is misleading: %s", output.String())
	}
}
