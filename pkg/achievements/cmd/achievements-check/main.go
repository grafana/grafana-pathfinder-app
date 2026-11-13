// Command achievements-check builds, validates and compares the published
// achievements bundle with the same loader the plugin backend runs.
//
//	achievements-check build -src <dir> [-repo <repo>] [-commit <sha>] [-o <file>]
//	achievements-check validate <bundle.json>
//	achievements-check compat <live.json> <next.json>
//
// The source directory holds catalog/<achievement-id>.json (one definition per
// file), events/<entity>.json (one registry entity per file) and art/<key>.svg
// (one SVG document per file).
// build writes the file for achievements.FormatVersion, published at
// achievements/<FormatVersion>/definitions.json. Every source definition must be
// expressible in that format; once several versions are published, each
// version's file leaves out the achievements it cannot express.
package main

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"errors"
	"flag"
	"fmt"
	"io"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
)

const (
	exitOK       = 0
	exitProblems = 1
	exitUsage    = 2
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		say(stderr, "usage: achievements-check build|validate|compat ...")
		return exitUsage
	}
	switch args[0] {
	case "build":
		return runBuild(args[1:], stdout, stderr)
	case "validate":
		return runValidate(args[1:], stdout, stderr)
	case "compat":
		return runCompat(args[1:], stdout, stderr)
	default:
		say(stderr, fmt.Sprintf("unknown command %q; want build, validate or compat", args[0]))
		return exitUsage
	}
}

func runBuild(args []string, stdout, stderr io.Writer) int {
	fs := flag.NewFlagSet("build", flag.ContinueOnError)
	fs.SetOutput(stderr)
	src := fs.String("src", "", "source directory with catalog/, events/ and art/")
	repo := fs.String("repo", "", "repository recorded in builtFrom")
	commit := fs.String("commit", "", "commit recorded in builtFrom")
	out := fs.String("o", "", "output file (default stdout)")
	if err := fs.Parse(args); err != nil || *src == "" || fs.NArg() != 0 {
		say(stderr, "usage: achievements-check build -src <dir> [-repo <repo>] [-commit <sha>] [-o <file>]")
		return exitUsage
	}
	data, problems, err := build(*src, *repo, *commit)
	if err != nil {
		say(stderr, err)
		return exitUsage
	}
	if data != nil {
		problems = append(problems, check(data)...)
	}
	if report(stderr, problems) {
		return exitProblems
	}
	if *out == "" {
		_, err = stdout.Write(data)
	} else {
		err = writeFile(*out, data)
	}
	if err != nil {
		say(stderr, err)
		return exitUsage
	}
	return exitOK
}

func runValidate(args []string, _, stderr io.Writer) int {
	if len(args) != 1 {
		say(stderr, "usage: achievements-check validate <bundle.json>")
		return exitUsage
	}
	data, err := os.ReadFile(args[0])
	if err != nil {
		say(stderr, err)
		return exitUsage
	}
	if report(stderr, check(data)) {
		return exitProblems
	}
	return exitOK
}

func runCompat(args []string, _, stderr io.Writer) int {
	if len(args) != 2 {
		say(stderr, "usage: achievements-check compat <live.json> <next.json>")
		return exitUsage
	}
	live, err := os.ReadFile(args[0])
	if err != nil {
		say(stderr, err)
		return exitUsage
	}
	next, err := os.ReadFile(args[1])
	if err != nil {
		say(stderr, err)
		return exitUsage
	}
	problems, err := achievements.BundleBreaks(live, next)
	if err != nil {
		problems = []string{err.Error()}
	}
	if report(stderr, problems) {
		say(stderr, "Published ids, tiers, units, registry fields and art keys are permanent. Restore them; to retire an achievement, end it and add a new one with a new id.")
		return exitProblems
	}
	return exitOK
}

func report(w io.Writer, problems []string) bool {
	for _, p := range problems {
		say(w, p)
	}
	return len(problems) > 0
}

