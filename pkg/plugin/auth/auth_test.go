package auth

import (
	"context"
	"errors"
	"testing"

	"github.com/grafana/authlib/authn"
)

// fakeExchanger stands in for authlib's TokenExchanger: it records the request
// it was given and returns a canned token or error.
type fakeExchanger struct {
	got   authn.TokenExchangeRequest
	token string
	err   error
}

func (f *fakeExchanger) Exchange(_ context.Context, r authn.TokenExchangeRequest) (*authn.TokenExchangeResponse, error) {
	f.got = r
	if f.err != nil {
		return nil, f.err
	}
	return &authn.TokenExchangeResponse{Token: f.token}, nil
}

func TestNew(t *testing.T) {
	t.Run("no token provisioned returns nil exchanger, no error", func(t *testing.T) {
		ex, err := New("", DefaultTokenExchangeURL)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ex != nil {
			t.Errorf("expected nil exchanger when no token present, got %#v", ex)
		}
	})

	t.Run("a provisioned token builds an exchanger", func(t *testing.T) {
		ex, err := New("cap-token", DefaultTokenExchangeURL)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ex == nil {
			t.Fatal("expected non-nil exchanger")
		}
	})
}

func TestExchangerMint(t *testing.T) {
	fake := &fakeExchanger{token: "minted-token"}
	ex := &Exchanger{client: fake}

	got, err := ex.Mint(context.Background(), "stacks-42", "id-token")
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	if got != "minted-token" {
		t.Errorf("token = %q, want %q", got, "minted-token")
	}
	// Namespace is forwarded verbatim from the caller (the request
	// plugin-context), not built from a provisioned stack id.
	if fake.got.Namespace != "stacks-42" {
		t.Errorf("namespace = %q, want %q", fake.got.Namespace, "stacks-42")
	}
	if len(fake.got.Audiences) != 1 || fake.got.Audiences[0] != "grafana" {
		t.Errorf("audiences = %v, want [grafana]", fake.got.Audiences)
	}
	if fake.got.SubjectToken != "id-token" {
		t.Errorf("subjectToken = %q, want %q", fake.got.SubjectToken, "id-token")
	}
	if fake.got.ExpiresIn == nil || *fake.got.ExpiresIn != tokenTTLSeconds {
		t.Errorf("expiresIn = %v, want %d", fake.got.ExpiresIn, tokenTTLSeconds)
	}
}

func TestExchangerMintErrors(t *testing.T) {
	t.Run("no caller id token", func(t *testing.T) {
		ex := &Exchanger{client: &fakeExchanger{token: "minted-token"}}
		if _, err := ex.Mint(context.Background(), "stacks-42", ""); err == nil {
			t.Error("expected an error when the caller has no id token")
		}
	})

	t.Run("exchange failure propagates", func(t *testing.T) {
		ex := &Exchanger{client: &fakeExchanger{err: errors.New("refused")}}
		if _, err := ex.Mint(context.Background(), "stacks-42", "id-token"); err == nil {
			t.Error("expected the exchange error to propagate")
		}
	})
}
