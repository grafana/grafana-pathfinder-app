package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/grafana/authlib/authn"
)

// DefaultSigningKeysURL is auth-api's JWKS endpoint. auth-api is the authority
// that signs Grafana ID tokens on Grafana Cloud, where the stack itself signs
// nothing and publishes an empty key set. deployment_tools provisions this same
// URL into other services as AUTH_JWKS_URL for exactly this purpose
// (ksonnet/lib/mobile-app/mobile-api.libsonnet).
const DefaultSigningKeysURL = authAPIBaseURL + "/v1/keys"

// SigningKeysPath is where a Grafana instance publishes the public JWKS it
// signs ID tokens with. Self-hosted Grafana is its own issuer and populates it;
// Grafana Cloud stacks serve `{"keys":null}` here because auth-api holds the
// signing key instead.
const SigningKeysPath = "/api/signing-keys/keys"

// signingKeysFetchTimeout bounds JWKS fetching. authlib's key retriever defaults
// to http.DefaultClient, which has no timeout, and the fetch runs inline in the
// identity gate of every proxy route. Verify applies it to the whole chain, so
// consulting a second source cannot double the gate's worst case.
const signingKeysFetchTimeout = 5 * time.Second

// ErrMissingExpiry rejects an ID token carrying no `exp` claim. go-jose
// validates expiry only when the claim is present, so without this an
// `exp`-less token would verify as non-expiring.
var ErrMissingExpiry = errors.New("id token has no exp claim")

// IDTokenVerifier cryptographically verifies inbound Grafana ID tokens
// (X-Grafana-Id) against the published signing keys of whichever authority
// issued them.
//
// Safe for concurrent use. Authlib caches fetched keys for the lifetime of this
// verifier, so callers must reuse it across requests but replace it on a bounded
// schedule to preserve key-removal revocation.
type IDTokenVerifier struct {
	verifier *authn.IDTokenVerifier
}

// NewIDTokenVerifier builds a verifier over up to two JWKS endpoints, tried in
// order: authAPIKeysURL (Grafana Cloud's token issuer) then stackAppURL's own
// signing-keys endpoint (self-hosted Grafana, which issues its own tokens).
// Both are full ES256 verification; neither is a weaker check. Either may be
// empty, but not both. Audience is deliberately not validated (see the trust
// boundary in docs/design/BACKEND_PROXY_PATTERN.md §3).
func NewIDTokenVerifier(authAPIKeysURL, stackAppURL string) (*IDTokenVerifier, error) {
	var sources []keySource
	if authAPIKeysURL != "" {
		sources = append(sources, keySource{name: "auth-api", retriever: newKeyRetriever(authAPIKeysURL)})
	}
	if stackAppURL != "" {
		keysURL, err := signingKeysURL(stackAppURL)
		if err != nil {
			return nil, err
		}
		sources = append(sources, keySource{name: "stack", retriever: newKeyRetriever(keysURL)})
	}
	if len(sources) == 0 {
		return nil, errors.New("no signing-keys source: neither an auth-api JWKS URL nor a stack app URL")
	}

	keys := &chainedKeyRetriever{sources: sources}
	return &IDTokenVerifier{verifier: authn.NewIDTokenVerifier(authn.VerifierConfig{}, keys)}, nil
}

func newKeyRetriever(keysURL string) authn.KeyRetriever {
	return authn.NewKeyRetriever(
		authn.KeyRetrieverConfig{SigningKeysURL: keysURL},
		authn.WithHTTPClientKeyRetrieverOpt(&http.Client{
			Timeout: signingKeysFetchTimeout,
			// A redirect off the endpoint's host would hand key selection to
			// whatever origin it lands on, which forges any `sub` the proxies
			// then trust.
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if req.URL.Hostname() != via[0].URL.Hostname() {
					return fmt.Errorf("signing-keys redirect left %s: %s", via[0].URL.Hostname(), req.URL.Hostname())
				}
				return nil
			},
		}),
	)
}

// keySource is one JWKS endpoint the chain may consult. The name appears in the
// error when it cannot answer, so an operator can tell which source is at fault.
type keySource struct {
	name      string
	retriever authn.KeyRetriever
}

// chainedKeyRetriever resolves a `kid` against each source in order and returns
// the first key that matches. Both sources verify signatures for real; the chain
// exists because Grafana Cloud and self-hosted Grafana have different token
// issuers, not because one is a relaxed check.
type chainedKeyRetriever struct {
	sources []keySource
}

// Get classifies exhaustion of the chain into the two verdicts the identity gate
// splits on. A source that served a key set without the `kid` (authlib's
// ErrInvalidSigningKey) has answered: the key is genuinely unknown, so the token
// is rejected. Only when NO source answered — every one failed to fetch — is
// this an outage, which the gate serves as a retryable 503. The narrow test is
// deliberately on the answered side: a stack publishing `{"keys":null}` while
// auth-api is misconfigured therefore rejects the token rather than declaring an
// outage on every proxy route.
func (c *chainedKeyRetriever) Get(ctx context.Context, keyID string) (*jose.JSONWebKey, error) {
	var answered bool
	details := make([]string, 0, len(c.sources))
	for _, source := range c.sources {
		key, err := source.retriever.Get(ctx, keyID)
		if err == nil {
			return key, nil
		}
		if errors.Is(err, authn.ErrInvalidSigningKey) {
			answered = true
		}
		details = append(details, source.name+": "+err.Error())
	}

	// The causes are folded into the message rather than wrapped: an unreachable
	// source's ErrFetchingSigningKey must not reach errors.Is when a reachable
	// one has already ruled the key out, or SigningKeysUnavailable would report
	// an outage for a token no key set knows.
	if answered {
		return nil, fmt.Errorf("%w (%s)", authn.ErrInvalidSigningKey, strings.Join(details, "; "))
	}
	return nil, fmt.Errorf("%w (%s)", authn.ErrFetchingSigningKey, strings.Join(details, "; "))
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

// SigningKeysUnavailable reports whether a Verify error means no key set could
// be fetched at all, rather than the token being unacceptable. Deliberately the
// narrow half of the split: an error it does not recognize counts as a bad
// token, so a new authlib rejection can never be mistaken for an outage.
func SigningKeysUnavailable(err error) bool {
	return errors.Is(err, authn.ErrFetchingSigningKey)
}
