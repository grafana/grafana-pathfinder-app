package services

import (
	"fmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	completionMaxIDLen           = 256
	completionMaxTitleLen        = 1024
	completionMaxDisplayLen      = 256
	completionMaxClockSkew       = 5 * time.Minute
	completionMaxBackdate        = 30 * 24 * time.Hour
	completionMaxDurationMs      = 24 * 60 * 60 * 1000
	completionWriteSchemaVersion = 1
)

var (
	completionValidSources    = map[string]bool{"objectives": true, "manual": true, "skipped": true}
	completionValidCategories = map[string]bool{"interactive": true, "documentation": true, "learning-journey": true}
	completionValidPlatforms  = map[string]bool{"oss": true, "cloud": true}
)

type CompletionWriteRequest struct {
	GuideSource       string `json:"guideSource"`
	GuideID           string `json:"guideId"`
	GuideTitle        string `json:"guideTitle"`
	GuideCategory     string `json:"guideCategory"`
	PathID            string `json:"pathId"`
	CompletionPercent int64  `json:"completionPercent"`
	Source            string `json:"source"`
	CompletedAt       string `json:"completedAt"`
	DurationMs        *int64 `json:"durationMs"`
	Platform          string `json:"platform"`

	IdempotencyKey string `json:"idempotencyKey"`

	AttemptID        string `json:"attemptId,omitempty"`
	AttemptStartedAt string `json:"attemptStartedAt,omitempty"`
}

func BuildCompletionSpec(req CompletionWriteRequest, userID, userLogin, userDisplayName, namespace string, orgID int64, now time.Time, logger log.Logger) (CompletionRecordWriteSpec, error) {
	if req.GuideID == "" || req.GuideSource == "" {
		return CompletionRecordWriteSpec{}, fmt.Errorf("guideId and guideSource are required")
	}
	if strings.TrimSpace(req.IdempotencyKey) == "" {
		return CompletionRecordWriteSpec{}, fmt.Errorf("idempotencyKey is required")
	}
	for _, f := range []struct {
		name  string
		value string
		max   int
	}{
		{"guideId", req.GuideID, completionMaxIDLen},
		{"guideSource", req.GuideSource, completionMaxIDLen},
		{"pathId", req.PathID, completionMaxIDLen},
		{"guideTitle", req.GuideTitle, completionMaxTitleLen},
		{"idempotencyKey", req.IdempotencyKey, completionMaxIDLen},
		{"attemptId", req.AttemptID, completionMaxIDLen},
	} {
		if err := ValidateBoundedText(f.name, f.value, f.max); err != nil {
			return CompletionRecordWriteSpec{}, err
		}
	}
	if !completionValidSources[req.Source] {
		return CompletionRecordWriteSpec{}, fmt.Errorf("invalid source")
	}
	if !completionValidCategories[req.GuideCategory] {
		return CompletionRecordWriteSpec{}, fmt.Errorf("invalid guideCategory")
	}
	if !completionValidPlatforms[req.Platform] {
		return CompletionRecordWriteSpec{}, fmt.Errorf("invalid platform")
	}
	if req.CompletionPercent < 0 || req.CompletionPercent > 100 {
		return CompletionRecordWriteSpec{}, fmt.Errorf("completionPercent out of range")
	}
	if req.AttemptID != "" && strings.TrimSpace(req.AttemptID) != req.AttemptID {
		return CompletionRecordWriteSpec{}, fmt.Errorf("invalid attemptId")
	}
	if req.AttemptStartedAt != "" {
		started, err := time.Parse(time.RFC3339Nano, req.AttemptStartedAt)
		if err != nil || started.IsZero() || started.After(now.Add(completionMaxClockSkew)) {
			return CompletionRecordWriteSpec{}, fmt.Errorf("invalid attemptStartedAt")
		}
	}
	if err := ValidateCompletedAt(req.CompletedAt, now); err != nil {
		return CompletionRecordWriteSpec{}, err
	}

	durationSeconds := int64(0)
	if req.DurationMs != nil {
		durationMs := *req.DurationMs
		if clamped := min(max(durationMs, 0), int64(completionMaxDurationMs)); clamped != durationMs {
			logger.Info("completion write: durationMs out of range, clamped",
				"received", durationMs, "clamped", clamped)
			durationMs = clamped
		}
		durationSeconds = durationMs / 1000
	}

	return CompletionRecordWriteSpec{
		GuideID:           req.GuideID,
		GuideSource:       req.GuideSource,
		GuideTitle:        req.GuideTitle,
		PathID:            req.PathID,
		Source:            req.Source,
		CompletedAt:       req.CompletedAt,
		DurationSeconds:   durationSeconds,
		CompletionPercent: req.CompletionPercent,
		GuideCategory:     req.GuideCategory,
		Platform:          req.Platform,

		UserID:          userID,
		UserLogin:       BoundedIdentityField(userLogin, completionMaxDisplayLen),
		UserDisplayName: BoundedIdentityField(userDisplayName, completionMaxDisplayLen),
		RecordedAt:      now.UTC().Format(time.RFC3339),
		OrgID:           orgID,
		StackNamespace:  namespace,
		SchemaVersion:   completionWriteSchemaVersion,
	}, nil
}

func ValidateBoundedText(field, value string, maxBytes int) error {
	if len(value) > maxBytes {
		return fmt.Errorf("%s exceeds %d bytes", field, maxBytes)
	}
	if !utf8.ValidString(value) {
		return fmt.Errorf("%s contains invalid UTF-8", field)
	}
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return fmt.Errorf("%s contains control characters", field)
		}
	}
	return nil
}

func ValidateCompletedAt(s string, now time.Time) error {
	t, ok := ParseCompletionTime(s)
	if !ok {
		return fmt.Errorf("completedAt is not a valid RFC 3339 timestamp")
	}
	if t.After(now.Add(completionMaxClockSkew)) {
		return fmt.Errorf("completedAt is in the future")
	}
	if t.Before(now.Add(-completionMaxBackdate)) {
		return fmt.Errorf("completedAt is too far in the past")
	}
	return nil
}

func BoundedIdentityField(s string, maxBytes int) string {
	var b strings.Builder
	for _, r := range s {
		if r < 0x20 || r == 0x7f {
			continue
		}
		if b.Len()+utf8.RuneLen(r) > maxBytes {
			break
		}
		b.WriteRune(r)
	}
	return b.String()
}
