package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
)

const (
	guidesEntity = `{"owner":"@grafana/pathfinder","actions":{"completed":{
  "context":{"guideSource":{"type":"string"},"guideId":{"type":"string"}},
  "resources":[{"unit":"guide","id":["guideSource","guideId"]}]}}}`
	guidesFinished = `{
  "id": "guides-finished", "title": "Guide finisher", "description": "Finish guides.",
  "tiers": [
    {"id": "bronze", "goal": 1, "rules": [{"entity": "guides", "action": "completed", "countBy": "resource"}], "art": "guides-finished-1"},
    {"id": "silver", "goal": 4, "rules": [{"entity": "guides", "action": "completed", "countBy": "resource"}]}
  ]
}`
	testSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>`
)

func sourceTree(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for _, sub := range []string{"catalog", "events", "art"} {
		if err := os.MkdirAll(filepath.Join(dir, sub), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func runCmd(args ...string) (code int, stdout, stderr string) {
	var out, errOut bytes.Buffer
	code = run(args, &out, &errOut)
	return code, out.String(), errOut.String()
}

func TestBuildWritesABundleThatLoads(t *testing.T) {
	src := sourceTree(t, map[string]string{
		"events/guides.json":           guidesEntity,
		"catalog/guides-finished.json": guidesFinished,
		"art/guides-finished-1.svg":    testSVG,
	})
	out := filepath.Join(t.TempDir(), "definitions.json")
	if code, _, stderr := runCmd("build", "-src", src, "-repo", "grafana/interactive-tutorials", "-commit", "abc", "-o", out); code != exitOK {
		t.Fatalf("build = %d: %s", code, stderr)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	s, err := achievements.LoadBundle(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Skipped) != 0 || len(s.Catalog.Achievements) != 1 || s.Grammar != "2.0" {
		t.Errorf("snapshot = %+v", s)
	}
	if strings.Join(s.Art, ",") != "guides-finished-1" || !strings.Contains(string(data), `"commit": "abc"`) {
		t.Errorf("bundle = %s", data)
	}
	if code, _, stderr := runCmd("validate", out); code != exitOK {
		t.Errorf("validate = %d: %s", code, stderr)
	}
	if code, _, stderr := runCmd("compat", out, out); code != exitOK {
		t.Errorf("compat with itself = %d: %s", code, stderr)
	}
}

const grotGroundbreaker = `{
  "id": "grot-groundbreaker", "title": "Groundbreaker", "description": "Granted for a course finished elsewhere.",
  "grantOnly": true,
  "tiers": [{"id": "earned", "art": "grot-groundbreaker"}]
}`

func TestBuildChecksAGrantOnlyTree(t *testing.T) {
	src := sourceTree(t, map[string]string{
		"events/guides.json":              guidesEntity,
		"catalog/grot-groundbreaker.json": grotGroundbreaker,
		"art/grot-groundbreaker.svg":      testSVG,
	})
	dir := t.TempDir()
	out := filepath.Join(dir, "definitions.json")
	if code, _, stderr := runCmd("build", "-src", src, "-o", out); code != exitOK {
		t.Fatalf("build = %d: %s", code, stderr)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	s, err := achievements.LoadBundle(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Skipped) != 0 || len(s.Catalog.Achievements) != 1 || !s.Catalog.Achievements[0].GrantOnly {
		t.Fatalf("snapshot = %+v", s)
	}
	if code, _, stderr := runCmd("validate", out); code != exitOK {
		t.Errorf("validate = %d: %s", code, stderr)
	}
	if code, _, stderr := runCmd("compat", out, out); code != exitOK {
		t.Errorf("compat with itself = %d: %s", code, stderr)
	}

	earnable := filepath.Join(dir, "earnable.json")
	flipped := strings.Replace(string(data), `"grantOnly": true,`, `"grantOnly": false,`, 1)
	if flipped == string(data) {
		t.Fatal("built bundle no longer carries the author's grantOnly key")
	}
	if err := os.WriteFile(earnable, []byte(flipped), 0o644); err != nil {
		t.Fatal(err)
	}
	if code, _, stderr := runCmd("compat", out, earnable); code != exitProblems || !strings.Contains(stderr, `achievement "grot-groundbreaker" changed grantOnly from true to false`) {
		t.Errorf("compat = %d stderr = %q", code, stderr)
	}
}

func TestBuildRefusesAGrantOnlyTierWithRules(t *testing.T) {
	src := sourceTree(t, map[string]string{
		"events/guides.json": guidesEntity,
		"catalog/grot-groundbreaker.json": strings.Replace(grotGroundbreaker, `"art": "grot-groundbreaker"`,
			`"art": "grot-groundbreaker", "goal": 1, "rules": [{"entity": "guides", "action": "completed", "countBy": "resource"}]`, 1),
		"art/grot-groundbreaker.svg": testSVG,
	})
	code, _, stderr := runCmd("build", "-src", src, "-o", filepath.Join(t.TempDir(), "definitions.json"))
	if code != exitProblems || !strings.Contains(stderr, "a grant-only tier has no goal or rules") {
		t.Errorf("build = %d stderr = %q", code, stderr)
	}
}

func TestBuildRejects(t *testing.T) {
	cases := []struct {
		name  string
		files map[string]string
		omit  string
		want  string
	}{
		{"per-definition version", map[string]string{"catalog/guides-finished.json": strings.Replace(guidesFinished, `"title"`, `"requires": "1.0", "title"`, 1)}, "", `unknown field "requires"`},
		{"file name differs from id", map[string]string{"catalog/other.json": guidesFinished}, "", `file name "other"`},
		{"unknown field", map[string]string{"catalog/guides-finished.json": strings.Replace(guidesFinished, `"title"`, `"streak": 3, "title"`, 1)}, "", `unknown field "streak"`},
		{"art without an image", map[string]string{"catalog/guides-finished.json": guidesFinished}, "art/guides-finished-1.svg", `art "guides-finished-1" has no published image`},
		{"undeclared pair", map[string]string{"catalog/guides-finished.json": guidesFinished, "events/guides.json": `{"actions":{"started":{"context":{}}}}`}, "", "guides.completed is not declared"},
		{"invalid registry action", map[string]string{"events/guides.json": `{"actions":{"completed":{"context":{"at":{"type":"date"}}}}}`}, "", "action guides.completed skipped as invalid"},
		{"entity not JSON", map[string]string{"events/guides.json": `{`}, "", "unexpected EOF"},
		{"action key this build does not read", map[string]string{"events/guides.json": strings.Replace(guidesEntity, `"resources"`, `"resouces"`, 1)}, "", `key "resouces" is not one this build reads`},
		{"entity with an unread field", map[string]string{"events/guides.json": strings.Replace(guidesEntity, `"owner"`, `"leak":"x","owner"`, 1)}, "", `unknown field "leak"`},
		{"invalid source", map[string]string{"events/guides.json": strings.Replace(guidesEntity, `"resources"`, `"sources":[{"interaction":"grafana_guide_done","emitter":"grafana","versions":">=13.2.0","owner":"nobody"}],"resources"`, 1)}, "", "source grafana_guide_done skipped as invalid: guides.completed: owner must be a team handle"},
		{"case-variant id", map[string]string{"catalog/guides-finished.json": strings.Replace(guidesFinished, `"title"`, `"ID": "other", "title"`, 1)}, "", "declare id exactly once"},
		{"bad entity file name", map[string]string{"events/Bad Name.json": `{"actions":{"x":{"context":{}}}}`}, "", "entity Bad Name skipped"},
		{"bad art file name", map[string]string{"art/Weird KEY.svg": testSVG}, "", "art #0 skipped"},
		{"empty art file", map[string]string{"art/guides-finished-1.svg": ""}, "", "guides-finished-1.svg: no svg root element"},
		{"art that is not XML", map[string]string{"art/guides-finished-1.svg": "\x89PNG"}, "", "guides-finished-1.svg: not well-formed XML"},
		{"art left unclosed", map[string]string{"art/guides-finished-1.svg": `<svg xmlns="http://www.w3.org/2000/svg">`}, "", "not well-formed XML"},
		{"art root without the SVG namespace", map[string]string{"art/guides-finished-1.svg": "<svg/>"}, "", `root element is "svg" in namespace ""`},
		{"art root that is not svg", map[string]string{"art/guides-finished-1.svg": `<html xmlns="http://www.w3.org/2000/svg"/>`}, "", `root element is "html"`},
		{"art with a second root", map[string]string{"art/guides-finished-1.svg": testSVG + testSVG}, "", "more than one root element"},
		{"art with text after the root", map[string]string{"art/guides-finished-1.svg": testSVG + "trailing"}, "", "text outside the svg root element"},
		{"art with a non-XML space after the root", map[string]string{"art/guides-finished-1.svg": testSVG + "\u00a0"}, "", "text outside the svg root element"},
		{"another extension", map[string]string{"catalog/notes.md": "x"}, "", "unexpected file"},
		{"empty catalog", map[string]string{}, "catalog/guides-finished.json", "no definitions"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			files := map[string]string{"events/guides.json": guidesEntity, "catalog/guides-finished.json": guidesFinished, "art/guides-finished-1.svg": testSVG}
			for k, v := range tc.files {
				files[k] = v
			}
			delete(files, tc.omit)
			code, stdout, stderr := runCmd("build", "-src", sourceTree(t, files))
			if code != exitProblems || !strings.Contains(stderr, tc.want) || stdout != "" {
				t.Errorf("code = %d stderr = %q stdout = %q, want %q and no bundle", code, stderr, stdout, tc.want)
			}
		})
	}
}

func TestBuildAcceptsACommonSVGPrologue(t *testing.T) {
	art := "\xef\xbb\xbf<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
		`<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">` + "\n" +
		"<!-- exported -->\n" + `<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>` + "\n"
	src := sourceTree(t, map[string]string{
		"events/guides.json":           guidesEntity,
		"catalog/guides-finished.json": guidesFinished,
		"art/guides-finished-1.svg":    art,
	})
	if code, _, stderr := runCmd("build", "-src", src); code != exitOK {
		t.Errorf("build = %d: %s", code, stderr)
	}
}

func TestBuildAcceptsASource(t *testing.T) {
	entity := strings.Replace(guidesEntity, `"resources"`, `"sources":[{"interaction":"grafana_guide_done","emitter":"grafana","versions":">=13.2.0",
  "context":{"guideSource":"source","guideId":"id"},"owner":"@grafana/pathfinder","silent":true}],"resources"`, 1)
	src := sourceTree(t, map[string]string{"events/guides.json": entity, "catalog/guides-finished.json": guidesFinished, "art/guides-finished-1.svg": testSVG})
	out := filepath.Join(t.TempDir(), "definitions.json")
	if code, _, stderr := runCmd("build", "-src", src, "-o", out); code != exitOK {
		t.Fatalf("build = %d: %s", code, stderr)
	}
	data, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	s, err := achievements.LoadBundle(data)
	if err != nil {
		t.Fatal(err)
	}
	if subs := s.Registry.Subscriptions(achievements.Stack{}); len(subs) != 1 || subs[0].Interaction != "grafana_guide_done" {
		t.Errorf("subscriptions = %+v", subs)
	}
}

func TestValidateTheTestBundle(t *testing.T) {
	if code, _, stderr := runCmd("validate", "../../testdata/bundle.json"); code != exitOK {
		t.Errorf("validate = %d: %s", code, stderr)
	}
}

func TestCompatRefusesABreak(t *testing.T) {
	live := filepath.Join("..", "..", "testdata", "bundle.json")
	data, err := os.ReadFile(live)
	if err != nil {
		t.Fatal(err)
	}
	next := filepath.Join(t.TempDir(), "next.json")
	broken := strings.Replace(string(data), `, "guides-finished-2"`, ``, 1)
	if err := os.WriteFile(next, []byte(broken), 0o644); err != nil {
		t.Fatal(err)
	}
	code, _, stderr := runCmd("compat", live, next)
	if code != exitProblems || !strings.Contains(stderr, `art key "guides-finished-2" was removed`) {
		t.Errorf("code = %d stderr = %q", code, stderr)
	}
}

func TestCompatRefusesATierInsertedBelowAPublishedOne(t *testing.T) {
	live := filepath.Join("..", "..", "testdata", "bundle.json")
	data, err := os.ReadFile(live)
	if err != nil {
		t.Fatal(err)
	}
	inserted := strings.Replace(string(data), `{
            "id": "gold",`, `{ "id": "electrum", "goal": 2, "rules": [{ "entity": "guides", "action": "completed", "countBy": "resource" }] },
          {
            "id": "gold",`, 1)
	if inserted == string(data) {
		t.Fatal("fixture no longer has the gold tier")
	}
	next := filepath.Join(t.TempDir(), "next.json")
	if err := os.WriteFile(next, []byte(inserted), 0o644); err != nil {
		t.Fatal(err)
	}
	code, _, stderr := runCmd("compat", live, next)
	if code != exitProblems || !strings.Contains(stderr, `tier "electrum" was added before published tier "gold"`) {
		t.Errorf("code = %d stderr = %q", code, stderr)
	}
}

func TestUsage(t *testing.T) {
	for _, args := range [][]string{{}, {"publish"}, {"build"}, {"validate"}, {"compat", "a"}, {"build", "-src", "/does/not/exist"}} {
		if code, _, _ := runCmd(args...); code != exitUsage {
			t.Errorf("%v = %d, want usage", args, code)
		}
	}
}

func TestBuildRefusesLinksAndDirectories(t *testing.T) {
	outside := filepath.Join(t.TempDir(), "outside.json")
	if err := os.WriteFile(outside, []byte(`{"actions":{}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	src := sourceTree(t, map[string]string{
		"events/guides.json":           guidesEntity,
		"catalog/guides-finished.json": guidesFinished,
		"art/guides-finished-1.svg":    testSVG,
	})
	if err := os.Symlink(outside, filepath.Join(src, "events", "leak.json")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(src, "catalog", "sub.json"), 0o755); err != nil {
		t.Fatal(err)
	}
	code, stdout, stderr := runCmd("build", "-src", src)
	if code != exitProblems || stdout != "" || strings.Count(stderr, "not a regular file") != 2 {
		t.Errorf("code = %d stdout = %q stderr = %q", code, stdout, stderr)
	}
}

func TestBuildRefusesToWriteThroughALink(t *testing.T) {
	src := sourceTree(t, map[string]string{
		"events/guides.json":           guidesEntity,
		"catalog/guides-finished.json": guidesFinished,
		"art/guides-finished-1.svg":    testSVG,
	})
	dir := t.TempDir()
	target := filepath.Join(dir, "target")
	link := filepath.Join(dir, "definitions.json")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if code, _, stderr := runCmd("build", "-src", src, "-o", link); code != exitUsage || !strings.Contains(stderr, "through a link") {
		t.Errorf("code = %d stderr = %q", code, stderr)
	}
	if _, err := os.Stat(target); err == nil {
		t.Error("wrote through the link")
	}
}

func TestValidateRefusesAnUnpublishedArtKey(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "testdata", "bundle.json"))
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "bundle.json")
	body := strings.Replace(string(data), `"art": ["guides-finished-1", `, `"art": [`, 1)
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if code, _, stderr := runCmd("validate", path); code != exitProblems || !strings.Contains(stderr, `art "guides-finished-1" has no published image`) {
		t.Errorf("validate = %d: %s", code, stderr)
	}
}
