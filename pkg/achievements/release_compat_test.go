package achievements

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"slices"
	"strings"
	"testing"
)

var releaseTagPattern = regexp.MustCompile(`^v\d+\.\d+\.\d+$`)

const (
	catalogPath  = "pkg/achievements/data/achievements.json"
	registryPath = "pkg/achievements/data/events.json"
)

// Award rows and progress name achievements, tiers and counted units for good,
// so a release may never drop, reorder or redefine what an earlier one shipped.
func TestBundledDataKeepsWhatTheLastReleaseShipped(t *testing.T) {
	root, tag := lastReleaseTag(t)
	if tag == "" {
		t.Log("no release tag; nothing has shipped yet")
		return
	}
	for _, check := range []struct {
		path   string
		breaks func(released, current []byte) ([]string, error)
		embed  []byte
		fix    string
	}{
		{catalogPath, catalogBreaks, catalogJSON, "Restore it, and to retire or redefine an achievement, end it and add a new one with a new id"},
		{registryPath, registryBreaks, registryJSON, "Restore it, and add new fields, resources or actions instead of changing released ones"},
	} {
		released, ok := showAt(t, root, tag, check.path)
		if !ok {
			t.Logf("%s did not exist at %s; nothing to compare", check.path, tag)
			continue
		}
		problems, err := check.breaks(released, check.embed)
		if err != nil {
			t.Fatalf("%s at %s: %v", check.path, tag, err)
		}
		for _, p := range problems {
			t.Errorf("%s breaks what %s shipped: %s. %s.", check.path, tag, p, check.fix)
		}
	}
}

func lastReleaseTag(t *testing.T) (root, tag string) {
	t.Helper()
	out, err := exec.Command("git", "rev-parse", "--show-toplevel").Output()
	if err != nil {
		t.Logf("not in a git checkout: %v", err)
		return "", ""
	}
	root = strings.TrimSpace(string(out))
	out, err = exec.Command("git", "-C", root, "tag", "--list", "v*", "--sort=-v:refname").Output()
	if err != nil {
		t.Fatalf("listing tags: %v", err)
	}
	for _, line := range strings.Split(string(out), "\n") {
		if releaseTagPattern.MatchString(line) {
			return root, line
		}
	}
	return root, ""
}

func showAt(t *testing.T, root, tag, path string) ([]byte, bool) {
	t.Helper()
	ref := tag + ":" + path
	if exec.Command("git", "-C", root, "cat-file", "-e", ref).Run() != nil {
		return nil, false
	}
	out, err := exec.Command("git", "-C", root, "show", ref).Output()
	if err != nil {
		t.Fatalf("reading %s: %v", ref, err)
	}
	return out, true
}

type achievementIdentity struct {
	ID      string `json:"id"`
	Counter *struct {
		Unit string `json:"unit"`
	} `json:"counter"`
	Tiers []struct {
		ID string `json:"id"`
	} `json:"tiers"`
}

func (a achievementIdentity) unit() string {
	if a.Counter == nil {
		return ""
	}
	return a.Counter.Unit
}

func (a achievementIdentity) tierIDs() []string {
	ids := make([]string, len(a.Tiers))
	for i, tier := range a.Tiers {
		ids[i] = tier.ID
	}
	return ids
}

func catalogBreaks(released, current []byte) ([]string, error) {
	var before, after struct {
		Achievements []achievementIdentity `json:"achievements"`
	}
	if err := json.Unmarshal(released, &before); err != nil {
		return nil, fmt.Errorf("released catalog: %w", err)
	}
	if err := json.Unmarshal(current, &after); err != nil {
		return nil, fmt.Errorf("current catalog: %w", err)
	}
	now := make(map[string]achievementIdentity, len(after.Achievements))
	for _, a := range after.Achievements {
		now[a.ID] = a
	}
	var problems []string
	for _, was := range before.Achievements {
		is, ok := now[was.ID]
		if !ok {
			problems = append(problems, fmt.Sprintf("achievement %q was removed or renamed", was.ID))
			continue
		}
		if was.unit() != is.unit() {
			problems = append(problems, fmt.Sprintf("achievement %q counter unit changed from %q to %q", was.ID, was.unit(), is.unit()))
		}
		problems = append(problems, orderBreaks(fmt.Sprintf("achievement %q tier", was.ID), was.tierIDs(), is.tierIDs())...)
	}
	return problems, nil
}

