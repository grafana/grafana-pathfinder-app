package achievements

import (
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
)

const (
	emitterGrafana        = "grafana"
	maxInteractionLen     = 128
	maxPropertyLen        = 64
	maxOwnerLen           = 100
	maxVersionComparators = 4
	maxSourceProperties   = maxContextFields + maxConditions
)

var (
	interactionPattern  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]*$`)
	propertyPattern     = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	pluginIDPattern     = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*$`)
	ownerPattern        = regexp.MustCompile(`^@[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$`)
	comparatorPattern   = regexp.MustCompile(`^(>=|<=|>|<|=)(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$`)
	stackVersionPattern = regexp.MustCompile(`^v?(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})`)
)

// Source is one Echo interaction a registry pair counts (RFC §5.8). Emitter is
// "grafana" or a plugin id. Context is copy-only: each declared field names the
// one event property it takes.
type Source struct {
	Interaction string            `json:"interaction"`
	Emitter     string            `json:"emitter"`
	Versions    string            `json:"versions"`
	When        []SourceCondition `json:"when,omitempty"`
	Context     map[string]string `json:"context,omitempty"`
	Owner       string            `json:"owner"`
	Silent      bool              `json:"silent,omitempty"`

	versions versionRange
}

// SourceCondition picks an interaction's success variants. A property the
// event lacks does not hold.
type SourceCondition struct {
	Property string `json:"property"`
	Op       string `json:"op"`
	Value    any    `json:"value"`
}

// SourceSubscription is the browser's view of a source: Properties are the only ones it may forward.
type SourceSubscription struct {
	Interaction string            `json:"interaction"`
	Properties  []string          `json:"properties"`
	When        []SourceCondition `json:"when,omitempty"`
}

// Stack is the stack the plugin serves. An empty GrafanaVersion is unknown, and
// suffixes are ignored, so a Cloud build such as 13.2.0-12345 is 13.2.0.
type Stack struct {
	GrafanaVersion string
}

type sourceRef struct {
	entity, action string
	source         Source
}

func (s *Source) validate(action Action) []error {
	var errs []error
	fail := func(format string, args ...any) {
		errs = append(errs, fmt.Errorf(format, args...))
	}
	if !validInteraction(s.Interaction) {
		fail("interaction must be an Echo interaction name of at most %d characters matching %s", maxInteractionLen, interactionPattern)
	}
	if s.Emitter != emitterGrafana && (len(s.Emitter) > maxIDLen || !pluginIDPattern.MatchString(s.Emitter)) {
		fail("emitter must be %q or a plugin id", emitterGrafana)
	}
	versions, err := parseVersionRange(s.Versions)
	if err != nil {
		fail("versions %v", err)
	}
	s.versions = versions
	if len(s.Owner) > maxOwnerLen || !ownerPattern.MatchString(s.Owner) {
		fail("owner must be a team handle such as @grafana/dashboards-squad")
	}
	if len(s.When) > maxConditions {
		fail("%d when conditions, at most %d", len(s.When), maxConditions)
	}
	for i, c := range s.When {
		if err := c.validate(); err != nil {
			fail("when %d: %v", i, err)
		}
	}
	for _, field := range sortedKeys(s.Context) {
		if _, ok := action.Context[field]; !ok {
			fail("context field %q is not declared for the pair", field)
		}
		if !validProperty(s.Context[field]) {
			fail("context field %q must name one event property matching %s", field, propertyPattern)
		}
	}
	return errs
}

func (c SourceCondition) validate() error {
	if !validProperty(c.Property) {
		return fmt.Errorf("property must match %s", propertyPattern)
	}
	switch c.Op {
	case opEq:
		if !isScalar(c.Value) {
			return errors.New("eq takes a string, number, or boolean")
		}
	case opIn:
		list, ok := c.Value.([]any)
		if !ok || len(list) < 1 || len(list) > maxInValues || !allScalars(list) {
			return fmt.Errorf("in takes a list of 1 to %d strings, numbers, or booleans", maxInValues)
		}
	default:
		return fmt.Errorf("op %q is not eq or in", c.Op)
	}
	return nil
}

