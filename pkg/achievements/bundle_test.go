package achievements

import (
	"fmt"
	"strings"
	"testing"
)

const guidesAction = `"completed":{
  "context":{"guideSource":{"type":"string"},"guideId":{"type":"string"}},
  "resources":[{"unit":"guide","id":["guideSource","guideId"]}]}`

func guidesDefinition(id, extra string) string {
	return `{"id":"` + id + `"` + extra + `,"title":"T","description":"D.",
  "counter":{"unit":"guide","evidence":[{"entity":"guides","action":"completed","countBy":"resource"}]},
  "tiers":[{"id":"bronze","at":1,"art":"` + id + `-1"},{"id":"silver","at":5}]}`
}

func bundleOf(grammar, actions string, definitions ...string) []byte {
	return []byte(`{"grammar":"` + grammar + `","builtFrom":{"repo":"r","commit":"c"},"channel":"stable",
  "registry":{"entities":{"guides":{"owner":"@grafana/pathfinder","actions":{` + actions + `}}}},
  "catalog":{"achievements":[` + strings.Join(definitions, ",") + `]},
  "art":["a-1"]}`)
}

func TestLoadBundleSkipsOnlyWhatItCannotRead(t *testing.T) {
	data := bundleOf("1.3",
		guidesAction+`,
  "started":{"context":{},"sources":[{"interaction":"x"}]},
  "viewed":{"context":{"at":{"type":"date"}}}`,
		guidesDefinition("kept", ""),
		guidesDefinition("too-new", `,"requires":"1.1","window":{"days":7}`),
		guidesDefinition("unknown-field", `,"streak":3`),
		`{"id":"on-skipped-action","title":"T","description":"D.","tiers":[{"id":"bronze","or":[{"entity":"guides","action":"started"}]}]}`,
		guidesDefinition("kept", ""),
		`{"title":"no id"}`,
	)
	s, err := LoadBundle(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Catalog.Achievements) != 1 || s.Catalog.Achievements[0].ID != "kept" {
		t.Fatalf("evaluable = %+v, want only kept", s.Catalog.Achievements)
	}
	if _, ok := s.Registry.action("guides", "completed"); !ok {
		t.Error("guides.completed did not load")
	}

	var got []string
	for _, skip := range s.Skipped {
		got = append(got, fmt.Sprintf("%s %s %s", skip.What, skip.ID, skip.Reason))
		if skip.Detail == "" {
			t.Errorf("skip %+v has no detail", skip)
		}
	}
	want := []string{
		"action guides.started invalid",
		"action guides.viewed invalid",
		"achievement too-new too-new",
		"achievement unknown-field invalid",
		"achievement on-skipped-action invalid",
		"achievement kept invalid",
		"achievement #5 invalid",
	}
	if strings.Join(got, "; ") != strings.Join(want, "; ") {
		t.Errorf("skipped:\n got %v\nwant %v", got, want)
	}

	earnable := map[string]bool{}
	for _, d := range s.Display {
		earnable[d.ID] = d.Earnable
	}
	wantDisplay := map[string]bool{"kept": true, "too-new": false, "unknown-field": false, "on-skipped-action": false}
	if fmt.Sprint(earnable) != fmt.Sprint(wantDisplay) || len(s.Display) != len(wantDisplay) {
		t.Errorf("display earnable = %v, want %v", earnable, wantDisplay)
	}
	if d := s.Display[1]; d.ID != "too-new" || d.Title != "T" || len(d.Tiers) != 2 || d.Tiers[0].Art != "too-new-1" || *d.Tiers[1].At != 5 {
		t.Errorf("too-new display = %+v, want its title and tiers kept", d)
	}
}

