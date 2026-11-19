package plugin

import (
	"context"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// customGuideGroupVersion is the App Platform API group/version that serves the
// InteractiveGuide kind; the plural resource is "interactiveguides". Tracks
// grafana-pathfinder-backend kinds/interactiveguide.cue (groupOverride
// pathfinderbackend.ext.grafana.app) — the Grafana App Platform (GAP) group.
const (
	// Derived from appPlatformGroup (app_platform_client.go) so it cannot drift
	// from the group name.
	customGuideGroupVersion = appPlatformGroup + "/v1alpha1"
	customGuideResource     = "interactiveguides"

	// customGuideListPageSize is the first LIST page size of a drain. The proxy
	// drains all pages, so this only trades round-trips against per-response
	// size, and ListPage halves it whenever a page overflows customGuideListMaxBytes.
	customGuideListPageSize = 500

	// customGuideListMaxBytes bounds an individual page body so a pathological
	// namespace can't exhaust plugin memory. The aggregate budget across pages
	// is customGuideListMaxTotalEntries (custom_guide_repository.go). Each page
	// carries full InteractiveGuide specs (blocks included) off the wire — they
	// are stripped in-process during shaping — so the per-page cap is generous.
	customGuideListMaxBytes = 8 * 1024 * 1024

	// customGuideDecodeWarnPerDrain bounds the per-spec decode warnings one
	// catalogue drain may emit. A schema drift affects every stored guide at
	// once, and the aggregate drain budget is customGuideListMaxTotalEntries, so
	// an uncapped warning is a log flood rather than a diagnostic; the remainder
	// is summarised in a single line when the drain finishes.
	customGuideDecodeWarnPerDrain = 10
)

// customGuideAggregationToggle is the boot-time toggle the aggregation layer sets
// when the pathfinderbackend GAP API (group above) is served on this instance;
// mirrors the front-end check in src/utils/interactive-guides-api.ts. Equal to
// completionRecordsAggregationToggle, since both surfaces are now served on the
// .app group. It is a PRECONDITION, not the availability answer — a real stack
// reports both the .app and the legacy .com toggle true, so route availability
// comes from the capability/resolver path, which additionally requires an app
// URL, a namespace, and a provisioned on-behalf-of credential. Derived from
// appPlatformGroup so it cannot drift from the group name.
var customGuideAggregationToggle = aggregationToggle(appPlatformGroup)

type customGuideRepositoryEntry = services.CatalogueEntry
type customGuideManifestTrack = services.CatalogueTrack
type customGuideManifest = services.CatalogueManifest
type customGuideStats = services.CatalogueStats

// customGuidePage is one page of a namespace LIST: the shaped entries plus the
// Kubernetes continue token (empty when the listing is drained).
type customGuidePage struct {
	Entries  []customGuideRepositoryEntry
	Continue string
}

// customGuideLister abstracts a single upstream LIST page so the cache can
// drain pagination while tests inject a fake without an HTTP server. The
// production implementation is customGuideHTTPClient.
type customGuideLister interface {
	ListPage(ctx context.Context, namespace, continueToken string) (*customGuidePage, error)
}

type customGuideDrainFinalizer interface {
	finalizeDrain(namespace string)
}

// customGuideHTTPClient is the per-kind wrapper over the shared App Platform
// LIST client: it supplies the interactiveguides coordinates and shapes each
// `items[].spec` into a slim, block-stripped customGuideRepositoryEntry.
type customGuideHTTPClient struct {
	inner *appPlatformListClient

	// decodeWarns counts spec-decode warnings across every page of the one drain
	// this client serves, so the budget bounds the whole catalogue rather than
	// resetting per page.
	decodeWarns int

	// pageSize is the LIST limit for the rest of this drain: it starts at
	// customGuideListPageSize and only ever halves (see ListPage).
	pageSize int
}

// newCustomGuideHTTPClient builds a lister that calls appURL as the user the
// caller's ID token identifies, using an access token minted from that token. A
// namespace-scoped LIST returns every InteractiveGuide in the namespace
// (Kubernetes RBAC is namespace-, not object-, scoped), which is what lets one
// refresh serve every caller (see the identity-invariance note in
// custom_guide_repository.go). A caller lacking list permission gets a 401/403,
// surfaced as an identity-scoped terminal error.
func newCustomGuideHTTPClient(appURL string, minter accessTokenMinter, idToken string, logger log.Logger) *customGuideHTTPClient {
	inner := newAppPlatformListClient(appURL, minter, idToken, logger)
	inner.shrinksOnOverflow = true
	return &customGuideHTTPClient{inner: inner, pageSize: customGuideListPageSize}
}

func (c *customGuideHTTPClient) finalizeDrain(namespace string) {
	if c.decodeWarns <= customGuideDecodeWarnPerDrain {
		return
	}
	c.inner.logger.Warn("custom guide repository: further decode warnings suppressed",
		"namespace", namespace, "warnings", c.decodeWarns, "logged", customGuideDecodeWarnPerDrain)
}

// ListPage fetches one page of InteractiveGuides for the namespace and shapes
// each spec into a slim entry, dropping spec.blocks.
//
// Pages carry full specs, so a fixed page size would let a namespace of large
// guides overflow customGuideListMaxBytes on every attempt and lose the whole
// catalogue. Instead an overflowing page is re-read from the same continue
// token at half the size, down to one guide, and the smaller size holds for the
// rest of the drain. Only a single guide over the cap still fails, and
// /custom-guide?name= could not read that guide either.
func (c *customGuideHTTPClient) ListPage(ctx context.Context, namespace, continueToken string) (*customGuidePage, error) {
	var page *appPlatformListPage
	var err error
	for {
		page, err = c.inner.listPage(ctx, customGuideGroupVersion, namespace,
			customGuideResource, continueToken, c.pageSize, customGuideListMaxBytes)
		if err == nil || c.pageSize <= 1 || !isResponseTooLarge(err) {
			break
		}
		c.inner.logger.Info("custom guide repository: page overflowed the byte cap, shrinking",
			"namespace", namespace, "pageSize", c.pageSize, "maxBytes", customGuideListMaxBytes)
		c.pageSize = max(c.pageSize/2, 1)
	}
	if err != nil {
		return nil, err
	}

	// Decode each spec directly into the slim entry: spec.blocks has no field
	// here, so encoding/json drops it — that omission IS the block-stripping.
	entries := make([]customGuideRepositoryEntry, 0, len(page.Items))
	warn := func(msg string, args ...any) {
		c.decodeWarns++
		if c.decodeWarns <= customGuideDecodeWarnPerDrain {
			c.inner.logger.Warn(msg, append([]any{"namespace", namespace}, args...)...)
		}
	}
	for _, item := range page.Items {
		if entry, ok := services.DecodeCatalogueEntry(item.Spec, item.Metadata.Name, item.Metadata.CreationTimestamp, warn); ok {
			entries = append(entries, entry)
		}
	}
	return &customGuidePage{Entries: entries, Continue: page.Metadata.Continue}, nil
}
