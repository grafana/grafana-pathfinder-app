package achievements

import (
	"maps"
	"slices"
	"strconv"
	"strings"
)

// Two recorder ids of 256 bytes each, with a four-byte length prefix apiece.
const maxUnitIDBytes = 2 * (256 + len("256:"))

type outcome struct {
	decision Decision
	// next is the progress to persist; meaningful only when changed.
	next    Progress
	changed bool
}

// evaluate is the pure step 4 of RFC §6.3: one event against one achievement's
// stored progress.
func evaluate(d *Definition, stored Progress, ev Event) outcome {
	held := heldSet(stored.TierIDs)
	ignored := func(reason Reason) outcome {
		return outcome{decision: d.decision(KindIgnored, reason, nil, held, len(stored.Units))}
	}
	switch {
	case stored.SchemaVersion > SchemaVersion:
		return ignored(ReasonRecordNewer)
	case d.holdsAll(held) && len(stored.Units) >= d.ceiling():
		return ignored(ReasonComplete)
	}

	var units []string
	sawInvalid := false
	if d.Counter != nil {
		for _, m := range d.Counter.Evidence {
			if m.Entity != ev.Entity || m.Action != ev.Action || !conditionsHold(m.Where, ev.Context) {
				continue
			}
			if unit, ok := m.unitID(ev); ok {
				units = append(units, unit)
			} else {
				sawInvalid = true
			}
		}
	}
	routed := d.routedIndex(ev)
	if len(units) == 0 && routed < 0 {
		if sawInvalid {
			return ignored(ReasonInvalidContext)
		}
		return ignored(ReasonConditionNotMet)
	}

	ledger := slices.Clone(stored.Units)
	added := false
	for _, unit := range units {
		i, found := slices.BinarySearch(ledger, unit)
		if !found && len(ledger) < d.ceiling() {
			ledger = slices.Insert(ledger, i, unit)
			added = true
		}
	}
	var awarded []string
	after := maps.Clone(held)
	for i, t := range d.Tiers {
		if !held[t.ID] && (i <= routed || (t.At != nil && *t.At <= len(ledger))) {
			awarded = append(awarded, t.ID)
			after[t.ID] = true
		}
	}

	kind, reason := d.kind(awarded, held, after, added)
	next := stored
	next.TierIDs, next.Units = d.mergeHeld(stored.TierIDs, after), ledger
	return outcome{
		decision: d.decision(kind, reason, awarded, after, len(ledger)),
		next:     next,
		changed:  added || len(awarded) > 0,
	}
}

func (d *Definition) kind(awarded []string, before, after map[string]bool, added bool) (Kind, Reason) {
	switch {
	case len(awarded) > 0 && (!d.holdsAny(before) || d.holdsAll(after)):
		return KindAward, ""
	case len(awarded) > 0:
		return KindTierUp, ""
	case added:
		return KindIncrement, ""
	default:
		return KindIgnored, ReasonDuplicate
	}
}

func (d *Definition) decision(kind Kind, reason Reason, awarded []string, held map[string]bool, units int) Decision {
	if awarded == nil {
		awarded = []string{}
	}
	return Decision{
		AchievementID: d.ID,
		Decision:      kind,
		Reason:        reason,
		Awarded:       awarded,
		Final:         d.holdsAll(held),
		Units:         units,
		Next:          d.nextThreshold(held),
	}
}

func heldSet(ids []string) map[string]bool {
	held := make(map[string]bool, len(ids))
	for _, id := range ids {
		held[id] = true
	}
	return held
}

func (d *Definition) holdsAll(held map[string]bool) bool {
	for _, t := range d.Tiers {
		if !held[t.ID] {
			return false
		}
	}
	return true
}

func (d *Definition) holdsAny(held map[string]bool) bool {
	for _, t := range d.Tiers {
		if held[t.ID] {
			return true
		}
	}
	return false
}

// mergeHeld lists the held tier ids in catalog order, then any the catalog does
// not define in their stored order, so a rollback to an older catalog keeps them.
func (d *Definition) mergeHeld(stored []string, held map[string]bool) []string {
	ids := make([]string, 0, len(held))
	known := make(map[string]bool, len(d.Tiers))
	for _, t := range d.Tiers {
		known[t.ID] = true
		if held[t.ID] {
			ids = append(ids, t.ID)
		}
	}
	for _, id := range stored {
		if !known[id] {
			ids = append(ids, id)
		}
	}
	return ids
}

func (d *Definition) nextThreshold(held map[string]bool) *int {
	for _, t := range d.Tiers {
		if t.At != nil && !held[t.ID] {
			return t.At
		}
	}
	return nil
}

// routedIndex is the position of the last tier whose route the event matches,
// or -1. A route earns its tier and every tier before it.
func (d *Definition) routedIndex(ev Event) int {
	routed := -1
	for i, t := range d.Tiers {
		for _, r := range t.Or {
			if r.Entity == ev.Entity && r.Action == ev.Action && conditionsHold(r.Where, ev.Context) {
				routed = i
			}
		}
	}
	return routed
}

func (m *Matcher) unitID(ev Event) (string, bool) {
	var unit string
	if m.CountBy.occurrence {
		unit = ev.ID
	} else {
		var key strings.Builder
		for _, name := range m.idFields {
			part, ok := scalarString(ev.Context[name])
			if !ok {
				return "", false
			}
			key.WriteString(strconv.Itoa(len(part)))
			key.WriteByte(':')
			key.WriteString(part)
		}
		unit = key.String()
	}
	if unit == "" || len(unit) > maxUnitIDBytes {
		return "", false
	}
	return unit, true
}

func scalarString(v any) (string, bool) {
	switch s := v.(type) {
	case string:
		return s, s != ""
	case bool:
		return strconv.FormatBool(s), true
	default:
		n, ok := toNumber(v)
		return strconv.FormatFloat(n, 'f', -1, 64), ok
	}
}

func conditionsHold(conds []Condition, ctx map[string]any) bool {
	for _, c := range conds {
		v, ok := ctx[c.Field]
		if !ok || !c.holds(v) {
			return false
		}
	}
	return true
}

func (c Condition) holds(v any) bool {
	switch c.Op {
	case opEq:
		return scalarEqual(c.Value, v)
	case opIn:
		list, _ := c.Value.([]any)
		return inList(list, v)
	case opGte, opLte:
		have, ok := toNumber(v)
		want, wok := toNumber(c.Value)
		if !ok || !wok {
			return false
		}
		if c.Op == opGte {
			return have >= want
		}
		return have <= want
	default:
		return false
	}
}