// check holds a bundle to the publish bar: everything loads, nothing is
// skipped and every art key is published.
func check(data []byte) []string {
	s, err := achievements.LoadBundle(data)
	if err != nil {
		return []string{err.Error()}
	}
	problems := unknownActionKeys(data)
	for _, skip := range s.Skipped {
		problems = append(problems, fmt.Sprintf("%s %s skipped as %s: %s", skip.What, skip.ID, skip.Reason, skip.Detail))
	}
	for i := range s.Catalog.Achievements {
		d := &s.Catalog.Achievements[i]
		for _, t := range d.Tiers {
			if t.Art != "" && !slices.Contains(s.Art, t.Art) {
				problems = append(problems, fmt.Sprintf("achievement %s tier %s: art %q has no published image", d.ID, t.ID, t.Art))
			}
		}
	}
	return problems
}

// actionKeys are the action keys this build reads. The loader ignores any other
// as additive metadata; publishing one this build does not know is more likely
// a typo, so the publish bar refuses it.
var actionKeys = map[string]bool{"context": true, "resources": true}

func unknownActionKeys(data []byte) []string {
	var env struct {
		Registry struct {
			Entities map[string]struct {
				Actions map[string]map[string]json.RawMessage `json:"actions"`
			} `json:"entities"`
		} `json:"registry"`
	}
	if json.Unmarshal(data, &env) != nil {
		return nil
	}
	var problems []string
	for _, entity := range slices.Sorted(maps.Keys(env.Registry.Entities)) {
		actions := env.Registry.Entities[entity].Actions
		for _, action := range slices.Sorted(maps.Keys(actions)) {
			for _, key := range slices.Sorted(maps.Keys(actions[action])) {
				if !actionKeys[key] {
					problems = append(problems, fmt.Sprintf("action %s.%s: key %q is not one this build reads", entity, action, key))
				}
			}
		}
	}
	return problems
}

type builtFrom struct {
	Repo   string `json:"repo,omitempty"`
	Commit string `json:"commit,omitempty"`
}

type bundle struct {
	Grammar   string    `json:"grammar"`
	BuiltFrom builtFrom `json:"builtFrom"`
	Registry  struct {
		Entities map[string]json.RawMessage `json:"entities"`
	} `json:"registry"`
	Catalog struct {
		Achievements []json.RawMessage `json:"achievements"`
	} `json:"catalog"`
	Art []string `json:"art"`
}

// build assembles the bundle from what the loader would accept, so nothing in
// the source tree reaches the bundle unread. Problems are content errors for
// the author; err is a source tree that is not there.
func build(src, repo, commit string) ([]byte, []string, error) {
	b := bundle{Grammar: achievements.Grammar, BuiltFrom: builtFrom{Repo: repo, Commit: commit}, Art: []string{}}
	b.Registry.Entities = map[string]json.RawMessage{}
	b.Catalog.Achievements = []json.RawMessage{}
	var problems []string
	files := map[string][]sourceFile{}
	for _, dir := range []struct{ name, ext string }{{"events", ".json"}, {"catalog", ".json"}, {"art", ".svg"}} {
		found, dirProblems, err := sourceFiles(src, dir.name, dir.ext)
		if err != nil {
			return nil, nil, err
		}
		files[dir.name] = found
		problems = append(problems, dirProblems...)
	}

	for _, f := range files["events"] {
		entity, problem := readEntity(f.path)
		if problem != "" {
			problems = append(problems, fmt.Sprintf("%s: %s", f.path, problem))
			continue
		}
		b.Registry.Entities[f.stem] = entity
	}
	for _, f := range files["catalog"] {
		def, problem := readDefinition(f.stem, f.path)
		if problem != "" {
			problems = append(problems, fmt.Sprintf("%s: %s", f.path, problem))
			continue
		}
		b.Catalog.Achievements = append(b.Catalog.Achievements, def)
	}
	if len(files["catalog"]) == 0 {
		problems = append(problems, fmt.Sprintf("%s: no definitions", filepath.Join(src, "catalog")))
	}
	for _, f := range files["art"] {
		if problem := readArt(f.path); problem != "" {
			problems = append(problems, fmt.Sprintf("%s: %s", f.path, problem))
		}
		b.Art = append(b.Art, f.stem)
	}

	data, err := json.MarshalIndent(b, "", "  ")
	if err != nil {
		return nil, append(problems, err.Error()), nil
	}
	return append(data, '\n'), problems, nil
}

