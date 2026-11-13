package services

import (
	"context"
	"errors"
	"reflect"
	"testing"
)

type fidelityAssignmentReader func(context.Context, string, string) (*AssignmentPage, error)

func (f fidelityAssignmentReader) ListPage(ctx context.Context, ns, token string) (*AssignmentPage, error) {
	return f(ctx, ns, token)
}
func TestAssignmentCarryoverLifecycleRulesAndPagination(t *testing.T) {
	calls := []string{}
	reader := fidelityAssignmentReader(func(_ context.Context, ns, token string) (*AssignmentPage, error) {
		if ns != "org-7" {
			t.Fatal("namespace changed")
		}
		calls = append(calls, token)
		if token == "" {
			return &AssignmentPage{Continue: "last", Records: []Assignment{{UserID: "user:1", Lifecycle: "withdrawn"}, {UserID: "user:1", Lifecycle: "future"}, {UserID: "user:2", Lifecycle: "active"}}}, nil
		}
		return &AssignmentPage{Records: []Assignment{{Name: "one", UserID: "user:1", Lifecycle: "active", RuleID: "rule-1", TargetID: "same"}, {Name: "two", UserID: "user:1", Lifecycle: "active", RuleID: "rule-2", TargetID: "same"}}}, nil
	})
	rows, err := ReadAssignments(context.Background(), "org-7", "user:1", reader)
	if err != nil || len(rows) != 2 || rows[0].RuleID != "rule-1" || rows[1].RuleID != "rule-2" || !reflect.DeepEqual(calls, []string{"", "last"}) {
		t.Fatalf("rows=%+v calls=%v err=%v", rows, calls, err)
	}
}
func TestAssignmentCarryoverDoesNotServeIncompleteList(t *testing.T) {
	failure := errors.New("second page unavailable")
	reader := fidelityAssignmentReader(func(_ context.Context, _, token string) (*AssignmentPage, error) {
		if token == "" {
			return &AssignmentPage{Continue: "next", Records: []Assignment{{UserID: "user:1", Lifecycle: "active"}}}, nil
		}
		return nil, failure
	})
	rows, err := ReadAssignments(context.Background(), "default", "user:1", reader)
	if !errors.Is(err, failure) || rows != nil {
		t.Fatalf("incomplete list served: %+v %v", rows, err)
	}
}
