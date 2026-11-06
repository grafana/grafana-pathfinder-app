package achievements

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const (
	catalogPath  = "pkg/achievements/data/achievements.json"
	registryPath = "pkg/achievements/data/events.json"
)

// Only what the last release tag shipped is held to the author rules; unreleased edits are free.
func TestReleasedIdentitiesAreKept(t *testing.T) {
	registry, catalog, err := LoadBundled()
	if err != nil {
		t.Fatal(err)
	}
	tag, errs := compareWithLastRelease(t, "", registry, catalog)
	if err := errors.Join(errs...); err != nil {
		t.Errorf("changes against %s break the author rules (never remove or rename an id, never reorder tiers, never change a unit; end the old achievement and start a new one instead):\n%v", tag, err)
	}
}

func TestCompareWithLastReleaseReadsTheTaggedFiles(t *testing.T) {
	dir := t.TempDir()
	git := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com",
			"-c", "commit.gpgsign=false", "-c", "tag.gpgSign=false", "-c", "core.hooksPath=" + os.DevNull}, args...)...)
		cmd.Env = isolatedGitEnv()
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	write := func(path, body string) {
		t.Helper()
		full := filepath.Join(dir, path)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	git("init", "-q")
	write("README", "x")
	git("add", ".")
	git("commit", "-q", "-m", "before achievements")
	git("tag", "v1.0.0")
	registry, catalog := mustRegistry(t), mustCatalog(t)
	if tag, errs := compareWithLastRelease(t, dir, registry, catalog); len(errs) != 0 {
		t.Fatalf("%s shipped no catalog, got %v", tag, errs)
	}

	write(catalogPath, testCatalogJSON)
	write(registryPath, testRegistryJSON)
	git("add", ".")
	git("commit", "-q", "-m", "release achievements")
	git("tag", "v1.1.0")
	if _, errs := compareWithLastRelease(t, dir, registry, catalog); len(errs) != 0 {
		t.Fatalf("unchanged since v1.1.0, got %v", errs)
	}

	edited, err := LoadCatalog([]byte(strings.Replace(testCatalogJSON, `{"id":"silver","at":5,"art":"dash-2"},`, "", 1)), registry)
	if err != nil {
		t.Fatal(err)
	}
	tag, errs := compareWithLastRelease(t, dir, registry, edited)
	if tag != "v1.1.0" || len(errs) != 1 || !strings.Contains(errs[0].Error(), `achievement "dash-builder": tier "silver" was removed`) {
		t.Errorf("tag = %s errs = %v, want the removed silver tier reported against v1.1.0", tag, errs)
	}
}

// An empty dir is the working directory.
func compareWithLastRelease(t *testing.T, dir string, registry *Registry, catalog *Catalog) (string, []error) {
	t.Helper()
	tag, err := gitOutput(dir, "describe", "--tags", "--abbrev=0", "--match", "v[0-9]*")
	if err != nil {
		if os.Getenv("REQUIRE_RELEASE_TAG") != "" {
			t.Fatalf("REQUIRE_RELEASE_TAG is set but no release tag is reachable (%v); check out with full history and tags (fetch-depth: 0)", err)
		}
		t.Logf("no release tag reachable (%v); nothing released to compare", err)
		return "", nil
	}
	tag = strings.TrimSpace(tag)
	var errs []error
	if body, ok := fileAtTag(t, dir, tag, catalogPath); ok {
		var released Catalog
		if err := json.Unmarshal([]byte(body), &released); err != nil {
			t.Fatalf("%s:%s: %v", tag, catalogPath, err)
		}
		errs = append(errs, checkReleasedCatalog(&released, catalog)...)
	}
	if body, ok := fileAtTag(t, dir, tag, registryPath); ok {
		var released Registry
		if err := json.Unmarshal([]byte(body), &released); err != nil {
			t.Fatalf("%s:%s: %v", tag, registryPath, err)
		}
		errs = append(errs, checkReleasedRegistry(&released, registry)...)
	}
	return tag, errs
}

func gitOutput(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	if dir != "" {
		cmd = exec.Command("git", append([]string{"-C", dir}, args...)...)
		cmd.Env = isolatedGitEnv()
	}
	out, err := cmd.Output()
	return string(out), err
}

