package main

import (
	"encoding/json"
	"net/http"
	"net/url"
)

type shareSummary struct {
	Visibility         string                   `json:"visibility,omitempty"`
	Collaborators      []shareCollaborator      `json:"collaborators"`
	Entity             shareEntity              `json:"entity"`
	PublicAccess       sharePublic              `json:"publicAccess"`
	Inheritance        *shareInheritance        `json:"inheritance,omitempty"`
	Grants             []shareGrant             `json:"grants"`
	PendingInvitations []shareInvitation        `json:"pendingInvitations,omitempty"`
	Accessors          json.RawMessage          `json:"accessors,omitempty"`
	AccessSources      json.RawMessage          `json:"accessSources,omitempty"`
	InheritedPublic    []shareInheritedPublic   `json:"inheritedPublicAccess"`
	UserPermission     *string                  `json:"userPermission"`
	Capabilities       json.RawMessage          `json:"capabilities,omitempty"`
	PermissionDetails  json.RawMessage          `json:"permissionDetails,omitempty"`
	InheritedAccessors []shareInheritedAccessor `json:"inheritedAccessors"`
}

type shareCollaborator struct {
	UserID     string  `json:"userId"`
	Name       *string `json:"name"`
	Permission string  `json:"permission"`
	IsOwner    bool    `json:"isOwner"`
	AvatarURL  *string `json:"avatarUrl"`
}

type shareInheritedAccessor struct {
	UserID     string  `json:"userId"`
	Name       *string `json:"name"`
	Email      *string `json:"email"`
	Permission string  `json:"permission"`
	Source     string  `json:"source"`
	FolderID   *string `json:"folderId,omitempty"`
	FolderName *string `json:"folderName,omitempty"`
}

type shareInheritedPublic struct {
	EntityID    string `json:"entityId"`
	EntityTitle string `json:"entityTitle"`
	Permission  string `json:"permission"`
	URL         string `json:"url"`
}

type shareEntity struct {
	Type    string  `json:"type"`
	ID      string  `json:"id"`
	Title   string  `json:"title"`
	OwnerID *string `json:"ownerId"`
}

type sharePublic struct {
	Permission string `json:"permission"`
	URL        string `json:"url"`
}

type shareInheritance struct {
	Policy string `json:"policy"`
}

type shareGrant struct {
	ID              string  `json:"id"`
	EntityType      string  `json:"entityType"`
	EntityID        string  `json:"entityId"`
	Permission      string  `json:"permission"`
	RecipientUserID string  `json:"recipientUserId"`
	RecipientEmail  *string `json:"recipientEmail"`
	RecipientName   *string `json:"recipientName"`
	RecipientAvatar *string `json:"recipientAvatarUrl"`
	SharedByName    *string `json:"sharedByName"`
	SharedByEmail   *string `json:"sharedByEmail"`
	CreatedAt       *string `json:"createdAt"`
	UpdatedAt       *string `json:"updatedAt"`
}

type shareInvitation struct {
	ID             string `json:"id"`
	TargetType     string `json:"targetType"`
	TargetID       string `json:"targetId"`
	Email          string `json:"email"`
	Permission     string `json:"permission"`
	CanManage      bool   `json:"canManage"`
	DeliveryStatus string `json:"deliveryStatus"`
	ExpiresAt      string `json:"expiresAt"`
	CreatedAt      string `json:"createdAt"`
}

type shareGrantResult struct {
	OK         bool             `json:"ok"`
	Message    string           `json:"message"`
	Invitation *shareInvitation `json:"invitation,omitempty"`
}

type sharePublicResult struct {
	Permission string `json:"permission"`
	URL        string `json:"url"`
	Message    string `json:"message"`
}

type shareInheritanceResult struct {
	Policy  string `json:"policy"`
	Message string `json:"message"`
}

type shareInvitationResult struct {
	Invitation shareInvitation `json:"invitation"`
	Message    string          `json:"message"`
}

type workspaceMember struct {
	ID               string  `json:"id"`
	WorkspaceOwnerID string  `json:"workspaceOwnerId"`
	MemberID         string  `json:"memberId"`
	MemberName       *string `json:"memberName"`
	MemberEmail      string  `json:"memberEmail"`
	MemberAvatarURL  *string `json:"memberAvatarUrl"`
	Role             string  `json:"role"`
	CreatedAt        string  `json:"createdAt"`
}

