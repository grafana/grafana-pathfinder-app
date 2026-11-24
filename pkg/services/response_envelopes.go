package services

import "github.com/grafana/grafana-pathfinder-app/pkg/achievements"

type AssignmentResponse struct {
	Capability  AssignmentCapability `json:"capability"`
	UserID      string               `json:"userId,omitempty"`
	Assignments []AssignmentEntry    `json:"assignments"`
	AsOf        string               `json:"asOf,omitempty"`
}

type CompletionCapability struct {
	Diagnostics     *ProxyDiagnostic `json:"diagnostics,omitempty"`
	Available       bool             `json:"available"`
	Reason          string           `json:"reason,omitempty"`
	ProgressRecords bool             `json:"progressRecords,omitempty"`
}

type CompletionResponse struct {
	Diagnostics *ProxyDiagnostic       `json:"diagnostics,omitempty"`
	Capability  CompletionCapability   `json:"capability"`
	UserID      string                 `json:"userId,omitempty"`
	Completions []CollatedCompletion   `json:"completions"`
	InProgress  []InProgressCompletion `json:"inProgress"`
	AsOf        string                 `json:"asOf,omitempty"`
}

type CatalogueResponse struct {
	Diagnostics *ProxyDiagnostic    `json:"diagnostics,omitempty"`
	Capability  CatalogueCapability `json:"capability"`
	Guides      []CatalogueEntry    `json:"guides"`
	AsOf        string              `json:"asOf,omitempty"`
}

type AchievementDefinitionsResponse struct {
	Version      string                            `json:"version"`
	ArtBase      string                            `json:"artBase"`
	Achievements []achievements.Display            `json:"achievements"`
	Sources      []achievements.SourceSubscription `json:"sources"`
}

type CatalogueCapability struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}