// Inside a git hook GIT_DIR and friends point at the real repository, which a
// throwaway repo's commands must never touch.
func isolatedGitEnv() []string {
	var env []string
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, "GIT_") {
			env = append(env, kv)
		}
	}
	return env
}

func fileAtTag(t *testing.T, dir, tag, path string) (string, bool) {
	t.Helper()
	if _, err := gitOutput(dir, "cat-file", "-e", tag+":"+path); err != nil {
		t.Logf("%s ships no %s; nothing released to compare", tag, path)
		return "", false
	}
	out, err := gitOutput(dir, "show", tag+":"+path)
	if err != nil {
		t.Fatalf("git show %s:%s: %v", tag, path, err)
	}
	return out, true
}

func checkReleasedCatalog(released, current *Catalog) []error {
	byID := map[string]*Definition{}
	for i := range current.Achievements {
		byID[current.Achievements[i].ID] = &current.Achievements[i]
	}
	var errs []error
	for i := range released.Achievements {
		base := &released.Achievements[i]
		where := fmt.Sprintf("achievement %q", base.ID)
		cur, ok := byID[base.ID]
		if !ok {
			errs = append(errs, fmt.Errorf("%s was removed or renamed", where))
			continue
		}
		if counterUnit(base) != counterUnit(cur) {
			errs = append(errs, fmt.Errorf("%s: counter unit changed from %q to %q", where, counterUnit(base), counterUnit(cur)))
		}
		rank := map[string]int{}
		for j, tier := range cur.Tiers {
			rank[tier.ID] = j
		}
		last := -1
		for _, tier := range base.Tiers {
			j, ok := rank[tier.ID]
			switch {
			case !ok:
				errs = append(errs, fmt.Errorf("%s: tier %q was removed or renamed", where, tier.ID))
			case j < last:
				errs = append(errs, fmt.Errorf("%s: tier %q was moved below a tier it ranked above", where, tier.ID))
			default:
				last = j
			}
		}
	}
	return errs
}

func counterUnit(d *Definition) string {
	if d.Counter == nil {
		return ""
	}
	return d.Counter.Unit
}

func checkReleasedRegistry(released, current *Registry) []error {
	var errs []error
	for _, entity := range sortedKeys(released.Entities) {
		for _, name := range sortedKeys(released.Entities[entity].Actions) {
			where := fmt.Sprintf("registry %s.%s", entity, name)
			base := released.Entities[entity].Actions[name]
			cur, ok := current.action(entity, name)
			if !ok {
				errs = append(errs, fmt.Errorf("%s was removed or renamed", where))
				continue
			}
			for _, field := range sortedKeys(base.Context) {
				got, ok := cur.Context[field]
				switch {
				case !ok:
					errs = append(errs, fmt.Errorf("%s: context field %q was removed or renamed", where, field))
				case got.Type != base.Context[field].Type:
					errs = append(errs, fmt.Errorf("%s: context field %q changed type from %s to %s", where, field, base.Context[field].Type, got.Type))
				}
			}
			for i, res := range base.Resources {
				if i >= len(cur.Resources) || cur.Resources[i].Unit != res.Unit || !slices.Equal(cur.Resources[i].ID, res.ID) {
					errs = append(errs, fmt.Errorf("%s: resource %d (unit %q identified by %v) was removed, reordered, or re-identified", where, i, res.Unit, res.ID))
				}
			}
		}
	}
	return errs
}

