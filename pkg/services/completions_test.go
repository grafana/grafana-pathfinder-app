package services

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCollation_CrossUserIsolation(t *testing.T) {
	byUser, _ := CollateCompletions([]CompletionRecord{
		rec("user:1", "bundled", "a", "A", "interactive", "", "objectives", "2026-07-10T00:00:00Z", 100),
		rec("user:2", "bundled", "b", "B", "interactive", "", "objectives", "2026-07-11T00:00:00Z", 100),
		rec("user:2", "bundled", "c", "C", "interactive", "", "objectives", "2026-07-12T00:00:00Z", 100),
	})

	body1 := byUser["user:1"]
	if len(body1) != 1 || body1[0].GuideID != "a" {
		t.Fatalf("user:1 should see only its own record, got %+v", body1)
	}

	body2 := byUser["user:2"]
	if len(body2) != 2 {
		t.Fatalf("user:2 should see 2 records, got %d", len(body2))
	}
	for _, e := range body2 {
		if e.GuideID == "a" {
			t.Fatalf("user:2 leaked user:1's record")
		}
	}
}

func TestCollation_DistinctGuidesSortedByLatestDescending(t *testing.T) {
	byUser, _ := CollateCompletions([]CompletionRecord{
		rec("user:1", "bundled", "older", "Older", "interactive", "", "objectives", "2026-07-10T00:00:00Z", 100),
		rec("user:1", "app-platform", "newer", "Newer", "documentation", "path-1", "manual", "2026-07-21T00:00:00Z", 50),
	})

	body := byUser["user:1"]

	if len(body) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(body))
	}
	if body[0].GuideID != "newer" {
		t.Errorf("expected newest guide first, got %q", body[0].GuideID)
	}
	if body[0].PathID != "path-1" {
		t.Errorf("pathId snapshot = %q, want path-1", body[0].PathID)
	}
}

func TestCollation_MultipleRecordsSameGuide(t *testing.T) {
	byUser, _ := CollateCompletions([]CompletionRecord{
		rec("user:1", "bundled", "linux", "Linux Server Integration", "interactive", "", "objectives", "2026-07-19T10:00:00Z", 80),
		rec("user:1", "bundled", "linux", "Linux Server Integration", "interactive", "", "manual", "2026-07-20T14:02:11Z", 100),
		rec("user:1", "bundled", "linux", "Linux Server Integration", "interactive", "", "objectives", "2026-07-18T09:00:00Z", 60),
	})

	body := byUser["user:1"]

	if len(body) != 1 {
		t.Fatalf("expected 1 collated entry, got %d", len(body))
	}
	e := body[0]
	if e.Count != 3 {
		t.Errorf("count = %d, want 3", e.Count)
	}
	if e.LatestCompletedAt != "2026-07-20T14:02:11Z" {
		t.Errorf("latestCompletedAt = %q, want the newest record", e.LatestCompletedAt)
	}
	if e.LatestSource != "manual" {
		t.Errorf("latestSource = %q, want manual (source of the latest record)", e.LatestSource)
	}
	if e.MaxCompletionPercent != 100 {
		t.Errorf("maxCompletionPercent = %d, want 100", e.MaxCompletionPercent)
	}
	if e.GuideTitle != "Linux Server Integration" {
		t.Errorf("guideTitle = %q", e.GuideTitle)
	}
}

func TestCollation_NewFieldsOmittedFromJSONWhenEmpty(t *testing.T) {
	completions, _ := CollateCompletions([]CompletionRecord{
		rec("user:1", "bundled", "linux", "Linux", "interactive", "", "objectives", "2026-09-01T00:00:00Z", 100),
	})
	raw, err := json.Marshal(completions["user:1"][0])
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"latestDurationSeconds", "lastRecordedAt", "latestAttemptStartedAt"} {
		if strings.Contains(string(raw), k) {
			t.Errorf("%s present in %s, want omitted", k, raw)
		}
	}

	partial := rec("user:1", "bundled", "linux", "Linux", "interactive", "", "objectives", "", 40)
	_, inProgress := CollateCompletions([]CompletionRecord{partial})
	rawPartial, err := json.Marshal(inProgress["user:1"][0])
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(rawPartial), "attemptStartedAt") {
		t.Errorf("attemptStartedAt present in %s, want omitted", rawPartial)
	}
}

