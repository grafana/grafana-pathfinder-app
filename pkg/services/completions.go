package services

import (
	"sort"
	"time"
)

type CompletionRecord struct {
	UserID            string `json:"userId"`
	UserLogin         string `json:"userLogin"`
	UserDisplayName   string `json:"userDisplayName"`
	GuideID           string `json:"guideId"`
	GuideSource       string `json:"guideSource"`
	GuideTitle        string `json:"guideTitle"`
	GuideCategory     string `json:"guideCategory"`
	PathID            string `json:"pathId"`
	Source            string `json:"source"`
	CompletedAt       string `json:"completedAt"`
	RecordedAt        string `json:"recordedAt"`
	CompletionPercent int64  `json:"completionPercent"`
	DurationSeconds   int64  `json:"durationSeconds"`

	LastUpdatedAt    string `json:"-"`
	AttemptStartedAt string `json:"-"`
}

type InProgressCompletion struct {
	GuideSource       string `json:"guideSource"`
	GuideID           string `json:"guideId"`
	GuideTitle        string `json:"guideTitle"`
	GuideCategory     string `json:"guideCategory"`
	PathID            string `json:"pathId"`
	CompletionPercent int64  `json:"completionPercent"`
	LastUpdatedAt     string `json:"lastUpdatedAt"`
	AttemptStartedAt  string `json:"attemptStartedAt,omitempty"`
}

type CollatedCompletion struct {
	GuideSource          string `json:"guideSource"`
	GuideID              string `json:"guideId"`
	GuideTitle           string `json:"guideTitle"`
	GuideCategory        string `json:"guideCategory"`
	PathID               string `json:"pathId"`
	Count                int    `json:"count"`
	LatestCompletedAt    string `json:"latestCompletedAt"`
	LatestSource         string `json:"latestSource"`
	MaxCompletionPercent int64  `json:"maxCompletionPercent"`

	LatestDurationSeconds  int64  `json:"latestDurationSeconds,omitempty"`
	LastRecordedAt         string `json:"lastRecordedAt,omitempty"`
	LatestAttemptStartedAt string `json:"latestAttemptStartedAt,omitempty"`
}