func TestCheckReleasedCatalog(t *testing.T) {
	const dash = `"counter":{"unit":"dashboard","evidence":[{"entity":"dashboards","action":"created","countBy":"resource"}]}`
	achievement := func(id, counter, tiers string) string {
		return fmt.Sprintf(`{"id":%q,"title":"X","description":"X.",%s,"tiers":%s}`, id, counter, tiers)
	}
	const released = `[{"id":"bronze","at":1},{"id":"gold","at":10}]`
	base := wrap(achievement("dash", dash, released))
	cases := []struct{ name, current, want string }{
		{"unchanged", base, ""},
		{"tier inserted between", wrap(achievement("dash", dash, `[{"id":"bronze","at":1},{"id":"silver","at":5},{"id":"gold","at":10}]`)), ""},
		{"tier inserted below", wrap(achievement("dash", dash, `[{"id":"starter","at":1},{"id":"bronze","at":2},{"id":"gold","at":10}]`)), ""},
		{"tier appended", wrap(achievement("dash", dash, `[{"id":"bronze","at":1},{"id":"gold","at":10},{"id":"platinum","at":20}]`)), ""},
		{"thresholds, art and words moved", wrap(`{"id":"dash","title":"Y","description":"Y.",` + dash + `,"tiers":[{"id":"bronze","at":3,"art":"a"},{"id":"gold","at":30}]}`), ""},
		{"achievement added", wrap(achievement("dash", dash, released) + "," + achievement("more", dash, `[{"id":"one","at":1}]`)), ""},
		{"achievement removed", wrap(achievement("more", dash, `[{"id":"one","at":1}]`)), `achievement "dash" was removed or renamed`},
		{"tier removed", wrap(achievement("dash", dash, `[{"id":"gold","at":10}]`)), `tier "bronze" was removed or renamed`},
		{"tier renamed", wrap(achievement("dash", dash, `[{"id":"bronze","at":1},{"id":"golden","at":10}]`)), `tier "gold" was removed or renamed`},
		{"tiers reordered", wrap(achievement("dash", dash, `[{"id":"gold","at":1},{"id":"bronze","at":10}]`)), `tier "gold" was moved below`},
		{"counter unit changed", wrap(achievement("dash", `"counter":{"unit":"occurrence","evidence":[{"entity":"dashboards","action":"created","countBy":"occurrence"}]}`, released)), `counter unit changed from "dashboard" to "occurrence"`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var before, after Catalog
			if err := json.Unmarshal([]byte(base), &before); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal([]byte(tc.current), &after); err != nil {
				t.Fatal(err)
			}
			err := errors.Join(checkReleasedCatalog(&before, &after)...)
			if tc.want == "" && err != nil {
				t.Errorf("rejected a supported change: %v", err)
			}
			if tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)) {
				t.Errorf("err = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestCheckReleasedRegistry(t *testing.T) {
	registry := func(context, resources string) string {
		return `{"schemaVersion":1,"entities":{"guides":{"actions":{"completed":{"context":{` + context + `},"resources":[` + resources + `]}}}}}`
	}
	const fields = `"guideSource":{"type":"string"},"guideId":{"type":"string"}`
	const guide = `{"unit":"guide","id":["guideSource","guideId"]}`
	base := registry(fields, guide)
	cases := []struct{ name, current, want string }{
		{"unchanged", base, ""},
		{"field and resource added", registry(fields+`,"pathId":{"type":"string"}`, guide+`,{"unit":"path","id":["pathId"]}`), ""},
		{"pair removed", `{"schemaVersion":1,"entities":{"dashboards":{"actions":{"created":{"context":{}}}}}}`, "registry guides.completed was removed or renamed"},
		{"field removed", registry(`"guideSource":{"type":"string"},"id":{"type":"string"}`, `{"unit":"guide","id":["guideSource","id"]}`), `context field "guideId" was removed`},
		{"field retyped", registry(`"guideSource":{"type":"string"},"guideId":{"type":"number"}`, guide), `context field "guideId" changed type from string to number`},
		{"unit re-identified", registry(fields, `{"unit":"guide","id":["guideId"]}`), "resource 0 (unit \"guide\""},
		{"resource reordered", registry(fields+`,"pathId":{"type":"string"}`, `{"unit":"path","id":["pathId"]},`+guide), "resource 0 (unit \"guide\""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var before, after Registry
			if err := json.Unmarshal([]byte(base), &before); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal([]byte(tc.current), &after); err != nil {
				t.Fatal(err)
			}
			err := errors.Join(checkReleasedRegistry(&before, &after)...)
			if tc.want == "" && err != nil {
				t.Errorf("rejected a supported change: %v", err)
			}
			if tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)) {
				t.Errorf("err = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}
