package plugin

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/config"
)

// Custom guide repository catalogue proxy (docs/design/BACKEND_PROXY_PATTERN.md).
//
// The Custom Guides sidebar and My Learning surfaces need a slim catalogue of a
// stack's private InteractiveGuide packages. The aggregated LIST returns
// full-fidelity guides (spec.blocks and all), so this proxy drains the
// namespace LIST, strips each guide to a slim entry, and returns the shaped
// catalogue.
//
// DELIBERATE DEVIATION from the pattern's cache-centric §4/§5: this proxy does
// NOT cache across requests, and does NOT single-flight across callers. Every
// request performs its own upstream LIST under the caller's own forwarded
// identity, so per-caller list authorization is always enforced at the source.
//
// Why not the pattern's shared-blob cache: a namespace-global catalogue is a
// shared blob, and a shared cache is only sound if the upstream LIST is
// identity-invariant — i.e. every caller who can reach this route can also list
// interactiveguides. That invariant is unproven (it depends on the stack's
// interactiveguides RBAC, and would silently break if a future role change let
// a token-bearing caller reach the plugin without list permission). A warm
// shared entry — or a shared in-flight LIST — would then serve one user's
// catalogue to an unauthorized caller for the cache window. Rather than rely on
// an unverifiable invariant for cross-user data, we skip cross-request/cross-
// caller sharing entirely. The pattern's §3 forbids the alternative safe cache
// (per-user partitioning needs `sub`, which a namespace-global route must not
// extract), so "no shared cache" is the conservative in-pattern choice here.
// This data is low-traffic (a small enablement catalogue read on panel load),
// so a LIST per request is an acceptable cost. If load ever justifies caching,
// the safe reintroduction is a per-identity-partitioned cache — a deliberate
// future change. With no warm data to serve, the pattern's stale-serve and
// negative-cache-cooldown clauses (§5) do not apply.

const (
	// customGuideRetryAfterSeconds is the Retry-After hint on a transient 503.
	customGuideRetryAfterSeconds = 30

	// customGuideAggregateDeadline bounds a whole multi-page drain. The drain is
	// detached from the request (context.WithoutCancel) so a canceled request
	// (panel closed mid-flight) doesn't abort a fetch partway and log spurious
	// errors; the deadline ensures detached never means unkillable.
	customGuideAggregateDeadline = 60 * time.Second
)

// customGuideListMaxTotalEntries is the aggregate budget across all LIST pages
// of one drain (the per-page byte cap alone does not bound total memory). When
// the budget trips, the drain caps the result and logs the truncation — never
// silently. A var so tests can exercise the budget path.
var customGuideListMaxTotalEntries = 50_000

// customGuideCapability is the availability signal the front-end gates the
// Custom Guides / My Learning surfaces on. `available` is read-derived: it
// measures identity presence plus read-path reachability of the
// interactiveguides API on this stack. Reasons use the shared machine tokens
// reasonIdentityUnavailable / reasonBackendUnavailable (completion_records.go).
type customGuideCapability struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

// customGuideRepositoryResponse is the GET /custom-guide-repository envelope
// (BACKEND_PROXY_PATTERN.md §6): a capability object, the always-non-null data
// array, and asOf — when this request's underlying LIST completed.
type customGuideRepositoryResponse struct {
	Capability customGuideCapability        `json:"capability"`
	Guides     []customGuideRepositoryEntry `json:"guides"`
	AsOf       string                       `json:"asOf,omitempty"`
}

// customGuideListerOverride injects a fake lister in tests. nil selects the
// real per-request HTTP client. Config resolution (feature toggle, app URL,
// namespace) is checked BEFORE this override so the structural-unavailability
// path stays testable. This is the only package-level state in the proxy —
// there is no cross-request cache (see the deviation note above).
var customGuideListerOverride customGuideLister

