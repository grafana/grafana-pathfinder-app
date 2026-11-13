package provider

import (
	"context"
	"errors"
	"testing"

	authlib "github.com/grafana/authlib/types"
)

type testIdentity struct {
	authlib.AuthInfo
	namespace string
}

func (i testIdentity) GetNamespace() string { return i.namespace }

func TestCallerNamespace(t *testing.T) {
	for _, tc := range []struct {
		name     string
		identity string
		route    string
		allowed  bool
	}{
		{"same tenant", "stacks-1", "stacks-1", true},
		{"local tenant", "default", "default", true},
		{"sibling tenant", "stacks-2", "stacks-1", false},
		{"wildcard identity", "*", "stacks-1", false},
		{"wildcard route", "*", "*", false},
		{"missing namespace", "", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := authlib.WithAuthInfo(context.Background(), testIdentity{namespace: tc.identity})
			namespace, err := callerNamespace(ctx, tc.route)
			if tc.allowed {
				if err != nil || namespace != tc.route {
					t.Fatalf("namespace=%q error=%v", namespace, err)
				}
			} else if !errors.Is(err, errUnboundCaller) || namespace != "" {
				t.Fatalf("accepted namespace=%q error=%v", namespace, err)
			}
		})
	}
}

func TestCallerNamespaceRejectsMissingIdentity(t *testing.T) {
	namespace, err := callerNamespace(context.Background(), "stacks-1")
	if !errors.Is(err, errUnboundCaller) || namespace != "" {
		t.Fatalf("accepted namespace=%q error=%v", namespace, err)
	}
}