type workspaceMembership struct {
	OwnerID   string  `json:"ownerId"`
	OwnerName *string `json:"ownerName"`
	Role      string  `json:"role"`
	JoinedAt  string  `json:"joinedAt"`
}

type workspaceShareSummary struct {
	OwnerID            string                `json:"ownerId"`
	OwnerName          *string               `json:"ownerName"`
	Members            []workspaceMember     `json:"members"`
	Memberships        []workspaceMembership `json:"memberships"`
	PendingInvitations []shareInvitation     `json:"pendingInvitations"`
}

type workspaceShareResult struct {
	OK         bool             `json:"ok"`
	MemberID   string           `json:"memberId,omitempty"`
	Name       *string          `json:"name,omitempty"`
	Message    string           `json:"message"`
	Invitation *shareInvitation `json:"invitation,omitempty"`
}

func (c *client) getSharingSummary(entityType, entityID string) (shareSummary, error) {
	response, err := c.request(
		http.MethodGet,
		"/shares/entity/"+url.PathEscape(entityType)+"/"+url.PathEscape(entityID),
		nil,
		nil,
	)
	if err != nil {
		return shareSummary{}, err
	}
	var result shareSummary
	if err := decodeJSON(response, &result); err != nil {
		return shareSummary{}, err
	}
	return result, nil
}

func (c *client) grantEntityAccess(
	entityType, entityID, email, permission string,
) (shareGrantResult, error) {
	body, err := marshalBody(map[string]string{"email": email, "permission": permission})
	if err != nil {
		return shareGrantResult{}, err
	}
	response, err := c.request(
		http.MethodPost,
		"/shares/entity/"+url.PathEscape(entityType)+"/"+url.PathEscape(entityID)+"/grants",
		body,
		map[string]string{"Content-Type": "application/json"},
	)
	if err != nil {
		return shareGrantResult{}, err
	}
	var result shareGrantResult
	return result, decodeJSON(response, &result)
}

func (c *client) updateSharePermission(entityType, entityID, email, permission string) (shareGrantResult, error) {
	body, err := marshalBody(map[string]string{"permission": permission})
	if err != nil {
		return shareGrantResult{}, err
	}
	response, err := c.request(
		http.MethodPatch,
		"/shares/entity/"+url.PathEscape(entityType)+"/"+url.PathEscape(entityID)+"/grants/by-email/"+url.PathEscape(email),
		body,
		map[string]string{"Content-Type": "application/json"},
	)
	if err != nil {
		return shareGrantResult{}, err
	}
	var result shareGrantResult
	return result, decodeJSON(response, &result)
}

func (c *client) revokeShare(entityType, entityID, email string) (shareGrantResult, error) {
	response, err := c.request(http.MethodDelete,
		"/shares/entity/"+url.PathEscape(entityType)+"/"+url.PathEscape(entityID)+"/grants/by-email/"+url.PathEscape(email), nil, nil)
	if err != nil {
		return shareGrantResult{}, err
	}
	var result shareGrantResult
	return result, decodeJSON(response, &result)
}

func (c *client) leaveSharedEntity(entityType, entityID string) (shareGrantResult, error) {
	response, err := c.request(
		http.MethodPost,
		"/shares/entity/"+url.PathEscape(entityType)+"/"+url.PathEscape(entityID)+"/leave",
		nil,
		nil,
	)
	if err != nil {
		return shareGrantResult{}, err
	}
	var result shareGrantResult
	return result, decodeJSON(response, &result)
}

func (c *client) updatePublicAccess(
	entityType, entityID, permission string,
) (sharePublicResult, error) {
	body, err := marshalBody(map[string]string{"permission": permission})
	if err != nil {
		return sharePublicResult{}, err
	}
	response, err := c.request(
		http.MethodPatch,
		"/shares/entity/"+url.PathEscape(entityType)+"/"+url.PathEscape(entityID)+"/public-access",
		body,
		map[string]string{"Content-Type": "application/json"},
	)
	if err != nil {
		return sharePublicResult{}, err
	}
	var result sharePublicResult
	return result, decodeJSON(response, &result)
}

