package achievements

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
)

// FormatVersion is the catalog format this build reads, fetched from
// DefinitionsPath. The publisher builds one file per format version from one
// source catalog and leaves out of each file any achievement that version
// cannot express, so a definition this build cannot read is a publisher bug
// and is skipped as invalid. A file's envelope names its format as Grammar.
const (
	FormatVersion   = "v1"
	Grammar         = "1.0"
	DefinitionsPath = "achievements/" + FormatVersion + "/definitions.json"

	MaxBundleBytes = 1 << 20
	maxDefinitions = 200
	maxListedSkips = 200
)

type SkipReason string

const SkipInvalid SkipReason = "invalid"

// Skip names an entry LoadBundle left out: an "entity", an "action" (ID is
// entity.action), an "art" key or an "achievement". Past maxListedSkips, one
// "bundle" entry counts the rest.
type Skip struct {
	What   string     `json:"what"`
	ID     string     `json:"id"`
	Reason SkipReason `json:"reason"`
	Detail string     `json:"detail"`
}

// Display is what a definition shows, kept even when this build cannot
// evaluate it, so a definition skipped as invalid still has a name for awards
// already earned.
type Display struct {
	ID          string        `json:"id"`
	Title       string        `json:"title"`
	Description string        `json:"description"`
	Tiers       []DisplayTier `json:"tiers"`
	Earnable    bool          `json:"earnable"`
}

type DisplayTier struct {
	ID  string `json:"id"`
	At  *int   `json:"at,omitempty"`
	Art string `json:"art,omitempty"`
}

// Snapshot is one published bundle as this build reads it.
type Snapshot struct {
	// Version identifies the bundle bytes.
	Version  string
	Grammar  string
	Registry *Registry
	// Catalog holds only the definitions this build can evaluate.
	Catalog *Catalog
	Display []Display
	Art     []string
	Skipped []Skip

	unlisted int
}

type envelope struct {
	Grammar  string `json:"grammar"`
	Registry struct {
		Entities map[string]json.RawMessage `json:"entities"`
	} `json:"registry"`
	Catalog struct {
		Achievements []json.RawMessage `json:"achievements"`
	} `json:"catalog"`
	Art []json.RawMessage `json:"art"`
}

// LoadBundle reads a published bundle. The envelope and each registry action's
// top level are lenient, so additive keys need no grammar change; fields,
// resources and definitions are decoded strictly, and each entry is validated
// on its own. An entry this build cannot read is skipped with a reason and
// everything else stays live. Only an unreadable envelope or a grammar other
// than Grammar fails the whole bundle.
func LoadBundle(data []byte) (*Snapshot, error) {
	if len(data) > MaxBundleBytes {
		return nil, fmt.Errorf("bundle: %d bytes, at most %d", len(data), MaxBundleBytes)
	}
	var env envelope
	if err := json.Unmarshal(data, &env); err != nil {
		return nil, fmt.Errorf("bundle: %w", err)
	}
	if env.Grammar != Grammar {
		return nil, fmt.Errorf("bundle: grammar %q is not %s, the format this build reads", env.Grammar, Grammar)
	}

	sum := sha256.Sum256(data)
	s := &Snapshot{
		Version:  hex.EncodeToString(sum[:8]),
		Grammar:  env.Grammar,
		Registry: &Registry{Entities: map[string]Entity{}},
		Catalog:  &Catalog{Achievements: []Definition{}},
		Display:  []Display{},
		Art:      []string{},
		Skipped:  []Skip{},
	}
	for _, entity := range sortedKeys(env.Registry.Entities) {
		s.addEntity(entity, env.Registry.Entities[entity])
	}
	for i, raw := range env.Art {
		var key string
		if json.Unmarshal(raw, &key) != nil || !validID(key, maxIDLen) {
			s.skip("art", fmt.Sprintf("#%d", i), SkipInvalid, fmt.Errorf("art key must be a lowercase key of at most %d characters", maxIDLen))
			continue
		}
		s.Art = append(s.Art, key)
	}
	seen := map[string]bool{}
	for i, raw := range env.Catalog.Achievements {
		s.addDefinition(i, raw, seen)
	}
	if s.unlisted > 0 {
		s.Skipped = append(s.Skipped, Skip{What: "bundle", Reason: SkipInvalid, Detail: fmt.Sprintf("%d more skipped entries not listed", s.unlisted)})
	}
	return s, nil
}

