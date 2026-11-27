package achievements

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"unicode"
	"unicode/utf8"
)

const (
	maxTiers          = 10
	maxGoal           = 200
	maxOccurrenceGoal = 50
	maxRules          = 16
	maxConditions     = 8
	maxInValues       = 16
	maxIDLen          = 64
	maxTierIDLen      = 32
	maxTitleRunes     = 80
	maxDescRunes      = 280
	unitOccurrence    = "occurrence"
	countByResource   = "resource"
	countByOccurrence = "occurrence"
	opEq, opIn        = "eq", "in"
	opGte, opLte      = "gte", "lte"
)

// maxUnits is the most units a progress row's ledger holds, so the goals of an
// achievement's tiers add up to at most this; compat keeps published goals from
// going down, which keeps that bound across catalog versions.
const maxUnits = maxGoal

var idPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

type Pair struct {
	Entity string
	Action string
}

// Catalog is the closed-grammar list of achievement definitions (RFC §6.2, with
// the departures in docs/design/ACHIEVEMENTS_RFC_DEPARTURES.md).
type Catalog struct {
	Achievements []Definition `json:"achievements"`
}

// Definition is earned one tier at a time, lowest first.
type Definition struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Tiers       []Tier `json:"tiers"`
}

// Tier is earned by reaching Goal points from its own Rules, counted only while
// it is the lowest tier not held. ID is permanent: a released tier is never
// renamed, removed or moved. Art is an optional, explicitly authored key naming
// the image published at achievements/art/<key>.svg on the interactive-learning
// CDN; never a URL or a path.
type Tier struct {
	ID    string `json:"id"`
	Goal  int    `json:"goal"`
	Rules []Rule `json:"rules"`
	Art   string `json:"art,omitempty"`
}

// Rule scores Worth points, 1 when unset, for an event that matches it and
// brings a unit the achievement has not counted.
type Rule struct {
	Entity  string      `json:"entity"`
	Action  string      `json:"action"`
	CountBy CountBy     `json:"countBy"`
	Where   []Condition `json:"where,omitempty"`
	Worth   *int        `json:"worth,omitempty"`

	unit     string
	idFields []string
}

