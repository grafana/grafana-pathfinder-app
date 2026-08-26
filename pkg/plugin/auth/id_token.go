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
// consulting a second source cannot double the gate's worst case. A var so tests
// can shrink the budget instead of stalling for whole seconds.
var signingKeysFetchTimeout = 5 * time.Second

// signingKeysMaxRedirects re-imposes the hop cap that net/http's
// defaultCheckRedirect carries, because the CheckRedirect below replaces it.
const signingKeysMaxRedirects = 10

// ErrMissingExpiry rejects an ID token carrying no `exp` claim. go-jose
// validates expiry only when the claim is present, so without this an
// `exp`-less token would verify as non-expiring.
var ErrMissingExpiry = errors.New("id token has no exp claim")

// ErrUnknownNamespace rejects verification the caller cannot bind: with no
// server-derived namespace there is nothing to compare the token's claim
// against, and skipping the comparison would accept a sibling stack's token.
var ErrUnknownNamespace = errors.New("no namespace to bind the id token to")

// NamespaceMismatchError rejects a token minted for a different Grafana
// namespace. auth-api's key set is CELL-WIDE — every Cloud stack in a cell is
// signed by the same keys — so the signature proves issuance by that authority
// but says nothing about which stack the token was issued for. The `namespace`
// claim is what carries that, and Got == "" is a token that carries none.
type NamespaceMismatchError struct {
	// Want is the server-derived namespace, only ever the plugin context's.
	Want string
	// Got is the token's `namespace` claim, empty when it carries none.
	Got string
}

func (e *NamespaceMismatchError) Error() string {
	return fmt.Sprintf("id token namespace %q does not match this stack's %q", e.Got, e.Want)
}

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
			// A redirect off the endpoint's origin would hand key selection to
			// whatever it lands on, which forges any `sub` the proxies then
			// trust. Scheme and host:port, not hostname alone: an http listener
			// on another port, or a TLS one on the same port, is a different
			// origin serving different keys.
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= signingKeysMaxRedirects {
					return fmt.Errorf("signing-keys fetch stopped after %d redirects", signingKeysMaxRedirects)
				}
				from, to := via[0].URL, req.URL
				if !sameOrigin(from, to) {
					return fmt.Errorf("signing-keys redirect left %s://%s: %s://%s",
						from.Scheme, from.Host, to.Scheme, to.Host)
				}
				return nil
			},
		}),
	)
}

// sameOrigin reports whether a redirect target is still the origin the fetch
// started at. Host carries the port, so a listener on another port of the same
// name is a different origin — as is the same port reached over a different
// scheme.
func sameOrigin(from, to *url.URL) bool {
	return to.Scheme == from.Scheme && to.Host == from.Host
}

// keySource is one JWKS endpoint the chain may consult. The name appears in the
// error when it cannot answer, so an operator can tell which source is at fault.
type keySource struct {
	name      string
	retriever authn.KeyRetriever
}

// SigningKeySourceFailure is one source's verdict, named so a log line can say
// which endpoint failed and how.
type SigningKeySourceFailure struct {
	Name  string
	Cause string
}

// SigningKeysError reports that no source in the chain could supply the key a
// token names, and carries the per-source cause. The two ways in are not the
// same operational event and must stay tellable apart: a source answering with
// a key set that lacks the `kid` is the expected Grafana Cloud shape
// (`{"keys":null}`), while no source being reachable at all almost always means
// the configured address is wrong. SigningKeysUnavailable is the classifier.
type SigningKeysError struct {
	Sources  []SigningKeySourceFailure
	sentinel error
}

func (e *SigningKeysError) Error() string {
	return fmt.Sprintf("%s (%s)", e.sentinel, e.SourceDetail())
}

// Unwrap exposes ONLY the chain's own verdict, never the per-source causes:
// letting an unreachable source's ErrFetchingSigningKey reach errors.Is would
// make SigningKeysUnavailable report an outage for a token that a reachable
// source has already ruled out.
func (e *SigningKeysError) Unwrap() error { return e.sentinel }

// SourceDetail renders the per-source causes as "<name>: <cause>" pairs, for a
// log field an operator can read without correlating anything.
func (e *SigningKeysError) SourceDetail() string {
	parts := make([]string, 0, len(e.Sources))
	for _, source := range e.Sources {
		parts = append(parts, source.Name+": "+source.Cause)
	}
	return strings.Join(parts, "; ")
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
// is rejected. Only when NO source answered — every one failed to fetch — is the
// signing-keys address itself in question. The narrow test is deliberately on
// the answered side: a stack publishing `{"keys":null}` while auth-api is
// misconfigured therefore rejects the token rather than reporting the chain
// unreachable.
func (c *chainedKeyRetriever) Get(ctx context.Context, keyID string) (*jose.JSONWebKey, error) {
	var answered bool
	failures := make([]SigningKeySourceFailure, 0, len(c.sources))
	for i, source := range c.sources {
		key, err := c.getFrom(ctx, source, keyID, len(c.sources)-i)
		if err == nil {
			return key, nil
		}
		if errors.Is(err, authn.ErrInvalidSigningKey) {
			answered = true
		}
		failures = append(failures, SigningKeySourceFailure{Name: source.name, Cause: err.Error()})
	}

	sentinel := authn.ErrFetchingSigningKey
	if answered {
		sentinel = authn.ErrInvalidSigningKey
	}
	return nil, &SigningKeysError{Sources: failures, sentinel: sentinel}
}

// getFrom reserves each still-untried source an equal share of the budget left
// on ctx. Without it one stalling source consumes the whole of Verify's
// deadline and every source after it fails on an already-expired context — so a
// self-hosted stack publishing a perfectly good key set would be reported as
// unreachable because it never got to answer.
func (c *chainedKeyRetriever) getFrom(ctx context.Context, source keySource, keyID string, untried int) (*jose.JSONWebKey, error) {
	deadline, ok := ctx.Deadline()
	if !ok || untried <= 1 {
		return source.retriever.Get(ctx, keyID)
	}
	sourceCtx, cancel := context.WithTimeout(ctx, time.Until(deadline)/time.Duration(untried))
	defer cancel()
	return source.retriever.Get(sourceCtx, keyID)
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

// Verify checks the token's signature, type, and expiry, binds it to
// expectedNamespace, and returns its `sub` claim VERBATIM, typed prefix included
// (e.g. "user:abc123"). A verified token may legitimately carry no subject, so
// ("", nil) is a success.
//
// expectedNamespace must be the SERVER-DERIVED namespace (the plugin context's),
// never a request header and never the token's own claim. It is a parameter
// rather than a claim this returns for the caller to check, so the binding
// cannot be forgotten at a new call site.
func (v *IDTokenVerifier) Verify(ctx context.Context, token, expectedNamespace string) (string, error) {
	if expectedNamespace == "" {
		return "", ErrUnknownNamespace
	}

	// Detached from the caller's cancellation, bounded so detached never means
	// unkillable: authlib singleflights the key fetch across concurrent callers,
	// so the leader's canceled request would otherwise fail every waiter with a
	// spurious unreachable-chain verdict. The key fetch is Verify's only I/O.
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), signingKeysFetchTimeout)
	defer cancel()

	claims, err := v.verifier.Verify(fetchCtx, token)
	if err != nil {
		return "", err
	}
	if claims.Expiry == nil {
		return "", ErrMissingExpiry
	}
	if claims.Rest.Namespace != expectedNamespace {
		return "", &NamespaceMismatchError{Want: expectedNamespace, Got: claims.Rest.Namespace}
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
