package main

type page struct {
	ID         string         `json:"id"`
	ParentID   *string        `json:"parentId"`
	Title      string         `json:"title"`
	Icon       *string        `json:"icon"`
	OwnerID    *string        `json:"ownerId"`
	Permission *string        `json:"permission"`
	Properties map[string]any `json:"properties"`
	CreatedAt  *string        `json:"createdAt"`
	UpdatedAt  *string        `json:"updatedAt"`
	DeletedAt  *string        `json:"deletedAt"`
}

type pageList struct {
	Data       []page  `json:"data"`
	NextCursor *string `json:"nextCursor"`
}

type pageResolutionItem struct {
	page
	FolderPath string `json:"folderPath"`
}

type pageResolution struct {
	Data []pageResolutionItem `json:"data"`
}

type searchResult struct {
	Type       string  `json:"type"`
	ID         string  `json:"id"`
	Title      string  `json:"title,omitempty"`
	Name       string  `json:"name,omitempty"`
	Icon       *string `json:"icon"`
	FolderPath string  `json:"folderPath"`
}

func (result searchResult) displayName() string {
	if result.Title != "" {
		return result.Title
	}
	return result.Name
}

type folder struct {
	ID         string  `json:"id"`
	ParentID   *string `json:"parentId"`
	Name       string  `json:"name"`
	Icon       *string `json:"icon"`
	OwnerID    *string `json:"ownerId"`
	Permission *string `json:"permission"`
	CreatedAt  *string `json:"createdAt"`
	UpdatedAt  *string `json:"updatedAt"`
	DeletedAt  *string `json:"deletedAt"`
}

type folderList struct {
	Data       []folder `json:"data"`
	NextCursor *string  `json:"nextCursor"`
}

type editResult struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Reason string `json:"reason,omitempty"`
}

type editResponse struct {
	Results []editResult `json:"results"`
	ETag    string       `json:"etag"`
}

type authenticatedUser struct {
	ID             string       `json:"id"`
	Name           string       `json:"name"`
	Email          string       `json:"email"`
	Image          *string      `json:"image"`
	Authentication string       `json:"authentication"`
	Scopes         []tokenScope `json:"scopes,omitempty"`
}

type tokenScope string

const (
	tokenScopePagesRead  tokenScope = "pages:read"
	tokenScopePagesWrite tokenScope = "pages:write"
)

func tokenAccess(scopes []tokenScope) string {
	hasRead := false
	hasWrite := false
	hasUnknown := false
	for _, scope := range scopes {
		switch scope {
		case tokenScopePagesRead:
			hasRead = true
		case tokenScopePagesWrite:
			hasWrite = true
		default:
			hasUnknown = true
		}
	}
	if hasUnknown {
		return "Unknown"
	}
	if hasRead && hasWrite {
		return "Read and write"
	}
	if hasRead {
		return "Read-only"
	}
	if len(scopes) > 0 {
		return "Unknown"
	}
	return ""
}

type loginResult struct {
	Server string            `json:"server"`
	User   authenticatedUser `json:"user"`
}

type jsonError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

type jsonErrorEnvelope struct {
	Error jsonError `json:"error"`
}
