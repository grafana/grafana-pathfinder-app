package auth

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/grafana/authlib/authn"
)

// signingKeysPath is Grafana's own instance's JWKS endpoint: unauthenticated,
// serving the public keys used to sign ID tokens (Cache-Control: public,
// max-age=3600). Same app URL the OBO exchange and both proxy routes already
// resolve per-request.
const signingKeysPath = "/api/signing-keys/keys"

// ErrMissingExpiry means a token verified (signature, nbf) but carries no
// `exp` claim. go-jose's own validation only rejects an expired token when
// `exp` is present at all (jwt/validation.go: `if c.Expiry != nil`) — an
// absent claim is silently treated as non-expiring — so this check has to run
// on top of authlib's Verify rather than be assumed subsumed by it.
var ErrMissingExpiry = errors.New("id token missing exp claim")

// IdentityVerifier verifies inbound Grafana ID tokens against the issuing
// stack's own JWKS, mirroring Grafana's own ext_jwt authn client: signature
// plus exp/nbf checks with go-jose's default one-minute leeway, and
// deliberately no audience check (Grafana's ID-token issuer skips it for this
// token type too — the namespace claim serves that role instead). Safe for
// concurrent use.
//
// Verifiers are built lazily, one per app URL, because the app URL is only
// known per-request (from plugin config), not at plugin-instantiation time.
type IdentityVerifier struct {
	mu        sync.Mutex
	verifiers map[string]*authn.IDTokenVerifier
}

// NewIdentityVerifier builds an IdentityVerifier with no per-app-URL state
// yet; each app URL's verifier (and its key retriever/cache) is constructed
// on first use and reused for the life of the plugin instance.
func NewIdentityVerifier() *IdentityVerifier {
	return &IdentityVerifier{verifiers: map[string]*authn.IDTokenVerifier{}}
}

func (v *IdentityVerifier) verifierFor(appURL string) *authn.IDTokenVerifier {
	v.mu.Lock()
	defer v.mu.Unlock()
	if existing, ok := v.verifiers[appURL]; ok {
		return existing
	}
	keys := authn.NewKeyRetriever(authn.KeyRetrieverConfig{SigningKeysURL: appURL + signingKeysPath})
	verifier := authn.NewIDTokenVerifier(authn.VerifierConfig{}, keys)
	v.verifiers[appURL] = verifier
	return verifier
}

// VerifySubject verifies token's signature, type (`jwt`), and nbf/exp against
// appURL's JWKS, and returns its `sub` claim VERBATIM, typed prefix included
// (e.g. "user:abc123"). It fails closed on any problem: malformed token,
// wrong or unknown signing key, wrong token type, not-yet-valid, expired, a
// missing `exp` claim, or an unreachable JWKS endpoint.
func (v *IdentityVerifier) VerifySubject(ctx context.Context, appURL, token string) (string, error) {
	if appURL == "" {
		return "", errors.New("cannot verify an id token without an app url")
	}
	if token == "" {
		return "", errors.New("empty id token")
	}

	claims, err := v.verifierFor(appURL).Verify(ctx, token)
	if err != nil {
		return "", fmt.Errorf("verify id token: %w", err)
	}
	if claims.Expiry == nil {
		return "", ErrMissingExpiry
	}
	return claims.Subject, nil
}