func TestLoadBundleRefusesTheWholeBundleOnlyForTheEnvelope(t *testing.T) {
	cases := []struct {
		name string
		data []byte
		want string
	}{
		{"another major", bundleOf("2.0", guidesAction, guidesDefinition("a", "")), "not major 1"},
		{"no grammar", []byte(`{"catalog":{"achievements":[]}}`), `grammar ""`},
		{"malformed grammar", bundleOf("1", guidesAction), `grammar "1"`},
		{"not JSON", []byte(`{"grammar":`), "bundle"},
		{"catalog of the wrong shape", []byte(`{"grammar":"1.0","catalog":{"achievements":{}}}`), "bundle"},
		{"too large", []byte(`{"grammar":"1.0","pad":"` + strings.Repeat("x", MaxBundleBytes) + `"}`), "at most"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := LoadBundle(tc.data); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestLoadBundleCapsDefinitions(t *testing.T) {
	defs := make([]string, maxDefinitions+1)
	for i := range defs {
		defs[i] = guidesDefinition(fmt.Sprintf("d%d", i), "")
	}
	s, err := LoadBundle(bundleOf("1.0", guidesAction, defs...))
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Catalog.Achievements) != maxDefinitions || len(s.Skipped) != 1 || s.Skipped[0].ID != fmt.Sprintf("d%d", maxDefinitions) {
		t.Errorf("%d evaluable, skipped %+v", len(s.Catalog.Achievements), s.Skipped)
	}
}

func TestLoadBundleVersionNamesTheBytes(t *testing.T) {
	a, _ := LoadBundle(bundleOf("1.0", guidesAction, guidesDefinition("a", "")))
	b, _ := LoadBundle(bundleOf("1.0", guidesAction, guidesDefinition("a", "")))
	c, _ := LoadBundle(bundleOf("1.0", guidesAction, guidesDefinition("b", "")))
	if a.Version == "" || a.Version != b.Version || a.Version == c.Version {
		t.Errorf("versions %q %q %q", a.Version, b.Version, c.Version)
	}
}

func TestLoadBundleEvaluatesWhatItLoaded(t *testing.T) {
	s := loadTestBundle(t)
	if s.Grammar != "1.0" || len(s.Art) != 3 || len(s.Display) != 1 || !s.Display[0].Earnable {
		t.Errorf("snapshot = %+v", s)
	}
	if got := s.Catalog.Achievements[0].RequiredGrammar(); got != s.Catalog.Achievements[0].Requires {
		t.Errorf("published requires %q, computed %q", s.Catalog.Achievements[0].Requires, got)
	}
}

func TestLoadBundleSkipsEachBadEntryOnItsOwn(t *testing.T) {
	data := []byte(`{"grammar":"1.0",
  "registry":{"entities":{
    "guides":{"actions":{` + guidesAction + `,"started":null}},
    "Bad Entity":{"actions":{"x":{"context":{}}}},
    "widgets":["not","an","object"]}},
  "catalog":{"achievements":[
    ` + guidesDefinition("malformed", `,"requires":"1"`) + `,
    ` + guidesDefinition("numeric", `,"requires":1.0`) + `,
    ` + guidesDefinition("other-major", `,"requires":"2.0"`) + `,
    ` + guidesDefinition("dup", `,"streak":1`) + `,
    ` + guidesDefinition("dup", "") + `,
    ` + guidesDefinition("kept", `,"requires":"1.0"`) + `]},
  "art":["ok-key",7,"../X Y"]}`)
	s, err := LoadBundle(data)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, skip := range s.Skipped {
		got = append(got, fmt.Sprintf("%s %s %s", skip.What, skip.ID, skip.Reason))
	}
	want := []string{
		"entity Bad Entity invalid",
		"action guides.started invalid",
		"entity widgets invalid",
		"art #1 invalid",
		"art #2 invalid",
		"achievement malformed invalid",
		"achievement numeric invalid",
		"achievement other-major invalid",
		"achievement dup invalid",
		"achievement dup invalid",
	}
	if strings.Join(got, "; ") != strings.Join(want, "; ") {
		t.Errorf("skipped:\n got %v\nwant %v", got, want)
	}
	if len(s.Catalog.Achievements) != 1 || s.Catalog.Achievements[0].ID != "kept" || strings.Join(s.Art, ",") != "ok-key" {
		t.Errorf("evaluable = %+v art = %v", s.Catalog.Achievements, s.Art)
	}
}

func TestLoadBundleCapCountsOnlyEvaluableDefinitions(t *testing.T) {
	defs := make([]string, 0, maxListedSkips+51)
	for range maxListedSkips + 50 {
		defs = append(defs, `{}`)
	}
	defs = append(defs, guidesDefinition("kept", ""))
	s, err := LoadBundle(bundleOf("1.0", guidesAction, defs...))
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Catalog.Achievements) != 1 {
		t.Errorf("%d evaluable, want the one definition after the unreadable entries", len(s.Catalog.Achievements))
	}
	if len(s.Skipped) != maxListedSkips+1 || s.Skipped[maxListedSkips].Detail != "50 more skipped entries not listed" {
		t.Errorf("%d skips listed, last %+v", len(s.Skipped), s.Skipped[len(s.Skipped)-1])
	}
}