// handleCustomGuideRepository serves GET /custom-guide-repository.
func (a *App) handleCustomGuideRepository(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Identity gate first. This is a namespace-global catalogue, so we only
	// STRUCTURALLY validate the ID token (validIDToken); there is no per-user
	// need, so we deliberately do not extract `sub`. Missing/invalid identity on
	// a GET read is a soft-200 capability envelope (not 401): these routes gate
	// whether a feature renders at all, and a bare error status conflates "never
	// works here" with a transient blip (BACKEND_PROXY_PATTERN.md §3, §7).
	if !validIDToken(r) {
		a.writeJSON(w, customGuideRepositoryResponse{
			Capability: customGuideCapability{Available: false, Reason: reasonIdentityUnavailable},
			Guides:     []customGuideRepositoryEntry{},
		}, http.StatusOK)
		return
	}

	lister, namespace, available, reason := a.resolveCustomGuideBackend(r)
	if !available {
		a.writeJSON(w, customGuideRepositoryResponse{
			Capability: customGuideCapability{Available: false, Reason: reason},
			Guides:     []customGuideRepositoryEntry{},
		}, http.StatusOK)
		return
	}

	// Detach the drain from the caller's cancellation, bounded by the aggregate
	// deadline. Per-request (no cross-caller sharing): this fetch rides this
	// caller's identity and is never handed to another caller.
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), customGuideAggregateDeadline)
	entries, pages, err := drainCustomGuides(fetchCtx, namespace, lister)
	cancel()

	logger := a.ctxLogger(r.Context())
	if err != nil {
		if isTerminalUpstreamError(err) {
			// Structurally can't serve for this caller ("never works here") —
			// includes identity-scoped 401/403 for this caller's token.
			logger.Info("custom guide catalogue unavailable (terminal)", "namespace", namespace, "error", err)
			a.writeJSON(w, customGuideRepositoryResponse{
				Capability: customGuideCapability{Available: false, Reason: reasonBackendUnavailable},
				Guides:     []customGuideRepositoryEntry{},
			}, http.StatusOK)
			return
		}
		// Transient: a retry might fix it, so signal a hiccup rather than
		// darkening the feature.
		logger.Debug("custom guide catalogue unavailable (transient)", "namespace", namespace, "error", err)
		w.Header().Set("Retry-After", strconv.Itoa(customGuideRetryAfterSeconds))
		a.writeError(w, "custom-guide-repository-unavailable", http.StatusServiceUnavailable)
		return
	}

	logger.Debug("custom guide catalogue served", "namespace", namespace, "pages", pages, "guides", len(entries))
	a.writeJSON(w, customGuideRepositoryResponse{
		Capability: customGuideCapability{Available: true},
		Guides:     entries,
		AsOf:       timeNow().UTC().Format(time.RFC3339),
	}, http.StatusOK)
}

// drainCustomGuides drains the namespace LIST across pages — up to the
// aggregate entry budget — and returns the shaped catalogue entries.
func drainCustomGuides(ctx context.Context, namespace string, lister customGuideLister) ([]customGuideRepositoryEntry, int, error) {
	entries := []customGuideRepositoryEntry{}
	continueToken := ""
	pages := 0
	for {
		page, err := lister.ListPage(ctx, namespace, continueToken)
		if err != nil {
			return nil, pages, err
		}
		pages++
		entries = append(entries, page.Entries...)
		if len(entries) >= customGuideListMaxTotalEntries {
			// Strict budget: cap the accumulated slice so the memory bound holds
			// exactly (a page can push us past the limit), and log whenever the
			// cap actually drops data — either we trimmed an overshoot or more
			// pages remained undrained.
			truncated := len(entries) > customGuideListMaxTotalEntries || page.Continue != ""
			if len(entries) > customGuideListMaxTotalEntries {
				entries = entries[:customGuideListMaxTotalEntries]
			}
			if truncated {
				log.DefaultLogger.Warn("custom guide catalogue LIST truncated at aggregate budget",
					"namespace", namespace, "maxTotalEntries", customGuideListMaxTotalEntries, "pages", pages)
			}
			break
		}
		if page.Continue == "" {
			break
		}
		continueToken = page.Continue
	}
	return entries, pages, nil
}

// resolveCustomGuideBackend determines whether the aggregated CRUD API is
// structurally reachable for this request and returns a lister to use.
// "Structurally unavailable" (feature toggle off, no app URL, no namespace) is
// a "never works here" condition surfaced as capability=false, distinct from a
// transient LIST failure. The namespace comes from the trusted plugin context,
// never from a query parameter. Config resolution runs before the test-only
// lister override so the structural-unavailability branch stays testable.
func (a *App) resolveCustomGuideBackend(r *http.Request) (lister customGuideLister, namespace string, available bool, reason string) {
	namespace = backend.PluginConfigFromContext(r.Context()).Namespace

	cfg := config.GrafanaConfigFromContext(r.Context())
	if cfg == nil {
		return nil, namespace, false, reasonBackendUnavailable
	}
	if !cfg.FeatureToggles().IsEnabled(pathfinderBackendAggregationToggle) {
		return nil, namespace, false, reasonBackendUnavailable
	}
	appURL, err := cfg.AppURL()
	if err != nil || appURL == "" || namespace == "" {
		return nil, namespace, false, reasonBackendUnavailable
	}

	if customGuideListerOverride != nil {
		return customGuideListerOverride, namespace, true, ""
	}

	idToken := r.Header.Get(backend.GrafanaUserSignInTokenHeaderName)
	return newCustomGuideHTTPClient(appURL, idToken, a.ctxLogger(r.Context())), namespace, true, ""
}