type registryIdentity struct {
	Entities map[string]struct {
		Actions map[string]struct {
			Context map[string]struct {
				Type string `json:"type"`
			} `json:"context"`
			Resources []struct {
				Unit string   `json:"unit"`
				ID   []string `json:"id"`
			} `json:"resources"`
		} `json:"actions"`
	} `json:"entities"`
}

func registryBreaks(released, current []byte) ([]string, error) {
	var before, after registryIdentity
	if err := json.Unmarshal(released, &before); err != nil {
		return nil, fmt.Errorf("released registry: %w", err)
	}
	if err := json.Unmarshal(current, &after); err != nil {
		return nil, fmt.Errorf("current registry: %w", err)
	}
	var problems []string
	for _, entity := range sortedKeys(before.Entities) {
		nowEntity, ok := after.Entities[entity]
		if !ok {
			problems = append(problems, fmt.Sprintf("entity %q was removed", entity))
			continue
		}
		for _, name := range sortedKeys(before.Entities[entity].Actions) {
			was := before.Entities[entity].Actions[name]
			is, ok := nowEntity.Actions[name]
			pair := entity + "." + name
			if !ok {
				problems = append(problems, fmt.Sprintf("%s was removed", pair))
				continue
			}
			for _, field := range sortedKeys(was.Context) {
				f, ok := is.Context[field]
				switch {
				case !ok:
					problems = append(problems, fmt.Sprintf("%s field %q was removed", pair, field))
				case f.Type != was.Context[field].Type:
					problems = append(problems, fmt.Sprintf("%s field %q changed type from %s to %s", pair, field, was.Context[field].Type, f.Type))
				}
			}
			var wasUnits, isUnits []string
			for _, r := range was.Resources {
				wasUnits = append(wasUnits, r.Unit)
			}
			for _, r := range is.Resources {
				isUnits = append(isUnits, r.Unit)
			}
			problems = append(problems, orderBreaks(pair+" resource", wasUnits, isUnits)...)
			for _, r := range was.Resources {
				i := slices.Index(isUnits, r.Unit)
				if i >= 0 && !slices.Equal(r.ID, is.Resources[i].ID) {
					problems = append(problems, fmt.Sprintf("%s resource %q is now identified by %v, not %v", pair, r.Unit, is.Resources[i].ID, r.ID))
				}
			}
		}
	}
	return problems, nil
}

// orderBreaks reports ids missing from now, and released ids that no longer
// appear in their released order. New ids may appear anywhere.
func orderBreaks(what string, was, now []string) []string {
	var problems, kept []string
	for _, id := range was {
		if slices.Contains(now, id) {
			kept = append(kept, id)
		} else {
			problems = append(problems, fmt.Sprintf("%s %q was removed or renamed", what, id))
		}
	}
	var order []string
	for _, id := range now {
		if slices.Contains(kept, id) {
			order = append(order, id)
		}
	}
	if !slices.Equal(kept, order) {
		problems = append(problems, fmt.Sprintf("%ss were reordered from %v to %v", what, kept, order))
	}
	return problems
}

