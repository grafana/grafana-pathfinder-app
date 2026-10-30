package achievements

import (
	"strings"
	"testing"
)

const baseCatalog = `{"schemaVersion":1,"achievements":[
  {"id":"dash-builder","revision":1,"title":"Dashboard builder","description":"Create dashboards.",
   "counter":{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"resource"}]},
   "tiers":[{"tier":1,"at":1,"art":"dash-1"},{"tier":2,"at":5,"art":"dash-2"}]}]}`

func TestCheckBaseline(t *testing.T) {
	registry := mustRegistry(t)
	load := func(t *testing.T, json string) *Catalog {
		t.Helper()
		c, err := LoadCatalog([]byte(json), registry)
		if err != nil {
			t.Fatalf("fixture: %v", err)
		}
		return c
	}
	cases := []struct {
		name, current, want string
	}{
		{"unchanged", baseCatalog, ""},
		{"title and description may change", strings.Replace(strings.Replace(baseCatalog, "Dashboard builder", "Builder", 1), "Create dashboards.", "Make dashboards.", 1), ""},
		{"new achievement may be added", strings.TrimSuffix(baseCatalog, `]}`) + `,{"id":"fresh","revision":1,"title":"F","description":"F.","counter":{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"resource"}]},"tiers":[{"tier":1,"at":1}]}]}`, ""},
		{"threshold changed with revision raised", strings.Replace(strings.Replace(baseCatalog, `"at":5`, `"at":6`, 1), `"revision":1`, `"revision":2`, 1), ""},
		{"tier appended with revision raised", strings.Replace(strings.Replace(baseCatalog, `{"tier":2,"at":5,"art":"dash-2"}`, `{"tier":2,"at":5,"art":"dash-2"},{"tier":3,"at":9,"art":"dash-3"}`, 1), `"revision":1`, `"revision":2`, 1), ""},
		{"revision raised alone", strings.Replace(baseCatalog, `"revision":1`, `"revision":2`, 1), ""},

		{"threshold changed without revision", strings.Replace(baseCatalog, `"at":5`, `"at":6`, 1), "without raising revision"},
		{"tier appended without revision", strings.Replace(baseCatalog, `{"tier":2,"at":5,"art":"dash-2"}`, `{"tier":2,"at":5,"art":"dash-2"},{"tier":3,"at":9}`, 1), "without raising revision"},
		{"evidence changed without revision", strings.Replace(baseCatalog, `"countBy":"resource"`, `"countBy":"resource","where":[{"field":"numPanels","op":"gte","value":1}]`, 1), "without raising revision"},
		{"route added without revision", strings.Replace(baseCatalog, `"art":"dash-1"`, `"art":"dash-1","or":[{"entity":"guides","action":"completed"}]`, 1), "without raising revision"},
		{"tier removed", strings.Replace(strings.Replace(baseCatalog, `,{"tier":2,"at":5,"art":"dash-2"}`, ``, 1), `"revision":1`, `"revision":2`, 1), "1 tiers removed"},
		{"tier art swapped", strings.Replace(strings.Replace(strings.Replace(baseCatalog, `"art":"dash-1"`, `"art":"X"`, 1), `"art":"dash-2"`, `"art":"dash-1"`, 1), `"art":"X"`, `"art":"dash-2"`, 1), "inserted, replaced, or reordered"},
		{"unit changed", strings.Replace(strings.Replace(strings.Replace(baseCatalog, `"unit":"dashboard"`, `"unit":"guide"`, 1), `"entity":"dashboards","action":"created"`, `"entity":"guides","action":"completed"`, 1), `"revision":1`, `"revision":2`, 1), "counter unit changed"},
		{"id changed", strings.Replace(baseCatalog, `"id":"dash-builder"`, `"id":"dash-maker"`, 1), "removed or its id changed"},
		{"achievement removed", `{"schemaVersion":1,"achievements":[]}`, "removed or its id changed"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := CheckBaseline(load(t, baseCatalog), load(t, tc.current))
			switch {
			case tc.want == "" && err != nil:
				t.Errorf("unexpected: %v", err)
			case tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)):
				t.Errorf("err = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestCheckBaselineAgainstAnEmptyBaselineAcceptsAnything(t *testing.T) {
	if err := CheckBaseline(&Catalog{SchemaVersion: 1}, mustCatalog(t)); err != nil {
		t.Error(err)
	}
}

func TestCheckBaselineRevisionLowered(t *testing.T) {
	registry := mustRegistry(t)
	released, err := LoadCatalog([]byte(strings.Replace(baseCatalog, `"revision":1`, `"revision":3`, 1)), registry)
	if err != nil {
		t.Fatal(err)
	}
	current, err := LoadCatalog([]byte(baseCatalog), registry)
	if err != nil {
		t.Fatal(err)
	}
	if err := CheckBaseline(released, current); err == nil || !strings.Contains(err.Error(), "revision lowered from 3 to 1") {
		t.Errorf("err = %v", err)
	}
}
