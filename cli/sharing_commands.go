package main

import (
	"fmt"
)

func (cmd *PageShareShowCmd) Run(r *runtimeState) error {
	return cmd.run(r, "page")
}

func (cmd *PageShareShowCmd) run(r *runtimeState, entityType string) error {
	entityID, _, err := resolveShareEntity(r, entityType, cmd.Reference)
	if err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	summary, err := c.getSharingSummary(entityType, entityID)
	if err != nil {
		return err
	}
	if r.cli.JSON {
		return r.printJSON(summary)
	}
	return printSharingSummary(r, summary)
}

func (cmd *FolderShareShowCmd) Run(r *runtimeState) error {
	return (*PageShareShowCmd)(cmd).run(r, "folder")
}

func (cmd *PageShareAddCmd) Run(r *runtimeState) error {
	return cmd.run(r, "page")
}

func (cmd *PageShareAddCmd) run(r *runtimeState, entityType string) error {
	entityID, _, err := resolveShareEntity(r, entityType, cmd.Reference)
	if err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	result, err := c.grantEntityAccess(entityType, entityID, cmd.Email, cmd.Permission)
	if err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	if r.cli.JSON {
		return r.printJSON(result)
	}
	_, err = fmt.Fprintln(r.stdout, terminalText(result.Message))
	return err
}

func (cmd *FolderShareAddCmd) Run(r *runtimeState) error {
	return (*PageShareAddCmd)(cmd).run(r, "folder")
}

func (cmd *PageShareUpdateCmd) Run(r *runtimeState) error {
	return cmd.run(r, "page")
}

func (cmd *PageShareUpdateCmd) run(r *runtimeState, entityType string) error {
	entityID, _, err := resolveShareEntity(r, entityType, cmd.Reference)
	if err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	result, err := c.updateSharePermission(entityType, entityID, cmd.Email, cmd.Permission)
	if err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	return printShareGrantResult(r, result)
}

func (cmd *FolderShareUpdateCmd) Run(r *runtimeState) error {
	return (*PageShareUpdateCmd)(cmd).run(r, "folder")
}

func (cmd *PageShareRemoveCmd) Run(r *runtimeState) error {
	return cmd.run(r, "page")
}

func (cmd *PageShareRemoveCmd) run(r *runtimeState, entityType string) error {
	entityID, title, err := resolveShareEntity(r, entityType, cmd.Reference)
	if err != nil {
		return err
	}
	if err := confirmLifecycleAction(r, cmd.Yes, fmt.Sprintf("Remove %s's access to %q?", cmd.Email, title)); err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	result, err := c.revokeShare(entityType, entityID, cmd.Email)
	if err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	return printShareGrantResult(r, result)
}

func (cmd *FolderShareRemoveCmd) Run(r *runtimeState) error {
	return (*PageShareRemoveCmd)(cmd).run(r, "folder")
}

func (cmd *PageShareLeaveCmd) Run(r *runtimeState) error {
	return cmd.run(r, "page")
}

func (cmd *PageShareLeaveCmd) run(r *runtimeState, entityType string) error {
	entityID, title, err := resolveShareEntity(r, entityType, cmd.Reference)
	if err != nil {
		return err
	}
	if err := confirmLifecycleAction(r, cmd.Yes, fmt.Sprintf("Remove %q from your view?", title)); err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	result, err := c.leaveSharedEntity(entityType, entityID)
	if err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	return printShareGrantResult(r, result)
}

func (cmd *FolderShareLeaveCmd) Run(r *runtimeState) error {
	return (*PageShareLeaveCmd)(cmd).run(r, "folder")
}

func (cmd *PageShareLinkCmd) Run(r *runtimeState) error {
	return cmd.run(r, "page")
}

