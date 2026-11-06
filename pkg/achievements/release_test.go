package achievements

import (
	"errors"
	"os/exec"
	"strings"
	"testing"
)

const releasedCatalog = `{"schemaVersion":1,"achievements":[
  {"id":"dash-builder","title":"Dashboard builder","description":"Create dashboards.",
   "counter":{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"resource"}]},
   "tiers":[{"id":"bronze","at":1,"art":"dash-1"},{"id":"silver","at":5,"art":"dash-2"},{"id":"gold","at":9}]}]}`

func TestCheckReleaseCatalog(t *testing.T) {
	registry := mustRegistry(t)
	load := func(t *testing.T, json string) *Catalog {
		t.Helper()
		c, err := LoadCatalog([]byte(json), registry)
		if err != nil {
			t.Fatalf("fixture: %v", err)
		}
		return c
	}
	replace := func(old, new string) string { return strings.Replace(releasedCatalog, old, new, 1) }
	cases := []struct{ name, current, want string }{
		{"unchanged", releasedCatalog, ""},
		{"words and art may change", replace(`"art":"dash-1"`, `"art":"dash-new"`), ""},
		{"thresholds may move", replace(`"at":5`, `"at":6`), ""},
		{"a tier may be inserted in the middle", replace(`{"id":"gold","at":9}`, `{"id":"gilt","at":7},{"id":"gold","at":9}`), ""},
		{"a tier may be inserted below the bottom", replace(`{"id":"bronze","at":1,"art":"dash-1"}`, `{"id":"starter","at":1},{"id":"bronze","at":2,"art":"dash-1"}`), ""},
		{"a tier may be appended", replace(`{"id":"gold","at":9}`, `{"id":"gold","at":9},{"id":"platinum","at":20}`), ""},
		{"an achievement may be added", strings.TrimSuffix(releasedCatalog, `]}`) + `,{"id":"fresh","title":"F","description":"F.","counter":{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"resource"}]},"tiers":[{"id":"bronze","at":1}]}]}`, ""},

		{"achievement id changed", replace(`"id":"dash-builder"`, `"id":"dash-maker"`), `achievement "dash-builder" was removed or its id changed`},
		{"tier removed", replace(`,{"id":"silver","at":5,"art":"dash-2"}`, ``), `tier "silver" was removed or its id changed`},
		{"tier id renamed", replace(`"id":"gold"`, `"id":"golden"`), `tier "gold" was removed or its id changed`},
		{"tiers reordered", replace(`{"id":"bronze","at":1,"art":"dash-1"},{"id":"silver","at":5,"art":"dash-2"}`, `{"id":"silver","at":1,"art":"dash-2"},{"id":"bronze","at":5,"art":"dash-1"}`), `tier "silver" moved below a tier it was released above`},
		{"counter unit changed", replace(`"counter":{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"resource"}]}`, `"counter":{"unit":"guide","evidence":[{"entity":"guides","action":"completed","countBy":"resource"}]}`), "counter unit changed"},
	}
	released := load(t, releasedCatalog)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := CheckRelease(registry, registry, released, load(t, tc.current))
			if tc.want == "" {
				if err != nil {
					t.Errorf("rejected: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestCheckReleaseRegistry(t *testing.T) {
	released := mustRegistry(t)
	empty := &Catalog{}
	replace := func(old, new string) string {
		if !strings.Contains(testRegistryJSON, old) {
			t.Fatalf("fixture does not contain %q", old)
		}
		return strings.Replace(testRegistryJSON, old, new, 1)
	}
	cases := []struct{ name, current, want string }{
		{"unchanged", testRegistryJSON, ""},
		{"a context field may be added", replace(`"starred":{"type":"boolean"}`, `"starred":{"type":"boolean"},"folder":{"type":"string"}`), ""},
		{"a resource may be appended", replace(`"resources":[{"unit":"dashboard","id":["resourceId"]}]`, `"resources":[{"unit":"dashboard","id":["resourceId"]},{"unit":"panel-count","id":["numPanels"]}]`), ""},

		{"action removed", replace(`"alert-rules":{"actions":{"created":{"context":{}}}}`, `"alert-rules":{"actions":{"deleted":{"context":{}}}}`), "alert-rules.created was removed"},
		{"context field retyped", replace(`"numPanels":{"type":"number"}`, `"numPanels":{"type":"string"}`), `context field "numPanels" was removed or retyped`},
		{"unit identified differently", replace(`{"unit":"dashboard","id":["resourceId"]}`, `{"unit":"dashboard","id":["resourceId","numPanels"]}`), `resource 0 ("dashboard")`},
		{"resources reordered", replace(`[{"unit":"guide","id":["guideSource","guideId"]},{"unit":"guide-category","id":["guideCategory"]}]`, `[{"unit":"guide-category","id":["guideCategory"]},{"unit":"guide","id":["guideSource","guideId"]}]`), `resource 0 ("guide")`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			current, err := LoadRegistry([]byte(tc.current))
			if err != nil {
				t.Fatalf("fixture: %v", err)
			}
			err = CheckRelease(released, current, empty, empty)
			if tc.want == "" {
				if err != nil {
					t.Errorf("rejected: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestBundledDefinitionsKeepTheLastReleasesIdentities(t *testing.T) {
	if out, err := exec.Command("git", "rev-parse", "--is-shallow-repository").Output(); err != nil {
		t.Skipf("not a git checkout: %v", err)
	} else if strings.TrimSpace(string(out)) == "true" {
		t.Fatal("shallow clone: the last release tag is unreachable; check out with full history (fetch-depth: 0)")
	}
	tag, err := exec.Command("git", "describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", "HEAD").Output()
	if err != nil {
		t.Logf("no release tag reachable from HEAD, nothing to guard: %v", err)
		return
	}
	release := strings.TrimSpace(string(tag))
	registryJSON, okRegistry := fileAtRelease(t, release, "pkg/achievements/data/events.json")
	catalogJSON, okCatalog := fileAtRelease(t, release, "pkg/achievements/data/achievements.json")
	if !okRegistry || !okCatalog {
		t.Logf("release %s ships no achievements catalog, nothing to guard", release)
		return
	}
	releasedRegistry, err := LoadRegistry(registryJSON)
	if err != nil {
		t.Fatalf("registry at %s: %v", release, err)
	}
	releasedCatalog, err := LoadCatalog(catalogJSON, releasedRegistry)
	if err != nil {
		t.Fatalf("catalog at %s: %v", release, err)
	}
	registry, catalog, err := LoadBundled()
	if err != nil {
		t.Fatal(err)
	}
	if err := CheckRelease(releasedRegistry, registry, releasedCatalog, catalog); err != nil {
		t.Errorf("against release %s:\n%v\nNever remove or rename an achievement or tier id, reorder tiers, or change what a counter counts; end the old achievement and start a new one.", release, err)
	}
}

func fileAtRelease(t *testing.T, tag, path string) ([]byte, bool) {
	t.Helper()
	out, err := exec.Command("git", "show", tag+":"+path).Output()
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return nil, false
	}
	if err != nil {
		t.Fatalf("git show %s:%s: %v", tag, path, err)
	}
	return out, true
}