func CollateCompletions(records []CompletionRecord) (map[string][]CollatedCompletion, map[string][]InProgressCompletion) {
	type key struct{ source, id string }
	type acc struct {
		entry      CollatedCompletion
		latestTime time.Time
		latestOK   bool
		has        bool

		doneUpdated   time.Time
		doneUpdatedOK bool

		partial     InProgressCompletion
		partialTime time.Time
		partialOK   bool
		hasPartial  bool

		recorded       latestStamp
		attemptStarted latestStamp
	}

	perUser := map[string]map[key]*acc{}
	for _, rec := range records {
		if rec.UserID == "" {
			continue
		}
		groups := perUser[rec.UserID]
		if groups == nil {
			groups = map[key]*acc{}
			perUser[rec.UserID] = groups
		}
		k := key{rec.GuideSource, rec.GuideID}
		a := groups[k]
		if a == nil {
			a = &acc{entry: CollatedCompletion{GuideSource: rec.GuideSource, GuideID: rec.GuideID}}
			groups[k] = a
		}

		a.recorded.offer(rec.LastUpdatedAt)
		a.attemptStarted.offer(rec.AttemptStartedAt)

		updated, updatedOK := ParseCompletionTime(rec.CompletedAt)
		if rec.CompletedAt == "" {
			updated, updatedOK = ParseCompletionTime(rec.AttemptStartedAt)
			if !updatedOK {
				updated, updatedOK = ParseCompletionTime(rec.LastUpdatedAt)
			}
			if shouldReplaceLatest(a.partialTime, a.partialOK, a.hasPartial, updated, updatedOK) {
				a.partialTime, a.partialOK, a.hasPartial = updated, updatedOK, true
				a.partial = InProgressCompletion{
					GuideSource:       rec.GuideSource,
					GuideID:           rec.GuideID,
					GuideTitle:        rec.GuideTitle,
					GuideCategory:     rec.GuideCategory,
					PathID:            rec.PathID,
					CompletionPercent: rec.CompletionPercent,
					LastUpdatedAt:     rec.LastUpdatedAt,
					AttemptStartedAt:  rec.AttemptStartedAt,
				}
			}
			continue
		}
		if updatedOK && (!a.doneUpdatedOK || updated.After(a.doneUpdated)) {
			a.doneUpdated, a.doneUpdatedOK = updated, true
		}

		a.entry.Count++
		if rec.CompletionPercent > a.entry.MaxCompletionPercent {
			a.entry.MaxCompletionPercent = rec.CompletionPercent
		}

		t, ok := ParseCompletionTime(rec.CompletedAt)
		if shouldReplaceLatest(a.latestTime, a.latestOK, a.has, t, ok) {
			a.latestTime, a.latestOK, a.has = t, ok, true
			a.entry.LatestCompletedAt = rec.CompletedAt
			a.entry.LatestSource = rec.Source
			a.entry.LatestDurationSeconds = rec.DurationSeconds
			a.entry.GuideTitle = rec.GuideTitle
			a.entry.GuideCategory = rec.GuideCategory
			a.entry.PathID = rec.PathID
		}
	}

	result := map[string][]CollatedCompletion{}
	inProgress := map[string][]InProgressCompletion{}
	for userID, groups := range perUser {
		entries := make([]CollatedCompletion, 0, len(groups))
		var partials []InProgressCompletion
		for _, a := range groups {
			if a.entry.Count > 0 {
				a.entry.LastRecordedAt = a.recorded.raw
				a.entry.LatestAttemptStartedAt = a.attemptStarted.raw
				entries = append(entries, a.entry)
			}
			if a.hasPartial && (a.entry.Count == 0 || (a.partialOK && a.doneUpdatedOK && a.partialTime.After(a.doneUpdated))) {
				partials = append(partials, a.partial)
			}
		}
		sort.SliceStable(entries, func(i, j int) bool {
			return completionEntryLess(entries[j], entries[i]) // descending by latestCompletedAt
		})
		sort.SliceStable(partials, func(i, j int) bool {
			return inProgressLess(partials[j], partials[i]) // descending by lastUpdatedAt
		})
		if len(entries) > 0 {
			result[userID] = entries
		}
		if len(partials) > 0 {
			inProgress[userID] = partials
		}
	}
	return result, inProgress
}

func inProgressLess(x, y InProgressCompletion) bool {
	tx, okx := ParseCompletionTime(x.LastUpdatedAt)
	ty, oky := ParseCompletionTime(y.LastUpdatedAt)
	if okx && oky && !tx.Equal(ty) {
		return tx.Before(ty)
	}
	if okx != oky {
		return oky
	}
	if x.GuideSource != y.GuideSource {
		return x.GuideSource > y.GuideSource
	}
	return x.GuideID > y.GuideID
}

type latestStamp struct {
	raw string
	t   time.Time
	ok  bool
	has bool
}

func (l *latestStamp) offer(s string) {
	if s == "" {
		return
	}
	t, ok := ParseCompletionTime(s)
	if shouldReplaceLatest(l.t, l.ok, l.has, t, ok) {
		l.raw, l.t, l.ok, l.has = s, t, ok, true
	}
}

func shouldReplaceLatest(curTime time.Time, curOK, has bool, t time.Time, ok bool) bool {
	if !has {
		return true
	}
	if ok && curOK {
		return t.After(curTime)
	}
	if ok && !curOK {
		return true
	}
	return false
}

func completionEntryLess(x, y CollatedCompletion) bool {
	tx, okx := ParseCompletionTime(x.LatestCompletedAt)
	ty, oky := ParseCompletionTime(y.LatestCompletedAt)
	if okx && oky {
		if tx.Equal(ty) {
			return x.LatestCompletedAt < y.LatestCompletedAt
		}
		return tx.Before(ty)
	}
	if okx != oky {
		return oky // the one that parsed is "smaller" (earlier), so unparseable sorts last in ascending
	}
	return x.LatestCompletedAt < y.LatestCompletedAt
}

func ParseCompletionTime(s string) (time.Time, bool) {
	if s == "" {
		return time.Time{}, false
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t, true
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, true
	}
	return time.Time{}, false
}
