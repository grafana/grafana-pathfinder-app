package provider

import (
	"context"
	"encoding/base64"
	authlib "github.com/grafana/authlib/types"
	"testing"
)

type adminIdentity struct {
	completionIdentity
	idToken, accessToken string
}

func (i adminIdentity) GetIDToken() string     { return i.idToken }
func (i adminIdentity) GetAccessToken() string { return i.accessToken }
func TestCallerAdminUsesBoundAuthenticatedClaims(t *testing.T) {
	for _, tc := range []struct {
		name, payload string
		access, want  bool
	}{
		{"admin", `{"sub":"user:1","namespace":"default","role":"Admin"}`, false, true},
		{"editor", `{"sub":"user:1","namespace":"default","role":"Editor"}`, false, false},
		{"other namespace", `{"sub":"user:1","namespace":"other","role":"Admin"}`, false, false},
		{"other subject", `{"sub":"user:2","namespace":"default","role":"Admin"}`, false, false},
		{"delegated admin", `{"namespace":"default","act":{"sub":"user:1","role":"Admin"}}`, true, true},
		{"outer admin inner viewer", `{"namespace":"default","role":"Admin","act":{"sub":"user:1","role":"Viewer"}}`, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			i := adminIdentity{completionIdentity: completionIdentity{testIdentity: testIdentity{namespace: "default"}, subject: "user:1"}}
			token := "header." + base64.RawURLEncoding.EncodeToString([]byte(tc.payload)) + ".signature"
			if tc.access {
				i.accessToken = token
			} else {
				i.idToken = token
			}
			if got := callerIsAdmin(authlib.WithAuthInfo(context.Background(), i), "default"); got != tc.want {
				t.Fatalf("admin=%v want %v", got, tc.want)
			}
		})
	}
	if callerIsAdmin(context.Background(), "default") {
		t.Fatal("missing identity authorized")
	}
}