func TestCatalogBreaks(t *testing.T) {
	const released = `{"achievements":[
	  {"id":"guides","counter":{"unit":"guide"},"tiers":[{"id":"bronze"},{"id":"gold"}]},
	  {"id":"routes","tiers":[{"id":"bronze"}]}]}`
	cases := []struct{ name, current, want string }{
		{"unchanged", released, ""},
		{"a tier added in the middle, an achievement added, thresholds and art changed", `{"achievements":[
		  {"id":"new","tiers":[{"id":"bronze"}]},
		  {"id":"guides","counter":{"unit":"guide"},"tiers":[{"id":"bronze","at":3},{"id":"silver"},{"id":"gold","art":"x"}]},
		  {"id":"routes","tiers":[{"id":"starter"},{"id":"bronze"}]}]}`, ""},
		{"achievement removed", `{"achievements":[{"id":"guides","counter":{"unit":"guide"},"tiers":[{"id":"bronze"},{"id":"gold"}]}]}`, `achievement "routes" was removed or renamed`},
		{"tier removed", `{"achievements":[{"id":"guides","counter":{"unit":"guide"},"tiers":[{"id":"bronze"}]},{"id":"routes","tiers":[{"id":"bronze"}]}]}`, `achievement "guides" tier "gold" was removed or renamed`},
		{"tiers reordered", `{"achievements":[{"id":"guides","counter":{"unit":"guide"},"tiers":[{"id":"gold"},{"id":"bronze"}]},{"id":"routes","tiers":[{"id":"bronze"}]}]}`, `achievement "guides" tiers were reordered from [bronze gold] to [gold bronze]`},
		{"counter unit changed", `{"achievements":[{"id":"guides","counter":{"unit":"guide-category"},"tiers":[{"id":"bronze"},{"id":"gold"}]},{"id":"routes","tiers":[{"id":"bronze"}]}]}`, `achievement "guides" counter unit changed from "guide" to "guide-category"`},
		{"milestone became counted", `{"achievements":[{"id":"guides","counter":{"unit":"guide"},"tiers":[{"id":"bronze"},{"id":"gold"}]},{"id":"routes","counter":{"unit":"guide"},"tiers":[{"id":"bronze"}]}]}`, `achievement "routes" counter unit changed from "" to "guide"`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			problems, err := catalogBreaks([]byte(released), []byte(tc.current))
			if err != nil {
				t.Fatal(err)
			}
			if got := strings.Join(problems, "; "); got != tc.want {
				t.Errorf("problems = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestRegistryBreaks(t *testing.T) {
	const released = `{"entities":{"guides":{"actions":{"completed":{
	  "context":{"guideSource":{"type":"string"},"guideId":{"type":"string"}},
	  "resources":[{"unit":"guide","id":["guideSource","guideId"]},{"unit":"guide-category","id":["guideCategory"]}]}}}}}`
	with := func(context, resources string) string {
		return `{"entities":{"guides":{"actions":{"completed":{"context":` + context + `,"resources":` + resources + `}}}}}`
	}
	const ctx = `{"guideSource":{"type":"string"},"guideId":{"type":"string"}}`
	const res = `[{"unit":"guide","id":["guideSource","guideId"]},{"unit":"guide-category","id":["guideCategory"]}]`
	cases := []struct{ name, current, want string }{
		{"unchanged", released, ""},
		{"a field, a resource, an action and an entity added", `{"entities":{
		  "guides":{"actions":{"completed":{"context":{"guideSource":{"type":"string"},"guideId":{"type":"string"},"pathId":{"type":"string"}},
		    "resources":[{"unit":"guide","id":["guideSource","guideId"]},{"unit":"path","id":["pathId"]},{"unit":"guide-category","id":["guideCategory"]}]},
		    "started":{"context":{}}}},
		  "dashboards":{"actions":{"created":{"context":{}}}}}}`, ""},
		{"entity removed", `{"entities":{}}`, `entity "guides" was removed`},
		{"action removed", `{"entities":{"guides":{"actions":{}}}}`, `guides.completed was removed`},
		{"field removed", with(`{"guideSource":{"type":"string"}}`, res), `guides.completed field "guideId" was removed`},
		{"field retyped", with(`{"guideSource":{"type":"string"},"guideId":{"type":"number"}}`, res), `guides.completed field "guideId" changed type from string to number`},
		{"resource removed", with(ctx, `[{"unit":"guide","id":["guideSource","guideId"]}]`), `guides.completed resource "guide-category" was removed or renamed`},
		{"resources reordered", with(ctx, `[{"unit":"guide-category","id":["guideCategory"]},{"unit":"guide","id":["guideSource","guideId"]}]`), `guides.completed resources were reordered from [guide guide-category] to [guide-category guide]`},
		{"resource identified differently", with(ctx, `[{"unit":"guide","id":["guideId"]},{"unit":"guide-category","id":["guideCategory"]}]`), `guides.completed resource "guide" is now identified by [guideId], not [guideSource guideId]`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			problems, err := registryBreaks([]byte(released), []byte(tc.current))
			if err != nil {
				t.Fatal(err)
			}
			if got := strings.Join(problems, "; "); got != tc.want {
				t.Errorf("problems = %q, want %q", got, tc.want)
			}
		})
	}
}