func (r *Rule) worth() int {
	if r.Worth == nil {
		return 1
	}
	return *r.Worth
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

// loadCatalog parses a whole catalog strictly and rejects it on any problem,
// including an earn window. Published bundles go through LoadBundle instead.
func loadCatalog(data []byte, registry *Registry) (*Catalog, error) {
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
	if err := checkText(d.Title, maxTitleRunes); err != nil {
		fail("title %v", err)
	}
	if err := checkText(d.Description, maxDescRunes); err != nil {
		fail("description %v", err)
	}
	if len(d.Tiers) == 0 || len(d.Tiers) > maxTiers {
		fail("needs 1 to %d tiers, got %d", maxTiers, len(d.Tiers))
	}

	total := 0
	tierIDs := map[string]bool{}
	for i := range d.Tiers {
		t := &d.Tiers[i]
		tw := fmt.Sprintf("tier %d", i+1)
		if t.ID != "" {
			tw = fmt.Sprintf("tier %q", t.ID)
		}
		if len(t.ID) > maxTierIDLen || !idPattern.MatchString(t.ID) {
			fail("%s: id must be a lowercase token of at most %d characters", tw, maxTierIDLen)
		}
		if tierIDs[t.ID] {
			fail("%s: tier id declared twice", tw)
		}
		tierIDs[t.ID] = true
		if t.Art != "" && (len(t.Art) > maxIDLen || !idPattern.MatchString(t.Art)) {
			fail("%s: art must be a lowercase key of at most %d characters", tw, maxIDLen)
		}
		errs = append(errs, t.validate(where+": "+tw, registry)...)
		total += t.Goal
	}
	if total > maxUnits {
		fail("the tiers' goals add up to %d, at most %d", total, maxUnits)
	}
	return errs
}

// checkText rejects characters that could break, reorder or hide displayed
// text. ZWNJ and ZWJ are the allowed Cf characters: Persian, Indic and emoji
// sequences need them.
func checkText(s string, maxRunes int) error {
	switch {
	case s == "":
		return errors.New("is required")
	case utf8.RuneCountInString(s) > maxRunes:
		return fmt.Errorf("is over %d characters", maxRunes)
	}
	for _, r := range s {
		if unicode.IsControl(r) || r == '\u2028' || r == '\u2029' ||
			(unicode.Is(unicode.Cf, r) && r != '\u200c' && r != '\u200d') {
			return fmt.Errorf("contains the control, format or separator character %U", r)
		}
	}
	return nil
}

func (t *Tier) validate(where string, registry *Registry) []error {
	var errs []error
	if len(t.Rules) == 0 || len(t.Rules) > maxRules {
		errs = append(errs, fmt.Errorf("%s: needs 1 to %d rules, got %d", where, maxRules, len(t.Rules)))
	}
	limit := maxGoal
	units := map[Pair]string{}
	for i := range t.Rules {
		r := &t.Rules[i]
		rw := fmt.Sprintf("%s: rule %d", where, i+1)
		ruleErrs := r.validate(rw, registry)
		errs = append(errs, ruleErrs...)
		if len(ruleErrs) > 0 {
			continue
		}
		if r.unit == unitOccurrence {
			limit = maxOccurrenceGoal
		}
		// One event is one item, so every rule it can match must agree on what it counts.
		pair := Pair{r.Entity, r.Action}
		if unit, ok := units[pair]; ok && unit != r.unit {
			errs = append(errs, fmt.Errorf("%s: counts unit %q but another rule on %s.%s counts %q", rw, r.unit, r.Entity, r.Action, unit))
		}
		units[pair] = r.unit
	}
	goalValid := t.Goal >= 1 && t.Goal <= limit
	if !goalValid {
		errs = append(errs, fmt.Errorf("%s: goal must be 1 to %d, got %d", where, limit, t.Goal))
	}
	for i := range t.Rules {
		w := t.Rules[i].worth()
		switch {
		case w < 1:
			errs = append(errs, fmt.Errorf("%s: rule %d: worth must be at least 1, got %d", where, i+1, w))
		case goalValid && w > t.Goal:
			errs = append(errs, fmt.Errorf("%s: rule %d: worth %d is over the tier's goal of %d", where, i+1, w, t.Goal))
		}
	}
	return errs
}

func (r *Rule) validate(where string, registry *Registry) []error {
	action, ok := registry.action(r.Entity, r.Action)
	if !ok {
		return []error{fmt.Errorf("%s: %s.%s is not declared in the registry", where, r.Entity, r.Action)}
	}
	errs := validateConditions(where, r.Where, action)
	switch {
	case !r.CountBy.set:
		errs = append(errs, fmt.Errorf("%s: countBy is required", where))
	case r.CountBy.occurrence:
		r.unit = unitOccurrence
		if len(action.Sources) > 1 {
			errs = append(errs, fmt.Errorf("%s: %s.%s has %d sources, so count it by resource; by occurrence a renamed event counts twice", where, r.Entity, r.Action, len(action.Sources)))
		}
	case r.CountBy.resource == "":
		if len(action.Resources) == 0 {
			return append(errs, fmt.Errorf(`%s: countBy "resource" on %s.%s, which declares no resources`, where, r.Entity, r.Action))
		}
		r.unit, r.idFields = action.Resources[0].Unit, action.Resources[0].ID
	default:
		for _, res := range action.Resources {
			if res.Unit == r.CountBy.resource {
				r.unit, r.idFields = res.Unit, res.ID
			}
		}
		if r.unit == "" {
			errs = append(errs, fmt.Errorf("%s: %s.%s declares no resource %q", where, r.Entity, r.Action, r.CountBy.resource))
		}
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

// Dormant lists the achievements whose first tier has no rule on a pair something emits.
func (c *Catalog) Dormant(emitted []Pair) []string {
	live := map[Pair]bool{}
	for _, p := range emitted {
		live[p] = true
	}
	var ids []string
	for i := range c.Achievements {
		d := &c.Achievements[i]
		if !d.firstTierHasPair(func(p Pair) bool { return live[p] }) {
			ids = append(ids, d.ID)
		}
	}
	return ids
}

func (d *Definition) anyPair(f func(Pair) bool) bool {
	for _, t := range d.Tiers {
		if t.anyPair(f) {
			return true
		}
	}
	return false
}

func (d *Definition) firstTierHasPair(f func(Pair) bool) bool {
	return len(d.Tiers) > 0 && d.Tiers[0].anyPair(f)
}

func (t *Tier) anyPair(f func(Pair) bool) bool {
	for _, r := range t.Rules {
		if f(Pair{r.Entity, r.Action}) {
			return true
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