func readEntity(path string) (json.RawMessage, string) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err.Error()
	}
	var entity struct {
		Owner   string                     `json:"owner,omitempty"`
		Actions map[string]json.RawMessage `json:"actions"`
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&entity); err != nil {
		return nil, err.Error()
	}
	if dec.More() {
		return nil, "trailing data after JSON document"
	}
	out, err := json.Marshal(entity)
	if err != nil {
		return nil, err.Error()
	}
	return out, ""
}

// readDefinition keeps the author's text and field order. Keys are matched
// without regard to case, as the loader matches them.
func readDefinition(stem, path string) (json.RawMessage, string) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err.Error()
	}
	var keys map[string]json.RawMessage
	if err := json.Unmarshal(raw, &keys); err != nil {
		return nil, "not a JSON object"
	}
	ids := 0
	for k := range keys {
		if strings.EqualFold(k, "id") {
			ids++
		}
	}
	if ids != 1 {
		return nil, "declare id exactly once"
	}
	var d achievements.Definition
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&d); err != nil {
		return nil, err.Error()
	}
	if d.ID != stem {
		return nil, fmt.Sprintf("id %q must match the file name %q", d.ID, stem)
	}
	return json.RawMessage(raw), ""
}

const svgNamespace = "http://www.w3.org/2000/svg"

// readArt requires the file to parse as XML with one svg root element in the SVG
// namespace, without which a browser does not render it as an image. It is not a
// full XML conformance check.
func readArt(path string) string {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err.Error()
	}
	dec := xml.NewDecoder(bytes.NewReader(bytes.TrimPrefix(raw, []byte("\xef\xbb\xbf"))))
	depth, roots := 0, 0
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "not well-formed XML: " + err.Error()
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if depth == 0 {
				roots++
				if roots > 1 {
					return "more than one root element"
				}
				if t.Name.Local != "svg" || t.Name.Space != svgNamespace {
					return fmt.Sprintf("root element is %q in namespace %q; want svg in %s", t.Name.Local, t.Name.Space, svgNamespace)
				}
			}
			depth++
		case xml.EndElement:
			depth--
		case xml.CharData:
			if depth == 0 && len(bytes.Trim(t, " \t\r\n")) > 0 {
				return "text outside the svg root element"
			}
		}
	}
	if roots == 0 {
		return "no svg root element"
	}
	return ""
}

type sourceFile struct{ path, stem string }

// sourceFiles lists dir's regular files. A link, a subdirectory or another
// extension is a problem, so the build never reads outside the tree.
func sourceFiles(src, dir, ext string) ([]sourceFile, []string, error) {
	path := filepath.Join(src, dir)
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil, fmt.Errorf("%s: no %s directory", src, dir)
	}
	if err != nil {
		return nil, nil, err
	}
	if !info.IsDir() {
		return nil, []string{path + ": not a directory"}, nil
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, nil, err
	}
	var files []sourceFile
	var problems []string
	for _, e := range entries {
		p := filepath.Join(path, e.Name())
		switch {
		case !e.Type().IsRegular():
			problems = append(problems, p+": not a regular file")
		case filepath.Ext(e.Name()) != ext:
			problems = append(problems, fmt.Sprintf("%s: unexpected file; want *%s", p, ext))
		default:
			files = append(files, sourceFile{path: p, stem: strings.TrimSuffix(e.Name(), ext)})
		}
	}
	return files, problems, nil
}

func writeFile(path string, data []byte) error {
	if info, err := os.Lstat(path); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("%s: refusing to write through a link", path)
	}
	return os.WriteFile(path, data, 0o644)
}

func say(w io.Writer, a ...any) {
	_, _ = fmt.Fprintln(w, a...)
}
