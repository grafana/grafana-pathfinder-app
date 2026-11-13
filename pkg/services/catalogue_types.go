package services

import (
	"encoding/json"
	"errors"
)

// CatalogueManifest mirrors #Manifest in pathfinder-backend's
// kinds/interactiveguide.cue. Decoded loosely (a plain struct, not the
// generated client type) since this repo doesn't vendor pathfinder-backend's
// generated Go types.
type CatalogueManifest struct {
	Type        string   `json:"type"`
	Repository  string   `json:"repository,omitempty"`
	Description string   `json:"description,omitempty"`
	Milestones  []string `json:"milestones,omitempty"`
	// Tracks mirrors #Track in pathfinder-backend's #Manifest (Path Tracks
	// RFC): named, independently-ordered guide sequences alongside the
	// always-present Milestones default. Additive — Milestones is unaffected.
	Tracks   []CatalogueTrack `json:"tracks,omitempty"`
	Category string           `json:"category,omitempty"`
	// An alias, not a defined type: the wire contract inventory renders this
	// field as an anonymous struct, and naming it would move its entry.
	Author  *CatalogueAuthor  `json:"author,omitempty"`
	Depends []json.RawMessage `json:"depends,omitempty"`
	Stats   *CatalogueStats   `json:"stats,omitempty"`

	// decodeDrift collects the per-field decode failures. It is unexported, so
	// it never reaches the wire; ListPage turns it into one warning naming the
	// guide id.
	DecodeDrift error `json:"-"`
}

type CatalogueAuthor = struct {
	Name string `json:"name,omitempty"`
	Team string `json:"team,omitempty"`
}

// CatalogueTrack mirrors #Track: { trackId, label, guides } — all
// three required by the CUE definition, so no omitempty here. An alias, not a
// defined type, for the same reason as CatalogueAuthor: the wire
// contract inventory renders this field as an anonymous struct.
type CatalogueTrack = struct {
	TrackID string   `json:"trackId"`
	Label   string   `json:"label"`
	Guides  []string `json:"guides"`
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
func (m *CatalogueManifest) UnmarshalJSON(data []byte) error {
	var probe struct {
		Type        string          `json:"type"`
		Repository  string          `json:"repository"`
		Description string          `json:"description"`
		Category    string          `json:"category"`
		Milestones  json.RawMessage `json:"milestones"`
		Tracks      json.RawMessage `json:"tracks"`
		Author      json.RawMessage `json:"author"`
		Depends     json.RawMessage `json:"depends"`
		Stats       json.RawMessage `json:"stats"`
	}
	var errs []error
	if err := json.Unmarshal(data, &probe); err != nil {
		errs = append(errs, err)
	}

	*m = CatalogueManifest{
		Type:        probe.Type,
		Repository:  probe.Repository,
		Description: probe.Description,
		Category:    probe.Category,
	}
	var milestones []string
	if decodeManifestField(probe.Milestones, &milestones, &errs) {
		m.Milestones = milestones
	}
	var tracks []CatalogueTrack
	if decodeManifestField(probe.Tracks, &tracks, &errs) {
		m.Tracks = tracks
	}
	var author CatalogueAuthor
	if decodeManifestField(probe.Author, &author, &errs) {
		m.Author = &author
	}
	var depends []json.RawMessage
	if decodeManifestField(probe.Depends, &depends, &errs) {
		m.Depends = depends
	}
	// A stamp that decodes but carries no usable counts is kept here and dropped
	// by ListPage, which owns the warning that names the guide id.
	var stats CatalogueStats
	if decodeManifestField(probe.Stats, &stats, &errs) {
		m.Stats = &stats
	}
	m.DecodeDrift = errors.Join(errs...)
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

// CatalogueStats mirrors the stamped `manifest.stats` object — the same five
// members as GuideStatsSummarySchema in src/types/guide-stats.schema.ts. These
// counts are the denominator for completion percentages, so they must survive
// decoding; a manifest with no stats leaves this nil.
type CatalogueStats struct {
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
	Complete bool `json:"-"`
}

// UnmarshalJSON accepts a stamp only when the stored object supplies every
// member and none of them is negative — the canonical GuideStatsSummarySchema
// invariant. Zero is a legitimate count, so a missing member would otherwise be
// laundered into a plausible denominator, and a negative one is not a
// denominator at all. Either way the stamp reads as ABSENT, the way
// `guide-stats-stamp-contract` requires. It reports no error, so an
// unusable stamp degrades to an absent one instead of aborting the surrounding
// spec the way a returned error would.
func (s *CatalogueStats) UnmarshalJSON(data []byte) error {
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
	*s = CatalogueStats{
		Version:                  *probe.Version,
		BlockCount:               *probe.BlockCount,
		SectionCount:             *probe.SectionCount,
		CompletableBlockCount:    *probe.CompletableBlockCount,
		FinalCompletablePosition: *probe.FinalCompletablePosition,
		Complete:                 true,
	}
	return nil
}

// CatalogueEntry is the slim, block-stripped view of an
// InteractiveGuide — the App Platform analogue of a repository.json entry (see
// PackageEntry in package_recommendations.go). This is the shaped/collated
// unit the cache stores; the heavy spec.blocks never survives shaping, so
// steady-state memory is bounded by guide count, not guide size.
type CatalogueEntry struct {
	ID       string             `json:"id"`
	Title    string             `json:"title,omitempty"`
	Status   string             `json:"status,omitempty"`
	Manifest *CatalogueManifest `json:"manifest,omitempty"`
}

func DecodeCatalogueEntry(spec json.RawMessage, warn func(string, ...any)) (CatalogueEntry, bool) {

	var entry CatalogueEntry
	err := json.Unmarshal(spec, &entry)
	if m := entry.Manifest; m != nil {
		if m.Stats != nil && !m.Stats.Complete {
			m.Stats = nil
			warn("custom guide repository: incomplete manifest stats dropped", "id", entry.ID)
		}
		if m.DecodeDrift != nil {
			warn("custom guide repository: manifest field did not decode", "id", entry.ID, "error", m.DecodeDrift)
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
		return CatalogueEntry{}, false
	}
	return entry, true
}