func TestCollation_RecordedAndAttemptFields(t *testing.T) {
	done := func(completedAt string, duration int64, updated, started string) CompletionRecord {
		r := rec("user:1", "bundled", "linux", "Linux", "interactive", "", "objectives", completedAt, 100)
		r.DurationSeconds, r.LastUpdatedAt, r.AttemptStartedAt = duration, updated, started
		return r
	}
	attempt := func(updated, started string, percent int64) CompletionRecord {
		r := rec("user:1", "bundled", "linux", "Linux", "interactive", "", "objectives", "", percent)
		r.LastUpdatedAt, r.AttemptStartedAt = updated, started
		return r
	}

	tests := []struct {
		name         string
		records      []CompletionRecord
		wantCount    int
		wantDuration int64
		wantRecorded string
		wantStarted  string
		wantPartial  string
	}{
		{
			name: "newer attempt after a completion feeds recorded and started",
			records: []CompletionRecord{
				done("2026-09-01T14:03:22Z", 742, "2026-09-01T14:03:22Z", "2026-09-01T13:50:00Z"),
				attempt("2026-10-02T09:12:40Z", "2026-10-02T09:01:10Z", 40),
			},
			wantCount:    1,
			wantDuration: 742,
			wantRecorded: "2026-10-02T09:12:40Z",
			wantStarted:  "2026-10-02T09:01:10Z",
			wantPartial:  "2026-10-02T09:01:10Z",
		},
		{
			name: "duration comes from the newest completion, not the largest",
			records: []CompletionRecord{
				done("2026-09-01T00:00:00Z", 900, "2026-09-01T00:00:00Z", ""),
				done("2026-09-05T00:00:00Z", 30, "2026-09-05T00:00:00Z", ""),
			},
			wantCount:    2,
			wantDuration: 30,
			wantRecorded: "2026-09-05T00:00:00Z",
		},
		{
			name: "legacy records without annotations leave the new fields empty",
			records: []CompletionRecord{
				done("2026-09-01T00:00:00Z", 0, "", ""),
			},
			wantCount: 1,
		},
		{
			name: "unparseable timestamps never beat parseable ones",
			records: []CompletionRecord{
				done("2026-09-01T00:00:00Z", 5, "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
				done("2026-09-02T00:00:00Z", 5, "not-a-time", "garbage"),
			},
			wantCount:    2,
			wantDuration: 5,
			wantRecorded: "2026-09-01T00:00:00Z",
			wantStarted:  "2026-09-01T00:00:00Z",
		},
		{
			name: "hidden partial that started before the completion still feeds recency",
			records: []CompletionRecord{
				done("2026-09-01T14:03:22Z", 10, "2026-09-01T14:03:22Z", ""),
				attempt("2026-09-10T00:00:00Z", "2026-08-01T00:00:00Z", 60),
			},
			wantCount:    1,
			wantDuration: 10,
			wantRecorded: "2026-09-10T00:00:00Z",
			wantStarted:  "2026-08-01T00:00:00Z",
		},
		{
			name: "partial row at 60 percent does not count as done",
			records: []CompletionRecord{
				done("2026-09-01T00:00:00Z", 10, "2026-09-01T00:00:00Z", ""),
				attempt("2026-09-01T00:00:00Z", "2026-08-01T00:00:00Z", 60),
			},
			wantCount:    1,
			wantDuration: 10,
			wantRecorded: "2026-09-01T00:00:00Z",
			wantStarted:  "2026-08-01T00:00:00Z",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			completions, inProgress := CollateCompletions(tc.records)
			entries := completions["user:1"]
			if len(entries) != 1 {
				t.Fatalf("completions = %d, want 1", len(entries))
			}
			e := entries[0]
			if e.Count != tc.wantCount {
				t.Errorf("count = %d, want %d (attempt rows never count)", e.Count, tc.wantCount)
			}
			if e.LatestDurationSeconds != tc.wantDuration {
				t.Errorf("latestDurationSeconds = %d, want %d", e.LatestDurationSeconds, tc.wantDuration)
			}
			if e.LastRecordedAt != tc.wantRecorded {
				t.Errorf("lastRecordedAt = %q, want %q", e.LastRecordedAt, tc.wantRecorded)
			}
			if e.LatestAttemptStartedAt != tc.wantStarted {
				t.Errorf("latestAttemptStartedAt = %q, want %q", e.LatestAttemptStartedAt, tc.wantStarted)
			}
			got := ""
			if p := inProgress["user:1"]; len(p) == 1 {
				got = p[0].AttemptStartedAt
			}
			if got != tc.wantPartial {
				t.Errorf("inProgress attemptStartedAt = %q, want %q", got, tc.wantPartial)
			}
		})
	}
}

