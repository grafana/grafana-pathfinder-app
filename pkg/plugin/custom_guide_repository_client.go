package plugin

import (
	"context"
	"encoding/json"
	"errors"

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
	// An alias, not a defined type: the wire contract inventory renders this
	// field as an anonymous struct, and naming it would move its entry.
	Author  *customGuideManifestAuthor `json:"author,omitempty"`
	Depends []json.RawMessage          `json:"depends,omitempty"`
	Stats   *customGuideStats          `json:"stats,omitempty"`

	// decodeDrift collects the per-field decode failures. It is unexported, so
	// it never reaches the wire; ListPage turns it into one warning naming the
	// guide id.
	decodeDrift error
}

type customGuideManifestAuthor = struct {
	Name string `json:"name,omitempty"`
	Team string `json:"team,omitempty"`
}

// UnmarshalJSON decodes each fallible composite field on its own, through a
// json.RawMessage, and keeps it only once it has decoded whole. A single shared
// decode would not do: encoding/json fills a slice or nested struct with
// whatever it understood before it failed, so a malformed member would launder
// a broken manifest into valid-looking catalogue data instead of degrading at
// the field that was actually bad.
//
// It reports no error, because encoding/json abandons the REST of the enclosing
// spec once a custom unmarshaler returns one — the guide would lose its title
// and status to a drifted manifest field. What failed is recorded in
// decodeDrift for ListPage to log instead.
func (m *customGuideManifest) UnmarshalJSON(data []byte) error {
	var probe struct {
		Type        string          `json:"type"`
		Repository  string          `json:"repository"`
		Description string          `json:"description"`
		Category    string          `json:"category"`
		Milestones  json.RawMessage `json:"milestones"`
		Author      json.RawMessage `json:"author"`
		Depends     json.RawMessage `json:"depends"`
		Stats       json.RawMessage `json:"stats"`
	}
	var errs []error
	if err := json.Unmarshal(data, &probe); err != nil {
		errs = append(errs, err)
	}

	*m = customGuideManifest{
		Type:        probe.Type,
		Repository:  probe.Repository,
		Description: probe.Description,
		Category:    probe.Category,
	}
	var milestones []string
	if decodeManifestField(probe.Milestones, &milestones, &errs) {
		m.Milestones = milestones
	}
	var author customGuideManifestAuthor
	if decodeManifestField(probe.Author, &author, &errs) {
		m.Author = &author
	}
	var depends []json.RawMessage
	if decodeManifestField(probe.Depends, &depends, &errs) {
		m.Depends = depends
	}
	// A stamp that decodes but carries no usable counts is kept here and dropped
	// by ListPage, which owns the warning that names the guide id.
	var stats customGuideStats
	if decodeManifestField(probe.Stats, &stats, &errs) {
		m.Stats = &stats
	}
	m.decodeDrift = errors.Join(errs...)
	return nil
}

// decodeManifestField decodes one composite manifest field and reports whether
// dst may be kept. A failed decode can leave dst partially populated, so a false
// return means discard it, not "retry".
func decodeManifestField(raw json.RawMessage, dst any, errs *[]error) bool {
	if len(raw) == 0 || string(raw) == "null" {
		return false
	}
	if err := json.Unmarshal(raw, dst); err != nil {
		*errs = append(*errs, err)
		return false
	}
	return true
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

	// complete records whether the stored object supplied all five members. It
	// is unexported, so it never reaches the wire; ListPage drops a stamp that
	// does not carry it.
	complete bool
}

// UnmarshalJSON accepts a stamp only when the stored object supplies every
// member and none of them is negative — the canonical GuideStatsSummarySchema
// invariant. Zero is a legitimate count, so a missing member would otherwise be
// laundered into a plausible denominator, and a negative one is not a
// denominator at all. Either way the stamp reads as ABSENT, the way
// `completion-denominator-authority` requires. It reports no error, so an
// unusable stamp degrades to an absent one instead of aborting the surrounding
// spec the way a returned error would.
func (s *customGuideStats) UnmarshalJSON(data []byte) error {
	var probe struct {
		Version                  *int `json:"version"`
		BlockCount               *int `json:"blockCount"`
		SectionCount             *int `json:"sectionCount"`
		CompletableBlockCount    *int `json:"completableBlockCount"`
		FinalCompletablePosition *int `json:"finalCompletablePosition"`
	}
	if err := json.Unmarshal(data, &probe); err != nil {
		return nil
	}
	members := []*int{probe.Version, probe.BlockCount, probe.SectionCount,
		probe.CompletableBlockCount, probe.FinalCompletablePosition}
	for _, member := range members {
		if member == nil || *member < 0 {
			return nil
		}
	}
	*s = customGuideStats{
		Version:                  *probe.Version,
		BlockCount:               *probe.BlockCount,
		SectionCount:             *probe.SectionCount,
		CompletableBlockCount:    *probe.CompletableBlockCount,
		FinalCompletablePosition: *probe.FinalCompletablePosition,
		complete:                 true,
	}
	return nil
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

func (c *customGuideHTTPClient) finalizeDrain(namespace string) {
	if c.decodeWarns <= customGuideDecodeWarnPerDrain {
		return
	}
	c.inner.logger.Warn("custom guide repository: further decode warnings suppressed",
		"namespace", namespace, "warnings", c.decodeWarns, "logged", customGuideDecodeWarnPerDrain)
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
	warn := func(msg string, args ...any) {
		c.decodeWarns++
		if c.decodeWarns <= customGuideDecodeWarnPerDrain {
			c.inner.logger.Warn(msg, append([]any{"namespace", namespace}, args...)...)
		}
	}
	for _, raw := range page.Specs {
		var entry customGuideRepositoryEntry
		err := json.Unmarshal(raw, &entry)
		if m := entry.Manifest; m != nil {
			if m.Stats != nil && !m.Stats.complete {
				m.Stats = nil
				warn("custom guide repository: incomplete manifest stats dropped", "id", entry.ID)
			}
			if m.decodeDrift != nil {
				warn("custom guide repository: manifest field did not decode", "id", entry.ID, "error", m.decodeDrift)
			}
		}
		if err != nil {
			// A spec this hand-written mirror disagrees with must neither fail
			// the page — that error is not terminal, so the route would answer
			// 503 forever and hide the whole namespace — nor drop the guide.
			// encoding/json keeps decoding past a type mismatch, so every field
			// it did understand is still usable.
			warn("custom guide repository: spec did not fully decode", "id", entry.ID, "error", err)
		}
		if entry.ID == "" {
			// id is required by the CRD schema; skip anything malformed rather
			// than surface an entry with no stable identifier.
			continue
		}
		entries = append(entries, entry)
	}
	return &customGuidePage{Entries: entries, Continue: page.Continue}, nil
}
