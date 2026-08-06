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
		ex, err := New("", "42", DefaultTokenExchangeURL)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ex != nil {
			t.Errorf("expected nil exchanger when no token present, got %#v", ex)
		}
	})

	t.Run("token and stack id build an exchanger", func(t *testing.T) {
		ex, err := New("cap-token", "42", DefaultTokenExchangeURL)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ex == nil {
			t.Fatal("expected non-nil exchanger")
		}
		if ex.stackID != "42" {
			t.Errorf("stackID = %q, want %q", ex.stackID, "42")
		}
	})

	t.Run("token without a stack id returns error", func(t *testing.T) {
		if _, err := New("cap-token", "", DefaultTokenExchangeURL); err == nil {
			t.Error("expected an error when a token is present but the stack id is missing")
		}
	})
}

func TestExchangerMint(t *testing.T) {
	fake := &fakeExchanger{token: "minted-token"}
	ex := &Exchanger{client: fake, stackID: "42"}

	got, err := ex.Mint(context.Background(), "id-token")
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	if got != "minted-token" {
		t.Errorf("token = %q, want %q", got, "minted-token")
	}
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
		ex := &Exchanger{client: &fakeExchanger{token: "minted-token"}, stackID: "42"}
		if _, err := ex.Mint(context.Background(), ""); err == nil {
			t.Error("expected an error when the caller has no id token")
		}
	})

	t.Run("exchange failure propagates", func(t *testing.T) {
		ex := &Exchanger{client: &fakeExchanger{err: errors.New("refused")}, stackID: "42"}
		if _, err := ex.Mint(context.Background(), "id-token"); err == nil {
			t.Error("expected the exchange error to propagate")
		}
	})
}
