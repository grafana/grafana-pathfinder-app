package provider

import (
	"context"
	"encoding/base64"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/grafana/authlib/authn"
	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
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
			if err != nil || got.OrgID != tc.org || got.Subject != "user:7" || got.Login != "login" || got.DisplayName != "" {
				t.Fatalf("identity=%+v err=%v", got, err)
			}
			if _, err := completionCaller(ctx, "org-99"); err == nil {
				t.Fatal("cross-namespace identity accepted")
			}
		})
	}
}

func TestExchangedTokenPreservesLegacyCompletionSubject(t *testing.T) {
	identity := authn.NewAccessTokenAuthInfo(authn.Claims[authn.AccessTokenClaims]{
		Claims: jwt.Claims{Subject: "access-policy:sdk-runtime"},
		Rest: authn.AccessTokenClaims{Namespace: "stacks-123", Actor: &authn.ActorClaims{
			Subject: "service-account:proxy", Actor: &authn.ActorClaims{
				Subject: "user:7", IDTokenClaims: authn.IDTokenClaims{Type: authlib.TypeUser, Identifier: "stable-uid", Username: "login", DisplayName: "Display"},
			},
		}},
	})
	caller, err := completionCaller(authlib.WithAuthInfo(context.Background(), identity), "stacks-123")
	if err != nil || caller.Subject != "user:7" {
		t.Fatalf("caller=%+v err=%v", caller, err)
	}
	if got := services.CompletionRecordName(caller.Subject, "retry-123"); got != "completion-df5340bff44a0435769e4b6f6641face" {
		t.Fatalf("legacy record name changed: %s", got)
	}
}

func TestCompletionDisplayNameDoesNotUseProfileFallback(t *testing.T) {
	for _, tc := range []struct{ payload, want string }{
		{`{"namespace":"default","act":{"sub":"user:1","name":"Display"}}`, "Display"},
		{`{"namespace":"default","act":{"sub":"user:1","username":"login","email":"private@example.com"}}`, ""},
		{`{"namespace":"default","name":"Outer","act":{"sub":"user:1"}}`, ""},
		{`{"namespace":"default","act":{"sub":"user:2","name":"Wrong subject"}}`, ""},
		{`{"namespace":"other","act":{"sub":"user:1","name":"Wrong namespace"}}`, ""},
	} {
		identity := adminIdentity{completionIdentity: completionIdentity{testIdentity: testIdentity{namespace: "default"}, subject: "user:1"}, accessToken: "header." + base64.RawURLEncoding.EncodeToString([]byte(tc.payload)) + ".signature"}
		got, err := completionCaller(authlib.WithAuthInfo(context.Background(), identity), "default")
		if err != nil || got.DisplayName != tc.want {
			t.Fatalf("caller=%+v err=%v want name %q", got, err, tc.want)
		}
	}
}
