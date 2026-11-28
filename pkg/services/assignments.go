package services

import "context"

type Assignment struct {
	Name            string `json:"-"`
	ResourceVersion string `json:"-"`
	StatusSatisfied *bool  `json:"-"`

	UserID       string `json:"userId"`
	TargetType   string `json:"targetType"`
	TargetID     string `json:"targetId"`
	TrackID      string `json:"trackId"`
	TargetSource string `json:"targetSource"`

	RuleID     string `json:"ruleId"`
	AssignedBy string `json:"assignedBy"`
	AssignedAt string `json:"assignedAt"`

	DueAt                 string `json:"dueAt"`
	AcceptCompletionsFrom string `json:"acceptCompletionsFrom"`

	Lifecycle string `json:"lifecycle"`
}

type AssignmentPage struct {
	Records  []Assignment
	Continue string
}

type AssignmentReader interface {
	ListPage(context.Context, string, string) (*AssignmentPage, error)
}

func ReadAssignments(ctx context.Context, namespace, userID string, lister AssignmentReader) ([]Assignment, error) {
	records := []Assignment{}
	continueToken := ""
	for {
		page, err := lister.ListPage(ctx, namespace, continueToken)
		if err != nil {
			return nil, err
		}
		for _, rec := range page.Records {
			if rec.UserID == userID && rec.Lifecycle == "active" {
				records = append(records, rec)
			}
		}
		if page.Continue == "" {
			return records, nil
		}
		continueToken = page.Continue
	}
}
