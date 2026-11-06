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
	held    map[string]bool
	added   bool
	changed bool
}

// evaluate is the pure step 4 of RFC §6.3: one event against one achievement's
// stored progress.
func evaluate(d *Definition, stored Progress, ev Event) outcome {
	held := heldSet(stored.TierIDs)
	ignored := func(reason Reason) outcome {
		return outcome{decision: d.decision(KindIgnored, reason, held, held, nil, len(stored.Units)), held: held}
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
	routeRank := d.routeRank(ev)
	if len(units) == 0 && routeRank == 0 {
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
		if !held[t.ID] && (i < routeRank || (t.At != nil && *t.At <= len(ledger))) {
			awarded = append(awarded, t.ID)
			after[t.ID] = true
		}
	}

	next := stored
	next.TierIDs, next.Units = slices.Sorted(maps.Keys(after)), ledger
	return outcome{
		decision: d.decision(d.kindFor(held, after, awarded, added), "", held, after, awarded, len(ledger)),
		next:     next,
		held:     held,
		added:    added,
		changed:  added || len(awarded) > 0,
	}
}

func (d *Definition) kindFor(before, after map[string]bool, awarded []string, added bool) Kind {
	switch {
	case len(awarded) > 0 && (d.highest(before) == "" || d.holdsAll(after)):
		return KindAward
	case len(awarded) > 0:
		return KindTierUp
	case added:
		return KindIncrement
	default:
		return KindIgnored
	}
}

func (d *Definition) decision(kind Kind, reason Reason, before, after map[string]bool, awarded []string, units int) Decision {
	if kind == KindIgnored && reason == "" {
		reason = ReasonDuplicate
	}
	return Decision{
		AchievementID: d.ID,
		Decision:      kind,
		Reason:        reason,
		From:          d.highest(before),
		To:            d.highest(after),
		Awarded:       append([]string{}, awarded...),
		Final:         d.holdsAll(after),
		Units:         units,
		Next:          d.nextThreshold(after),
	}
}

func heldSet(ids []string) map[string]bool {
	held := make(map[string]bool, len(ids))
	for _, id := range ids {
		held[id] = true
	}
	return held
}

func (d *Definition) highest(held map[string]bool) string {
	for i := len(d.Tiers) - 1; i >= 0; i-- {
		if held[d.Tiers[i].ID] {
			return d.Tiers[i].ID
		}
	}
	return ""
}

func (d *Definition) holdsAll(held map[string]bool) bool {
	for _, t := range d.Tiers {
		if !held[t.ID] {
			return false
		}
	}
	return true
}

func (d *Definition) nextThreshold(held map[string]bool) *int {
	if d.Counter == nil {
		return nil
	}
	for _, t := range d.Tiers {
		if !held[t.ID] {
			return t.At
		}
	}
	return nil
}

// Counting continues past the final tier up to this limit, so a tier appended
// later lands for counts that already meet it.
func (d *Definition) ceiling() int {
	switch {
	case d.Counter == nil:
		return 0
	case d.Counter.Unit == unitOccurrence:
		return maxOccurrenceAt
	default:
		return maxThreshold
	}
}

// routeRank is 1 + the rank of the highest tier whose route matches, 0 for none.
func (d *Definition) routeRank(ev Event) int {
	rank := 0
	for i, t := range d.Tiers {
		for _, r := range t.Or {
			if r.Entity == ev.Entity && r.Action == ev.Action && conditionsHold(r.Where, ev.Context) {
				rank = i + 1
			}
		}
	}
	return rank
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
