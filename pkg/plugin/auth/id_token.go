package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/grafana/authlib/authn"
)

// SigningKeysPath is where a Grafana instance publishes the public JWKS it
// signs ID tokens with. It needs no authentication and no provisioning: the
// stack that issues the ID token also serves the key that verifies it.
const SigningKeysPath = "/api/signing-keys/keys"

// signingKeysFetchTimeout bounds one JWKS fetch. authlib's key retriever
// defaults to http.DefaultClient, which has no timeout, and the fetch runs
// inline in the identity gate of every proxy route.
const signingKeysFetchTimeout = 5 * time.Second

// ErrMissingExpiry rejects an ID token carrying no `exp` claim. go-jose
// validates expiry only when the claim is present, so without this an
// `exp`-less token would verify as non-expiring.
var ErrMissingExpiry = errors.New("id token has no exp claim")

// IDTokenVerifier cryptographically verifies inbound Grafana ID tokens
// (X-Grafana-Id) against the issuing stack's published signing keys.
//
// Safe for concurrent use. Authlib caches fetched keys for the lifetime of this
// verifier, so callers must reuse it across requests but replace it on a bounded
// schedule to preserve key-removal revocation.
type IDTokenVerifier struct {
	verifier *authn.IDTokenVerifier
}

// NewIDTokenVerifier builds a verifier against the signing keys appURL
// publishes. Audience is deliberately not validated (see the trust boundary in
// docs/design/BACKEND_PROXY_PATTERN.md §3).
func NewIDTokenVerifier(appURL string) (*IDTokenVerifier, error) {
	keysURL, err := signingKeysURL(appURL)
	if err != nil {
		return nil, err
	}

	keys := authn.NewKeyRetriever(
		authn.KeyRetrieverConfig{SigningKeysURL: keysURL},
		authn.WithHTTPClientKeyRetrieverOpt(&http.Client{
			Timeout: signingKeysFetchTimeout,
			// A redirect off the stack's host would hand key selection to whatever
			// origin it lands on, which forges any `sub` the proxies then trust.
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if req.URL.Hostname() != via[0].URL.Hostname() {
					return fmt.Errorf("signing-keys redirect left the stack host: %s", req.URL.Hostname())
				}
				return nil
			},
		}),
	)
	return &IDTokenVerifier{verifier: authn.NewIDTokenVerifier(authn.VerifierConfig{}, keys)}, nil
}

// signingKeysURL joins SigningKeysPath onto the stack's app URL. Grafana's
// root_url conventionally ends in "/", and a doubled slash 404s the JWKS —
// which would silently fail every request closed — so the join must collapse it.
func signingKeysURL(appURL string) (string, error) {
	keysURL, err := url.JoinPath(appURL, SigningKeysPath)
	if err != nil {
		return "", fmt.Errorf("building signing-keys URL from %q: %w", appURL, err)
	}
	return keysURL, nil
}

// Verify checks the token's signature, type, and expiry, and returns its `sub`
// claim VERBATIM, typed prefix included (e.g. "user:abc123"). A verified token
// may legitimately carry no subject, so ("", nil) is a success.
func (v *IDTokenVerifier) Verify(ctx context.Context, token string) (string, error) {
	// Detached from the caller's cancellation, bounded so detached never means
	// unkillable: authlib singleflights the key fetch across concurrent callers,
	// so the leader's canceled request would otherwise fail every waiter with a
	// spurious signing-keys outage. The key fetch is Verify's only I/O.
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), signingKeysFetchTimeout)
	defer cancel()

	claims, err := v.verifier.Verify(fetchCtx, token)
	if err != nil {
		return "", err
	}
	if claims.Expiry == nil {
		return "", ErrMissingExpiry
	}
	return claims.Subject, nil
}

// SigningKeysUnavailable reports whether a Verify error means the key set could
// not be fetched, rather than the token being unacceptable. Deliberately the
// narrow half of the split: an error it does not recognize counts as a bad
// token, so a new authlib rejection can never be mistaken for an outage.
func SigningKeysUnavailable(err error) bool {
	return errors.Is(err, authn.ErrFetchingSigningKey)
}
