package services

import "context"

type CompletionRecordWriteSpec struct {
	AttemptStartedAt string `json:"-"`
	GuideID          string `json:"guideId"`
	GuideSource      string `json:"guideSource"`
	GuideTitle       string `json:"guideTitle"`
	PathID           string `json:"pathId"`
	Source           string `json:"source"`
	// CompletedAt is omitted on an in-progress attempt record: it is set once,
	// when the attempt reaches 100%. Legacy (non-attempt) writes always set it.
	CompletedAt       string `json:"completedAt,omitempty"`
	DurationSeconds   int64  `json:"durationSeconds"`
	CompletionPercent int64  `json:"completionPercent"`
	GuideCategory     string `json:"guideCategory"`
	Platform          string `json:"platform"`

	UserID          string `json:"userId"`
	UserLogin       string `json:"userLogin"`
	UserDisplayName string `json:"userDisplayName"`
	RecordedAt      string `json:"recordedAt"`
	OrgID           int64  `json:"orgId"`
	StackNamespace  string `json:"stackNamespace"`
	SchemaVersion   int64  `json:"schemaVersion"`
}

type CompletionRecordObjectMeta struct {
	Name        string            `json:"name"`
	Namespace   string            `json:"namespace"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

type StoredCompletionRecord struct {
	Raw  map[string]any
	Spec CompletionRecordWriteSpec
}

type CompletionRecordObject struct {
	APIVersion string                     `json:"apiVersion"`
	Kind       string                     `json:"kind"`
	Metadata   CompletionRecordObjectMeta `json:"metadata"`
	Spec       CompletionRecordWriteSpec  `json:"spec"`
}

type CompletionRecordUpdater interface {
	Create(context.Context, string, CompletionRecordObject) error
	Get(context.Context, string, string) (*StoredCompletionRecord, error)
	Replace(context.Context, string, string, map[string]any) error
}