func (c SourceCondition) holds(props map[string]any) bool {
	v, ok := props[c.Property]
	if !ok {
		return false
	}
	if list, isList := c.Value.([]any); isList {
		return inList(list, v)
	}
	return scalarEqual(c.Value, v)
}

func (s *Source) properties() []string {
	var out []string
	for _, p := range s.Context {
		out = append(out, p)
	}
	for _, c := range s.When {
		out = append(out, c.Property)
	}
	slices.Sort(out)
	return slices.Compact(out)
}

// loadSources validates each source on its own, so one bad source never takes its pair down.
func (a *Action) loadSources(pair string, reject func(id string, err error)) {
	a.Sources = nil
	for i, raw := range a.rawSources {
		var src Source
		id := fmt.Sprintf("%s#%d", pair, i)
		if err := decodeStrict(raw, &src); err != nil {
			reject(id, fmt.Errorf("%s: %w", pair, err))
			continue
		}
		if validInteraction(src.Interaction) {
			id = src.Interaction
		}
		if err := errors.Join(src.validate(*a)...); err != nil {
			reject(id, fmt.Errorf("%s: %w", pair, err))
			continue
		}
		a.Sources = append(a.Sources, src)
	}
	a.rawSources = nil
}

// indexSources drops an interaction claimed by several sources everywhere, and
// the sources of a pair that has several but no resource: the old and new names
// of a renamed event must count one unit, not two.
func (r *Registry) indexSources(reject func(id string, err error)) {
	claims := map[string]int{}
	r.eachAction(func(_, _ string, a *Action) {
		for _, src := range a.Sources {
			claims[src.Interaction]++
		}
	})
	r.sources = map[string]sourceRef{}
	r.eachAction(func(entity, name string, a *Action) {
		pair := entity + "." + name
		kept := a.Sources[:0]
		for _, src := range a.Sources {
			if n := claims[src.Interaction]; n > 1 {
				reject(src.Interaction, fmt.Errorf("%s: interaction is declared by %d sources; an interaction maps to one pair", pair, n))
				continue
			}
			kept = append(kept, src)
		}
		a.Sources = kept
		if len(a.Sources) > 1 && len(a.Resources) == 0 {
			for _, src := range a.Sources {
				reject(src.Interaction, fmt.Errorf("%s: %d sources on a pair with no resources; several sources must count by resource so a renamed event never counts twice", pair, len(a.Sources)))
			}
			a.Sources = nil
		}
		for _, src := range a.Sources {
			r.sources[src.Interaction] = sourceRef{entity: entity, action: name, source: src}
		}
	})
}

func (r *Registry) eachAction(f func(entity, name string, a *Action)) {
	for _, entity := range sortedKeys(r.Entities) {
		actions := r.Entities[entity].Actions
		for _, name := range sortedKeys(actions) {
			a := actions[name]
			f(entity, name, &a)
			actions[name] = a
		}
	}
}

// mapSource returns ErrNotCounted for a variant whose when conditions do not hold.
func (r *Registry) mapSource(name string, props map[string]any) (entity, action string, fields map[string]any, err error) {
	fail := func(format string, args ...any) (string, string, map[string]any, error) {
		return "", "", nil, fmt.Errorf("%w: %s", ErrInvalidEvent, fmt.Sprintf(format, args...))
	}
	ref, ok := r.sources[name]
	if !ok {
		return fail("source %q is not declared", name)
	}
	if len(props) > maxSourceProperties {
		return fail("%d properties, at most %d", len(props), maxSourceProperties)
	}
	allowed := ref.source.properties()
	for _, p := range sortedKeys(props) {
		if !slices.Contains(allowed, p) {
			return fail("property %q is not one source %q reads", p, name)
		}
		if !isScalar(props[p]) {
			return fail("property %q is not a string, number, or boolean", p)
		}
	}
	for _, c := range ref.source.When {
		if !c.holds(props) {
			return "", "", nil, ErrNotCounted
		}
	}
	fields = make(map[string]any, len(ref.source.Context))
	for field, p := range ref.source.Context {
		if v, ok := props[p]; ok {
			fields[field] = v
		}
	}
	return ref.entity, ref.action, fields, nil
}

