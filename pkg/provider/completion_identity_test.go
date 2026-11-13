package provider

import (
	"context"
	authlib "github.com/grafana/authlib/types"
	"testing"
)

type writerIdentity struct{ completionIdentity }

func (writerIdentity) GetUsername() string { return "login" }
func (writerIdentity) GetName() string     { return "Display" }
func TestCompletionCallerUsesAuthenticatedNamespace(t *testing.T) {
	for _, tc := range []struct {
		namespace string
		org       int64
	}{{"default", 1}, {"org-27", 27}, {"stacks-123", 1}, {"unknown", 0}, {"*", 0}, {"org-1", 0}} {
		t.Run(tc.namespace, func(t *testing.T) {
			ctx := authlib.WithAuthInfo(context.Background(), writerIdentity{completionIdentity{testIdentity: testIdentity{namespace: tc.namespace}, subject: "user:7"}})
			got, err := completionCaller(ctx, tc.namespace)
			if tc.org == 0 {
				if err == nil {
					t.Fatal("invalid namespace accepted")
				}
				return
			}
			if err != nil || got.OrgID != tc.org || got.Subject != "user:7" || got.Login != "login" || got.DisplayName != "Display" {
				t.Fatalf("identity=%+v err=%v", got, err)
			}
			if _, err := completionCaller(ctx, "org-99"); err == nil {
				t.Fatal("cross-namespace identity accepted")
			}
		})
	}
}
