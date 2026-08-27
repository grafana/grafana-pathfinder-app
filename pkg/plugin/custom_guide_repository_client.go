package plugin

import (
	"context"
	"encoding/json"

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

	// customGuideListPageSize bounds each upstream LIST page. The proxy drains
	// all pages, so this only trades round-trips against per-response size.
	customGuideListPageSize = 500

	// customGuideListMaxBytes bounds an individual page body so a pathological
	// namespace can't exhaust plugin memory. The aggregate budget across pages
	// is customGuideListMaxTotalEntries (custom_guide_repository.go). Each page
	// carries full InteractiveGuide specs (blocks included) off the wire — they
	// are stripped in-process during shaping — so the per-page cap is generous.
	customGuideListMaxBytes = 8 * 1024 * 1024

	// customGuideDecodeWarnPerPage bounds the per-spec decode warnings one page
	// may emit. A schema drift affects every stored guide at once, and the
	// aggregate drain budget is customGuideListMaxTotalEntries, so an uncapped
	// warning is a log flood rather than a diagnostic; the remainder is
	// summarised in a single line.
	customGuideDecodeWarnPerPage = 10
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

// customGuideManifest mirrors #Manifest in pathfinder-backend's
// kinds/interactiveguide.cue. Decoded loosely (a plain struct, not the
// generated client type) since this repo doesn't vendor pathfinder-backend's
// generated Go types.
type customGuideManifest struct {
	Type        string   `json:"type"`
	Repository  string   `json:"repository,omitempty"`
	Description string   `json:"description,omitempty"`
	Milestones  []string `json:"milestones,omitempty"`
	Category    string   `json:"category,omitempty"`
	Author      *struct {
		Name string `json:"name,omitempty"`
		Team string `json:"team,omitempty"`
	} `json:"author,omitempty"`
	Depends []json.RawMessage `json:"depends,omitempty"`
	Stats   *customGuideStats `json:"stats,omitempty"`
}

// customGuideStats mirrors the stamped `manifest.stats` object — the same five
// members as GuideStatsSummarySchema in src/types/guide-stats.schema.ts. These
// counts are the denominator for completion percentages, so they must survive
// decoding; a manifest with no stats leaves this nil.
type customGuideStats struct {
	// Version is the version of the COUNTING RULES that produced the counts
	// below. It says nothing about whether the guide's content changed.
	Version                  int `json:"version"`
	BlockCount               int `json:"blockCount"`
	SectionCount             int `json:"sectionCount"`
	CompletableBlockCount    int `json:"completableBlockCount"`
	FinalCompletablePosition int `json:"finalCompletablePosition"`
}

// customGuideRepositoryEntry is the slim, block-stripped view of an
// InteractiveGuide — the App Platform analogue of a repository.json entry (see
// PackageEntry in package_recommendations.go). This is the shaped/collated
// unit the cache stores; the heavy spec.blocks never survives shaping, so
// steady-state memory is bounded by guide count, not guide size.
type customGuideRepositoryEntry struct {
	ID       string               `json:"id"`
	Title    string               `json:"title,omitempty"`
	Status   string               `json:"status,omitempty"`
	Manifest *customGuideManifest `json:"manifest,omitempty"`
}

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

// customGuideHTTPClient is the per-kind wrapper over the shared App Platform
// LIST client: it supplies the interactiveguides coordinates and shapes each
// `items[].spec` into a slim, block-stripped customGuideRepositoryEntry.
type customGuideHTTPClient struct {
	inner *appPlatformListClient
}

// newCustomGuideHTTPClient builds a lister that calls appURL as the user the
// caller's ID token identifies, using an access token minted from that token. A
// namespace-scoped LIST returns every InteractiveGuide in the namespace
// (Kubernetes RBAC is namespace-, not object-, scoped), which is what lets one
// refresh serve every caller (see the identity-invariance note in
// custom_guide_repository.go). A caller lacking list permission gets a 401/403,
// surfaced as an identity-scoped terminal error.
func newCustomGuideHTTPClient(appURL string, minter accessTokenMinter, idToken string, logger log.Logger) *customGuideHTTPClient {
	return &customGuideHTTPClient{inner: newAppPlatformListClient(appURL, minter, idToken, logger)}
}

// ListPage fetches one page of InteractiveGuides for the namespace and shapes
// each spec into a slim entry, dropping spec.blocks.
func (c *customGuideHTTPClient) ListPage(ctx context.Context, namespace, continueToken string) (*customGuidePage, error) {
	page, err := c.inner.listPage(ctx, customGuideGroupVersion, namespace,
		customGuideResource, continueToken, customGuideListPageSize, customGuideListMaxBytes)
	if err != nil {
		return nil, err
	}

	// Decode each spec directly into the slim entry: spec.blocks has no field
	// here, so encoding/json drops it — that omission IS the block-stripping.
	entries := make([]customGuideRepositoryEntry, 0, len(page.Specs))
	degraded := 0
	for _, raw := range page.Specs {
		var entry customGuideRepositoryEntry
		if err := json.Unmarshal(raw, &entry); err != nil {
			// A spec this hand-written mirror disagrees with must neither fail
			// the page — that error is not terminal, so the route would answer
			// 503 forever and hide the whole namespace — nor drop the guide.
			// encoding/json keeps decoding past a type mismatch, so the rest of
			// the entry is intact; only the stats stamp is now untrustworthy,
			// and half of one would serve zeroes as a completion denominator.
			if entry.Manifest != nil {
				entry.Manifest.Stats = nil
			}
			degraded++
			if degraded <= customGuideDecodeWarnPerPage {
				c.inner.logger.Warn("custom guide repository: spec did not fully decode, manifest stats dropped",
					"namespace", namespace, "id", entry.ID, "error", err)
			}
		}
		if entry.ID == "" {
			// id is required by the CRD schema; skip anything malformed rather
			// than surface an entry with no stable identifier.
			continue
		}
		entries = append(entries, entry)
	}
	if degraded > customGuideDecodeWarnPerPage {
		c.inner.logger.Warn("custom guide repository: further specs did not fully decode",
			"namespace", namespace, "degraded", degraded, "logged", customGuideDecodeWarnPerPage)
	}
	return &customGuidePage{Entries: entries, Continue: page.Continue}, nil
}