func (r *Registry) Subscriptions(stack Stack) []SourceSubscription {
	out := []SourceSubscription{}
	for _, name := range sortedKeys(r.sources) {
		src := r.sources[name].source
		if !stack.emits(&src) {
			continue
		}
		out = append(out, SourceSubscription{Interaction: name, Properties: src.properties(), When: src.When})
	}
	return out
}

// emittable leaves a pair with no sources to the recorder or to dormancy, as before sources existed.
func (r *Registry) emittable(p Pair, stack Stack) bool {
	a, ok := r.action(p.Entity, p.Action)
	if !ok {
		return false
	}
	return len(a.Sources) == 0 || slices.ContainsFunc(a.Sources, func(src Source) bool { return stack.emits(&src) })
}

// DisplayFor marks an achievement unearnable when every pair it matches has
// sources and the stack emits none of them.
func (s *Snapshot) DisplayFor(stack Stack) []Display {
	out := slices.Clone(s.Display)
	for i := range out {
		if !out[i].Earnable {
			continue
		}
		d := s.Catalog.definition(out[i].ID)
		out[i].Earnable = d != nil && d.anyPair(func(p Pair) bool { return s.Registry.emittable(p, stack) })
	}
	return out
}

func (s Stack) emits(src *Source) bool {
	if src.Emitter != emitterGrafana {
		// TODO(achievements-plugin-versions): read the installed version of
		// src.Emitter. Until then a plugin source counts as emitted on every stack.
		return true
	}
	v, ok := parseStackVersion(s.GrafanaVersion)
	return !ok || src.versions.includes(v)
}

type semver [3]int

type comparator struct {
	op string
	v  semver
}

// versionRange is comparators that must all hold, such as ">=13.2.0 <14.0.0".
type versionRange []comparator

func parseVersionRange(s string) (versionRange, error) {
	parts := strings.Split(s, " ")
	if s == "" || len(parts) > maxVersionComparators {
		return nil, fmt.Errorf(`must be 1 to %d space-separated comparators, such as ">=13.2.0 <14.0.0"`, maxVersionComparators)
	}
	r := make(versionRange, 0, len(parts))
	for _, p := range parts {
		m := comparatorPattern.FindStringSubmatch(p)
		if m == nil {
			return nil, fmt.Errorf("comparator %q is not one of >=, >, <=, <, = and a MAJOR.MINOR.PATCH version", p)
		}
		r = append(r, comparator{op: m[1], v: semver{atoi(m[2]), atoi(m[3]), atoi(m[4])}})
	}
	return r, nil
}

func (r versionRange) includes(v semver) bool {
	for _, c := range r {
		cmp := slices.Compare(v[:], c.v[:])
		var ok bool
		switch c.op {
		case ">=":
			ok = cmp >= 0
		case ">":
			ok = cmp > 0
		case "<=":
			ok = cmp <= 0
		case "<":
			ok = cmp < 0
		default:
			ok = cmp == 0
		}
		if !ok {
			return false
		}
	}
	return true
}

func parseStackVersion(s string) (semver, bool) {
	m := stackVersionPattern.FindStringSubmatch(s)
	if m == nil {
		return semver{}, false
	}
	return semver{atoi(m[1]), atoi(m[2]), atoi(m[3])}, true
}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

func validInteraction(s string) bool {
	return len(s) <= maxInteractionLen && interactionPattern.MatchString(s)
}

func validProperty(s string) bool {
	return len(s) <= maxPropertyLen && propertyPattern.MatchString(s)
}

func isScalar(v any) bool {
	switch v.(type) {
	case string, bool, float64:
		return true
	default:
		return false
	}
}

func allScalars(list []any) bool {
	return !slices.ContainsFunc(list, func(v any) bool { return !isScalar(v) })
}