func (cmd *PageShareLinkCmd) run(r *runtimeState, entityType string) error {
	entityID, title, err := resolveShareEntity(r, entityType, cmd.Reference)
	if err != nil {
		return err
	}
	if cmd.Permission != "private" {
		if err := confirmLifecycleAction(
			r,
			cmd.Yes,
			fmt.Sprintf("Anyone with the URL will be able to access %q. Continue?", title),
		); err != nil {
			return err
		}
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	result, err := c.updatePublicAccess(entityType, entityID, cmd.Permission)
	if err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	if r.cli.JSON {
		return r.printJSON(result)
	}
	_, err = fmt.Fprintf(
		r.stdout,
		"%s\n%s\n",
		terminalText(result.Message),
		terminalText(result.URL),
	)
	return err
}

func (cmd *FolderShareLinkCmd) Run(r *runtimeState) error {
	return (*PageShareLinkCmd)(cmd).run(r, "folder")
}

func (cmd *PageShareInheritCmd) Run(r *runtimeState) error {
	return cmd.run(r, "page")
}

func (cmd *PageShareInheritCmd) run(r *runtimeState, entityType string) error {
	entityID, _, err := resolveShareEntity(r, entityType, cmd.Reference)
	if err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	policy := "restricted"
	if cmd.State == "on" {
		policy = "inherit"
	}
	result, err := c.updateSharingInheritance(entityType, entityID, policy)
	if err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	if r.cli.JSON {
		return r.printJSON(result)
	}
	_, err = fmt.Fprintln(r.stdout, terminalText(result.Message))
	return err
}

func (cmd *FolderShareInheritCmd) Run(r *runtimeState) error {
	return (*PageShareInheritCmd)(cmd).run(r, "folder")
}

func (cmd *PageShareResendCmd) Run(r *runtimeState) error {
	return cmd.run(r, "page")
}

func (cmd *PageShareResendCmd) run(r *runtimeState, entityType string) error {
	entityID, _, err := resolveShareEntity(r, entityType, cmd.Reference)
	if err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	result, err := c.resendEntityInvitation(entityType, entityID, cmd.Email)
	if err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	if r.cli.JSON {
		return r.printJSON(result)
	}
	_, err = fmt.Fprintln(r.stdout, terminalText(result.Message))
	return err
}

func (cmd *FolderShareResendCmd) Run(r *runtimeState) error {
	return (*PageShareResendCmd)(cmd).run(r, "folder")
}

func (cmd *PageShareCancelCmd) Run(r *runtimeState) error {
	return cmd.run(r, "page")
}

func (cmd *PageShareCancelCmd) run(r *runtimeState, entityType string) error {
	entityID, title, err := resolveShareEntity(r, entityType, cmd.Reference)
	if err != nil {
		return err
	}
	if err := confirmLifecycleAction(r, cmd.Yes, fmt.Sprintf("Cancel the invitation to %s for %q?", cmd.Email, title)); err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	result, err := c.revokeEntityInvitation(entityType, entityID, cmd.Email)
	if err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	return printShareGrantResult(r, result)
}

func (cmd *FolderShareCancelCmd) Run(r *runtimeState) error {
	return (*PageShareCancelCmd)(cmd).run(r, "folder")
}

func (cmd *WorkspaceShareShowCmd) Run(r *runtimeState) error {
	c, err := r.client()
	if err != nil {
		return err
	}
	summary, err := c.getWorkspaceSharingSummary()
	if err != nil {
		return err
	}
	if r.cli.JSON {
		return r.printJSON(summary)
	}
	return printWorkspaceSharingSummary(r, summary)
}

func (cmd *WorkspaceShareAddCmd) Run(r *runtimeState) error {
	c, err := r.client()
	if err != nil {
		return err
	}
	result, err := c.addWorkspaceMember(cmd.Email, cmd.Role)
	if err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	return printWorkspaceShareResult(r, result)
}

func (cmd *WorkspaceShareUpdateCmd) Run(r *runtimeState) error {
	c, err := r.client()
	if err != nil {
		return err
	}
	result, err := c.updateWorkspaceMemberRole(cmd.Email, cmd.Role)
	if err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	return printWorkspaceShareResult(r, result)
}

func (cmd *WorkspaceShareRemoveCmd) Run(r *runtimeState) error {
	if err := confirmLifecycleAction(r, cmd.Yes, fmt.Sprintf("Remove %s from your workspace?", cmd.Email)); err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	result, err := c.removeWorkspaceMember(cmd.Email)
	if err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	return printWorkspaceShareResult(r, result)
}

func (cmd *WorkspaceShareLeaveCmd) Run(r *runtimeState) error {
	if err := confirmLifecycleAction(
		r,
		cmd.Yes,
		fmt.Sprintf("Leave the joined workspace owned by %s?", cmd.OwnerID),
	); err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	result, err := c.leaveWorkspace(cmd.OwnerID)
	if err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	return printWorkspaceShareResult(r, result)
}

func (cmd *WorkspaceShareResendCmd) Run(r *runtimeState) error {
	c, err := r.client()
	if err != nil {
		return err
	}
	result, err := c.resendWorkspaceInvitation(cmd.Email)
	if err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	if r.cli.JSON {
		return r.printJSON(result)
	}
	_, err = fmt.Fprintln(r.stdout, terminalText(result.Message))
	return err
}

func (cmd *WorkspaceShareCancelCmd) Run(r *runtimeState) error {
	if err := confirmLifecycleAction(r, cmd.Yes, fmt.Sprintf("Cancel the workspace invitation to %s?", cmd.Email)); err != nil {
		return err
	}
	c, err := r.client()
	if err != nil {
		return err
	}
	result, err := c.revokeWorkspaceInvitation(cmd.Email)
	if err != nil {
		return uncertainLifecycleMutationOutcome(err)
	}
	return printShareGrantResult(r, result)
}

func printWorkspaceShareResult(r *runtimeState, result workspaceShareResult) error {
	if r.cli.JSON {
		return r.printJSON(result)
	}
	_, err := fmt.Fprintln(r.stdout, terminalText(result.Message))
	return err
}

func printWorkspaceSharingSummary(r *runtimeState, summary workspaceShareSummary) error {
	ownerName := valueOrEmpty(summary.OwnerName)
	if ownerName == "" {
		ownerName = summary.OwnerID
	}
	if _, err := fmt.Fprintf(
		r.stdout,
		"Your workspace: %s\tOwner ID: %s\n",
		terminalText(ownerName),
		r.style(dimStyle, terminalText(summary.OwnerID)),
	); err != nil {
		return err
	}
	if len(summary.Members) == 0 && len(summary.PendingInvitations) == 0 {
		if _, err := fmt.Fprintln(r.stdout, "No members or pending invitations."); err != nil {
			return err
		}
	}
	for _, member := range summary.Members {
		display := member.MemberEmail
		name := valueOrEmpty(member.MemberName)
		if name != "" && name != member.MemberEmail {
			display = fmt.Sprintf("%s <%s>", name, member.MemberEmail)
		}
		if _, err := fmt.Fprintf(
			r.stdout,
			"Member: %s\t%s\n",
			terminalText(display),
			terminalText(member.Role),
		); err != nil {
			return err
		}
	}
	for _, invitation := range summary.PendingInvitations {
		if _, err := fmt.Fprintf(
			r.stdout,
			"Invitation: %s\t%s\t%s\n",
			terminalText(invitation.Email),
			terminalText(invitation.Permission),
			terminalText(invitation.DeliveryStatus),
		); err != nil {
			return err
		}
	}
	if len(summary.Memberships) == 0 {
		if _, err := fmt.Fprintln(r.stdout, "No joined workspaces."); err != nil {
			return err
		}
	}
	for _, membership := range summary.Memberships {
		name := valueOrEmpty(membership.OwnerName)
		if name == "" {
			name = membership.OwnerID
		}
		if _, err := fmt.Fprintf(
			r.stdout,
			"Joined workspace: %s\t%s\tOwner ID: %s\n",
			terminalText(name),
			terminalText(membership.Role),
			terminalText(membership.OwnerID),
		); err != nil {
			return err
		}
	}
	return nil
}

func resolveShareEntity(r *runtimeState, entityType, reference string) (string, string, error) {
	switch entityType {
	case "page":
		resolved, err := r.resolvePage(reference)
		return resolved.ID, resolved.Title, err
	case "folder":
		resolved, err := r.resolveFolder(reference)
		return resolved.ID, resolved.Name, err
	default:
		return "", "", usageError("Entity type must be page or folder.")
	}
}

func printSharingSummary(r *runtimeState, summary shareSummary) error {
	visibility := summary.Visibility
	if visibility == "" {
		visibility = "full"
	}
	if _, err := fmt.Fprintf(
		r.stdout,
		"Sharing settings for %s %q (%s)\nVisibility: %s\nDirect public access: %s\n",
		terminalText(summary.Entity.Type),
		terminalText(summary.Entity.Title),
		r.style(dimStyle, terminalText(summary.Entity.ID)),
		terminalText(visibility),
		terminalText(summary.PublicAccess.Permission),
	); err != nil {
		return err
	}
	if visibility != "limited" && summary.Inheritance != nil {
		if _, err := fmt.Fprintf(r.stdout, "Inheritance: %s\n", terminalText(summary.Inheritance.Policy)); err != nil {
			return err
		}
	}
	if summary.PublicAccess.URL != "" {
		if _, err := fmt.Fprintf(r.stdout, "URL: %s\n", terminalText(summary.PublicAccess.URL)); err != nil {
			return err
		}
	}
	if summary.UserPermission != nil {
		if _, err := fmt.Fprintf(r.stdout, "Your access: %s\n", terminalText(*summary.UserPermission)); err != nil {
			return err
		}
	}
	for _, collaborator := range summary.Collaborators {
		name := valueOrEmpty(collaborator.Name)
		if name == "" {
			name = collaborator.UserID
		}
		if _, err := fmt.Fprintf(r.stdout, "Person: %s\t%s\n", terminalText(name), terminalText(collaborator.Permission)); err != nil {
			return err
		}
	}
	if visibility == "limited" {
		_, err := fmt.Fprintln(r.stdout, "Direct grant and invitation details are only available to owners and administrators.")
		return err
	}
	if len(summary.Grants) == 0 && len(summary.PendingInvitations) == 0 {
		if _, err := fmt.Fprintln(r.stdout, "No direct shares or pending invitations."); err != nil {
			return err
		}
	}
	for _, grant := range summary.Grants {
		identity := valueOrEmpty(grant.RecipientEmail)
		if identity == "" {
			identity = grant.RecipientUserID
		}
		if _, err := fmt.Fprintf(
			r.stdout,
			"Share: %s\t%s\n",
			terminalText(identity),
			terminalText(grant.Permission),
		); err != nil {
			return err
		}
	}
	for _, accessor := range summary.InheritedAccessors {
		name := valueOrEmpty(accessor.Name)
		if name == "" {
			name = valueOrEmpty(accessor.Email)
		}
		if name == "" {
			name = accessor.UserID
		}
		source := accessor.Source
		if accessor.FolderName != nil && *accessor.FolderName != "" {
			source = *accessor.FolderName
		}
		if _, err := fmt.Fprintf(r.stdout, "Inherited: %s\t%s\tvia %s\n", terminalText(name), terminalText(accessor.Permission), terminalText(source)); err != nil {
			return err
		}
	}
	for _, inherited := range summary.InheritedPublic {
		if _, err := fmt.Fprintf(
			r.stdout,
			"Inherited public: %s\t%s\t%s\n",
			terminalText(inherited.EntityTitle),
			terminalText(inherited.Permission),
			terminalText(inherited.URL),
		); err != nil {
			return err
		}
	}
	for _, invitation := range summary.PendingInvitations {
		if _, err := fmt.Fprintf(
			r.stdout,
			"Invitation: %s\t%s\t%s\n",
			terminalText(invitation.Email),
			terminalText(invitation.Permission),
			terminalText(invitation.DeliveryStatus),
		); err != nil {
			return err
		}
	}
	return nil
}

func printShareGrantResult(r *runtimeState, result shareGrantResult) error {
	if r.cli.JSON {
		return r.printJSON(result)
	}
	_, err := fmt.Fprintln(r.stdout, terminalText(result.Message))
	return err
}
