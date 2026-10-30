package achievements

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
)

const (
	maxTiers          = 10
	maxThreshold      = 200
	maxOccurrenceAt   = 50
	maxEvidence       = 16
	maxConditions     = 8
	maxRoutes         = 5
	maxInValues       = 16
	maxIDLen          = 64
	unitOccurrence    = "occurrence"
	actionCompleted   = "completed"
	countByResource   = "resource"
	countByOccurrence = "occurrence"
	opEq, opIn        = "eq", "in"
	opGte, opLte      = "gte", "lte"
)

var idPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

type Pair struct {
	Entity string
	Action string
}

// Catalog is the closed-grammar list of achievement definitions (RFC §6.2).
type Catalog struct {
	SchemaVersion int          `json:"schemaVersion"`
	Achievements  []Definition `json:"achievements"`
}

// Definition with a Counter counts distinct units toward tiers with an At
// threshold. Without one it is a milestone: each tier is earned by an Or route.
type Definition struct {
	ID          string   `json:"id"`
	Revision    int      `json:"revision"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Counter     *Counter `json:"counter,omitempty"`
	Tiers       []Tier   `json:"tiers"`
}

type Counter struct {
	Unit     string    `json:"unit"`
	Evidence []Matcher `json:"evidence"`
}

type Matcher struct {
	Entity  string      `json:"entity"`
	Action  string      `json:"action"`
	CountBy CountBy     `json:"countBy"`
	Where   []Condition `json:"where,omitempty"`

	idFields []string
}

// Tier is earned by reaching At distinct units, or outright by an event that
// matches one of its Or routes. Art is an opaque display reference.
type Tier struct {
	Tier int     `json:"tier"`
	At   *int    `json:"at,omitempty"`
	Art  string  `json:"art,omitempty"`
	Or   []Route `json:"or,omitempty"`
}

type Route struct {
	Entity string      `json:"entity"`
	Action string      `json:"action"`
	Where  []Condition `json:"where,omitempty"`
}

type Condition struct {
	Field string `json:"field"`
	Op    string `json:"op"`
	Value any    `json:"value"`
}

// CountBy is `"resource"`, `"occurrence"`, or `{"resource": "<unit>"}`.
type CountBy struct {
	occurrence bool
	// resource is the named unit; empty selects the pair's default resource.
	resource string
	set      bool
}

func (c *CountBy) UnmarshalJSON(data []byte) error {
	var s string
	if json.Unmarshal(data, &s) == nil {
		switch s {
		case countByResource:
			*c = CountBy{set: true}
		case countByOccurrence:
			*c = CountBy{set: true, occurrence: true}
		default:
			return fmt.Errorf("countBy %q is not %q or %q", s, countByResource, countByOccurrence)
		}
		return nil
	}
	var obj struct {
		Resource string `json:"resource"`
	}
	if err := decodeStrict(data, &obj); err != nil || obj.Resource == "" {
		return errors.New(`countBy must be "resource", "occurrence", or {"resource": "<unit>"}`)
	}
	*c = CountBy{set: true, resource: obj.Resource}
	return nil
}

func (c CountBy) MarshalJSON() ([]byte, error) {
	switch {
	case !c.set:
		return []byte("null"), nil
	case c.occurrence:
		return json.Marshal(countByOccurrence)
	case c.resource != "":
		return json.Marshal(map[string]string{"resource": c.resource})
	default:
		return json.Marshal(countByResource)
	}
}

// LoadCatalog parses a catalog and validates it against the registry. A
// definition that uses anything outside the §6.2 grammar, including an earn
// window, is rejected.
func LoadCatalog(data []byte, registry *Registry) (*Catalog, error) {
	var c Catalog
	if err := decodeStrict(data, &c); err != nil {
		return nil, fmt.Errorf("catalog: %w", err)
	}
	if err := c.validate(registry); err != nil {
		return nil, err
	}
	return &c, nil
}

func (c *Catalog) validate(registry *Registry) error {
	if c.SchemaVersion != SchemaVersion {
		return fmt.Errorf("catalog: schemaVersion must be %d, got %d", SchemaVersion, c.SchemaVersion)
	}
	var errs []error
	seen := map[string]bool{}
	for i := range c.Achievements {
		d := &c.Achievements[i]
		if seen[d.ID] {
			errs = append(errs, fmt.Errorf("catalog: achievement id %q declared twice", d.ID))
		}
		seen[d.ID] = true
		errs = append(errs, d.validate(registry)...)
	}
	return errors.Join(errs...)
}

func (d *Definition) validate(registry *Registry) []error {
	where := fmt.Sprintf("catalog: achievement %q", d.ID)
	var errs []error
	fail := func(format string, args ...any) {
		errs = append(errs, fmt.Errorf(where+": "+format, args...))
	}
	if len(d.ID) > maxIDLen || !idPattern.MatchString(d.ID) {
		fail("id must be a lowercase token of at most %d characters", maxIDLen)
	}
	if d.Revision < 1 {
		fail("revision must be at least 1")
	}
	if d.Title == "" || d.Description == "" {
		fail("title and description are required")
	}
	if len(d.Tiers) == 0 || len(d.Tiers) > maxTiers {
		fail("needs 1 to %d tiers, got %d", maxTiers, len(d.Tiers))
	}

	occurrence := false
	if d.Counter != nil {
		errs = append(errs, d.Counter.validate(where, registry)...)
		occurrence = d.Counter.Unit == unitOccurrence
	}
	prev := 0
	for i, t := range d.Tiers {
		tw := fmt.Sprintf("tier %d", i+1)
		if t.Tier != i+1 {
			fail("%s: tier numbers must run 1, 2, 3, ... in order, got %d", tw, t.Tier)
		}
		switch {
		case d.Counter == nil && t.At != nil:
			fail("%s: at is forbidden on a milestone achievement", tw)
		case d.Counter != nil && t.At == nil:
			fail("%s: at is required on a counted achievement", tw)
		case t.At != nil:
			limit := maxThreshold
			if occurrence {
				limit = maxOccurrenceAt
			}
			if *t.At < 1 || *t.At > limit {
				fail("%s: at must be 1 to %d, got %d", tw, limit, *t.At)
			}
			if *t.At <= prev {
				fail("%s: at must be strictly greater than the previous tier's %d", tw, prev)
			}
			prev = *t.At
		}
		if d.Counter == nil && len(t.Or) == 0 {
			fail("%s: a milestone tier needs at least one route", tw)
		}
		if len(t.Or) > maxRoutes {
			fail("%s: %d routes, at most %d", tw, len(t.Or), maxRoutes)
		}
		for j, r := range t.Or {
			errs = append(errs, r.validate(fmt.Sprintf("%s: %s route %d", where, tw, j), registry)...)
		}
	}
	return errs
}

func (c *Counter) validate(where string, registry *Registry) []error {
	var errs []error
	if !validToken(c.Unit) {
		errs = append(errs, fmt.Errorf("%s: counter unit %q is not a lowercase token of at most %d characters", where, c.Unit, maxTokenLen))
	}
	if len(c.Evidence) == 0 || len(c.Evidence) > maxEvidence {
		errs = append(errs, fmt.Errorf("%s: counter needs 1 to %d evidence matchers, got %d", where, maxEvidence, len(c.Evidence)))
	}
	for i := range c.Evidence {
		errs = append(errs, c.Evidence[i].validate(fmt.Sprintf("%s: evidence %d", where, i), c.Unit, registry)...)
	}
	return errs
}

func (m *Matcher) validate(where, counterUnit string, registry *Registry) []error {
	action, ok := registry.action(m.Entity, m.Action)
	if !ok {
		return []error{fmt.Errorf("%s: %s.%s is not declared in the registry", where, m.Entity, m.Action)}
	}
	errs := validateConditions(where, m.Where, action)
	if !m.CountBy.set {
		return append(errs, fmt.Errorf("%s: countBy is required", where))
	}

	unit := ""
	switch {
	case m.CountBy.occurrence:
		unit = unitOccurrence
	case m.CountBy.resource == "":
		if len(action.Resources) == 0 {
			return append(errs, fmt.Errorf(`%s: countBy "resource" on %s.%s, which declares no resources`, where, m.Entity, m.Action))
		}
		unit, m.idFields = action.Resources[0].Unit, action.Resources[0].ID
	default:
		for _, res := range action.Resources {
			if res.Unit == m.CountBy.resource {
				unit, m.idFields = res.Unit, res.ID
			}
		}
		if unit == "" {
			return append(errs, fmt.Errorf("%s: %s.%s declares no resource %q", where, m.Entity, m.Action, m.CountBy.resource))
		}
	}
	if unit != counterUnit {
		errs = append(errs, fmt.Errorf("%s: counts unit %q but the counter's unit is %q", where, unit, counterUnit))
	}
	return errs
}

func (r *Route) validate(where string, registry *Registry) []error {
	action, ok := registry.action(r.Entity, r.Action)
	if !ok {
		return []error{fmt.Errorf("%s: %s.%s is not declared in the registry", where, r.Entity, r.Action)}
	}
	errs := validateConditions(where, r.Where, action)
	if r.Action != actionCompleted {
		errs = append(errs, fmt.Errorf("%s: routes take action %q only, got %q", where, actionCompleted, r.Action))
	}
	return errs
}

func validateConditions(where string, conds []Condition, action Action) []error {
	var errs []error
	if len(conds) > maxConditions {
		errs = append(errs, fmt.Errorf("%s: %d conditions, at most %d", where, len(conds), maxConditions))
	}
	for i, c := range conds {
		cw := fmt.Sprintf("%s: condition %d", where, i)
		field, ok := action.Context[c.Field]
		if !ok {
			errs = append(errs, fmt.Errorf("%s: field %q is not declared for the pair", cw, c.Field))
			continue
		}
		errs = append(errs, c.validateValue(cw, field)...)
	}
	return errs
}

func (c Condition) validateValue(where string, field Field) []error {
	checkScalar := func(v any) error {
		if !field.Type.accepts(v) {
			return fmt.Errorf("%s: value %v is not a %s", where, v, field.Type)
		}
		if len(field.Enum) > 0 && !inList(field.Enum, v) {
			return fmt.Errorf("%s: value %v is outside the field's enum", where, v)
		}
		return nil
	}
	switch c.Op {
	case opEq:
		if err := checkScalar(c.Value); err != nil {
			return []error{err}
		}
	case opIn:
		list, ok := c.Value.([]any)
		if !ok || len(list) < 1 || len(list) > maxInValues {
			return []error{fmt.Errorf("%s: in takes a list of 1 to %d scalars", where, maxInValues)}
		}
		var errs []error
		for _, v := range list {
			if err := checkScalar(v); err != nil {
				errs = append(errs, err)
			}
		}
		return errs
	case opGte, opLte:
		if field.Type != FieldNumber {
			return []error{fmt.Errorf("%s: %s needs a number field, %q is a %s", where, c.Op, c.Field, field.Type)}
		}
		if err := checkScalar(c.Value); err != nil {
			return []error{err}
		}
	default:
		return []error{fmt.Errorf("%s: op %q is not eq, in, gte, or lte", where, c.Op)}
	}
	return nil
}

// Dormant lists the achievements whose every matcher, counter evidence and
// routes alike, is on a pair that nothing emits.
func (c *Catalog) Dormant(emitted []Pair) []string {
	live := map[Pair]bool{}
	for _, p := range emitted {
		live[p] = true
	}
	var ids []string
	for i := range c.Achievements {
		d := &c.Achievements[i]
		if !d.anyPair(func(p Pair) bool { return live[p] }) {
			ids = append(ids, d.ID)
		}
	}
	return ids
}

func (d *Definition) anyPair(f func(Pair) bool) bool {
	if d.Counter != nil {
		for _, m := range d.Counter.Evidence {
			if f(Pair{m.Entity, m.Action}) {
				return true
			}
		}
	}
	for _, t := range d.Tiers {
		for _, r := range t.Or {
			if f(Pair{r.Entity, r.Action}) {
				return true
			}
		}
	}
	return false
}

func inList(list []any, v any) bool {
	for _, e := range list {
		if scalarEqual(e, v) {
			return true
		}
	}
	return false
}

func scalarEqual(a, b any) bool {
	switch x := a.(type) {
	case string:
		y, ok := b.(string)
		return ok && x == y
	case bool:
		y, ok := b.(bool)
		return ok && x == y
	default:
		xn, okx := toNumber(a)
		yn, oky := toNumber(b)
		return okx && oky && xn == yn
	}
}