func (c *client) updateSharingInheritance(
	entityType, entityID, policy string,
) (shareInheritanceResult, error) {
	body, err := marshalBody(map[string]string{"policy": policy})
	if err != nil {
		return shareInheritanceResult{}, err
	}
	response, err := c.request(
		http.MethodPatch,
		"/shares/entity/"+url.PathEscape(entityType)+"/"+url.PathEscape(entityID)+"/inheritance",
		body,
		map[string]string{"Content-Type": "application/json"},
	)
	if err != nil {
		return shareInheritanceResult{}, err
	}
	var result shareInheritanceResult
	return result, decodeJSON(response, &result)
}

func entityInvitationEmailPath(entityType, entityID, email string) string {
	return "/shares/entity/" + url.PathEscape(entityType) + "/" + url.PathEscape(entityID) + "/invitations/by-email/" + url.PathEscape(email)
}

func workspaceInvitationEmailPath(email string) string {
	return "/shares/workspace/invitations/by-email/" + url.PathEscape(email)
}

func (c *client) resendEntityInvitation(entityType, entityID, email string) (shareInvitationResult, error) {
	return c.resendSharingInvitation(entityInvitationEmailPath(entityType, entityID, email))
}

func (c *client) revokeEntityInvitation(entityType, entityID, email string) (shareGrantResult, error) {
	return c.revokeSharingInvitation(entityInvitationEmailPath(entityType, entityID, email))
}

func (c *client) resendWorkspaceInvitation(email string) (shareInvitationResult, error) {
	return c.resendSharingInvitation(workspaceInvitationEmailPath(email))
}

func (c *client) revokeWorkspaceInvitation(email string) (shareGrantResult, error) {
	return c.revokeSharingInvitation(workspaceInvitationEmailPath(email))
}

func (c *client) resendSharingInvitation(path string) (shareInvitationResult, error) {
	response, err := c.request(
		http.MethodPost,
		path+"/resend",
		nil,
		nil,
	)
	if err != nil {
		return shareInvitationResult{}, err
	}
	var result shareInvitationResult
	return result, decodeJSON(response, &result)
}

func (c *client) revokeSharingInvitation(path string) (shareGrantResult, error) {
	response, err := c.request(
		http.MethodDelete,
		path,
		nil,
		nil,
	)
	if err != nil {
		return shareGrantResult{}, err
	}
	var result shareGrantResult
	return result, decodeJSON(response, &result)
}

func (c *client) getWorkspaceSharingSummary() (workspaceShareSummary, error) {
	response, err := c.request(http.MethodGet, "/shares/workspace", nil, nil)
	if err != nil {
		return workspaceShareSummary{}, err
	}
	var result workspaceShareSummary
	return result, decodeJSON(response, &result)
}

func (c *client) addWorkspaceMember(email, role string) (workspaceShareResult, error) {
	body, err := marshalBody(map[string]string{"email": email, "role": role})
	if err != nil {
		return workspaceShareResult{}, err
	}
	response, err := c.request(
		http.MethodPost,
		"/shares/workspace/members",
		body,
		map[string]string{"Content-Type": "application/json"},
	)
	if err != nil {
		return workspaceShareResult{}, err
	}
	var result workspaceShareResult
	return result, decodeJSON(response, &result)
}

func (c *client) updateWorkspaceMemberRole(email, role string) (workspaceShareResult, error) {
	body, err := marshalBody(map[string]string{"role": role})
	if err != nil {
		return workspaceShareResult{}, err
	}
	response, err := c.request(
		http.MethodPatch,
		"/shares/workspace/members/by-email/"+url.PathEscape(email),
		body,
		map[string]string{"Content-Type": "application/json"},
	)
	if err != nil {
		return workspaceShareResult{}, err
	}
	var result workspaceShareResult
	return result, decodeJSON(response, &result)
}

func (c *client) removeWorkspaceMember(email string) (workspaceShareResult, error) {
	response, err := c.request(
		http.MethodDelete,
		"/shares/workspace/members/by-email/"+url.PathEscape(email),
		nil,
		nil,
	)
	if err != nil {
		return workspaceShareResult{}, err
	}
	var result workspaceShareResult
	return result, decodeJSON(response, &result)
}

func (c *client) leaveWorkspace(ownerID string) (workspaceShareResult, error) {
	response, err := c.request(
		http.MethodDelete,
		"/shares/workspace/memberships/"+url.PathEscape(ownerID),
		nil,
		nil,
	)
	if err != nil {
		return workspaceShareResult{}, err
	}
	var result workspaceShareResult
	return result, decodeJSON(response, &result)
}