func TestCollation_SameIdDifferentSourceNotMerged(t *testing.T) {
	byUser, _ := CollateCompletions([]CompletionRecord{
		rec("user:1", "bundled", "x", "Bundled X", "interactive", "", "objectives", "2026-07-10T00:00:00Z", 100),
		rec("user:1", "remote-repo:acme", "x", "Remote X", "interactive", "", "objectives", "2026-07-11T00:00:00Z", 100),
	})

	body := byUser["user:1"]
	if len(body) != 2 {
		t.Fatalf("expected 2 distinct entries by (source,id), got %d", len(body))
	}
}

func rec(userID, guideSource, guideID, title, category, pathID, source, completedAt string, percent int64) CompletionRecord {
	return CompletionRecord{
		UserID:            userID,
		GuideID:           guideID,
		GuideSource:       guideSource,
		GuideTitle:        title,
		GuideCategory:     category,
		PathID:            pathID,
		Source:            source,
		CompletedAt:       completedAt,
		CompletionPercent: percent,
	}
}

func TestCollation_AmbiguousPartialTimeRemainsHidden(t *testing.T) {
	for _, updated := range []string{"2026-10-01T10:00:00Z", "invalid", ""} {
		_, inProgress := CollateCompletions([]CompletionRecord{
			doneRec("g", "2026-10-01T10:00:00Z"), partialRec("g", 40, updated),
		})
		if len(inProgress["user:1"]) != 0 {
			t.Fatalf("updated=%q: %+v", updated, inProgress)
		}
	}
}

func TestCollation_DelayedOldAttemptDoesNotReopenCompletedGuide(t *testing.T) {
	old := partialRec("g", 40, "2026-10-03T12:00:00Z")
	old.AttemptStartedAt = "2026-10-01T12:00:00Z"
	completed := doneRec("g", "2026-10-02T12:00:00Z")
	_, partials := CollateCompletions([]CompletionRecord{old, completed})
	if len(partials["user:1"]) != 0 {
		t.Fatalf("stale attempt resurfaced: %+v", partials)
	}
	fresh := partialRec("g", 20, "2026-10-03T11:00:00Z")
	fresh.AttemptStartedAt = "2026-10-03T10:00:00Z"
	_, partials = CollateCompletions([]CompletionRecord{old, completed, fresh})
	if len(partials["user:1"]) != 1 || partials["user:1"][0].CompletionPercent != 20 {
		t.Fatalf("latest attempt must win over late writes: %+v", partials)
	}
}

func TestCollation_OnlyPartialsGivesNoCompletionsEntry(t *testing.T) {
	byUser, inProgress := CollateCompletions([]CompletionRecord{partialRec("g", 20, "2026-10-03T10:00:00Z")})
	if len(byUser["user:1"]) != 0 || len(inProgress["user:1"]) != 1 {
		t.Fatalf("byUser=%+v inProgress=%+v", byUser, inProgress)
	}
}

func TestCollation_PartialNewerThanCompletionShows(t *testing.T) {
	_, inProgress := CollateCompletions([]CompletionRecord{
		doneRec("g", "2026-10-01T10:00:00Z"),
		partialRec("g", 20, "2026-10-03T10:00:00Z"),
		partialRec("g", 60, "2026-10-05T10:00:00Z"), // latest partial wins
	})
	got := inProgress["user:1"]
	if len(got) != 1 || got[0].CompletionPercent != 60 || got[0].LastUpdatedAt != "2026-10-05T10:00:00Z" {
		t.Fatalf("inProgress = %+v, want the latest partial (60)", got)
	}
}

func TestCollation_PartialsAreNotCompletions(t *testing.T) {
	byUser, inProgress := CollateCompletions([]CompletionRecord{
		doneRec("g", "2026-10-01T10:00:00Z"),
		partialRec("g", 40, "2026-09-30T10:00:00Z"), // older than the completion: hidden
		partialRec("h", 30, "2026-10-02T10:00:00Z"), // never completed: shown
	})

	if len(byUser["user:1"]) != 1 || byUser["user:1"][0].GuideID != "g" || byUser["user:1"][0].Count != 1 {
		t.Fatalf("completions = %+v, want g counted once", byUser["user:1"])
	}
	got := inProgress["user:1"]
	if len(got) != 1 || got[0].GuideID != "h" || got[0].CompletionPercent != 30 {
		t.Fatalf("inProgress = %+v, want only h", got)
	}
}

func doneRec(guideID, completedAt string) CompletionRecord {
	r := rec("user:1", "bundled", guideID, guideID, "interactive", "", "objectives", completedAt, 100)
	r.LastUpdatedAt = completedAt
	return r
}

func partialRec(guideID string, percent int64, updated string) CompletionRecord {
	r := rec("user:1", "bundled", guideID, guideID, "interactive", "", "objectives", "", percent)
	r.LastUpdatedAt = updated
	return r
}