func (s *Snapshot) addEntity(entity string, raw json.RawMessage) {
	var e struct {
		Actions map[string]json.RawMessage `json:"actions"`
	}
	if !validToken(entity) {
		s.skip("entity", entity, SkipInvalid, fmt.Errorf("entity must be a lowercase token of at most %d characters", maxTokenLen))
		return
	}
	if err := json.Unmarshal(raw, &e); err != nil {
		s.skip("entity", entity, SkipInvalid, err)
		return
	}
	for _, name := range sortedKeys(e.Actions) {
		action, err := loadAction(entity, name, e.Actions[name])
		if err != nil {
			s.skip("action", entity+"."+name, SkipInvalid, err)
			continue
		}
		loaded, ok := s.Registry.Entities[entity]
		if !ok {
			loaded = Entity{Actions: map[string]Action{}}
			s.Registry.Entities[entity] = loaded
		}
		loaded.Actions[name] = action
	}
}

func loadAction(entity, name string, raw json.RawMessage) (Action, error) {
	if !validToken(name) {
		return Action{}, fmt.Errorf("action must be a lowercase token of at most %d characters", maxTokenLen)
	}
	if string(bytes.TrimSpace(raw)) == "null" {
		return Action{}, errors.New("action is null")
	}
	var a Action
	if err := decodeStrict(raw, &a); err != nil {
		return Action{}, err
	}
	return a, errors.Join(a.validate("registry: " + entity + "." + name)...)
}

func (s *Snapshot) addDefinition(i int, raw json.RawMessage, seen map[string]bool) {
	var head struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &head); err != nil || head.ID == "" {
		s.skip("achievement", fmt.Sprintf("#%d", i), SkipInvalid, errors.New("not an object with a string id"))
		return
	}
	if seen[head.ID] {
		s.skip("achievement", head.ID, SkipInvalid, errors.New("id declared more than once; only the first entry is read"))
		return
	}
	seen[head.ID] = true
	display, displayable := decodeDisplay(raw)
	reject := func(reason SkipReason, err error) {
		s.skip("achievement", head.ID, reason, err)
		if displayable {
			s.Display = append(s.Display, display)
		}
	}

	if len(s.Catalog.Achievements) >= maxDefinitions {
		reject(SkipInvalid, fmt.Errorf("over the cap of %d evaluable definitions", maxDefinitions))
		return
	}
	var d Definition
	if err := decodeStrict(raw, &d); err != nil {
		reject(SkipInvalid, err)
		return
	}
	if err := errors.Join(d.validate(s.Registry)...); err != nil {
		reject(SkipInvalid, err)
		return
	}
	s.Catalog.Achievements = append(s.Catalog.Achievements, d)
	display.Earnable = true
	s.Display = append(s.Display, display)
}

func (s *Snapshot) skip(what, id string, reason SkipReason, err error) {
	if len(s.Skipped) >= maxListedSkips {
		s.unlisted++
		return
	}
	s.Skipped = append(s.Skipped, Skip{What: what, ID: id, Reason: reason, Detail: err.Error()})
}

func decodeDisplay(raw json.RawMessage) (Display, bool) {
	var d Display
	if json.Unmarshal(raw, &d) != nil || !validID(d.ID, maxIDLen) ||
		checkText(d.Title, maxTitleRunes) != nil || checkText(d.Description, maxDescRunes) != nil {
		return Display{}, false
	}
	for _, t := range d.Tiers {
		if !validID(t.ID, maxTierIDLen) || (t.Art != "" && !validID(t.Art, maxIDLen)) {
			return Display{}, false
		}
	}
	d.Earnable = false
	if d.Tiers == nil {
		d.Tiers = []DisplayTier{}
	}
	return d, true
}

func validID(s string, limit int) bool {
	return len(s) <= limit && idPattern.MatchString(s)
}
