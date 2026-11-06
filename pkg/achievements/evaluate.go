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
	next Progress
	// awarded is in rank order, so its last entry is the decision's To.
	awarded []string
	changed bool
}

// evaluate is the pure step 4 of RFC §6.3: one event against one achievement's
// stored progress.
func evaluate(d *Definition, stored Progress, ev Event) outcome {
	held, known := d.held(stored.TierIDs)
	from := d.highest(held)
	ignored := func(reason Reason) outcome {
		return outcome{decision: d.decision(KindIgnored, reason, held, from, from, len(stored.Units))}
	}
	switch {
	case stored.SchemaVersion > SchemaVersion, !known:
		return ignored(ReasonRecordNewer)
	case d.complete(held, len(stored.Units)):
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
	if len(units) == 0 && routeRank < 0 {
		if sawInvalid {
			return ignored(ReasonInvalidContext)
		}
		return ignored(ReasonConditionNotMet)
	}

	ledger := slices.Clone(stored.Units)
	added := false
	for _, unit := range units {
		i, found := slices.BinarySearch(ledger, unit)
		if !found && len(ledger) < d.unitCeiling() {
			ledger = slices.Insert(ledger, i, unit)
			added = true
		}
	}

	var awarded []string
	after := maps.Clone(held)
	for i, t := range d.Tiers {
		if !held[t.ID] && (i <= routeRank || (t.At != nil && *t.At <= len(ledger))) {
			awarded = append(awarded, t.ID)
			after[t.ID] = true
		}
	}

	to := from
	kind, reason := KindIgnored, ReasonDuplicate
	switch {
	case len(awarded) > 0:
		to = awarded[len(awarded)-1]
		kind = KindTierUp
		if len(held) == 0 || len(after) == len(d.Tiers) {
			kind = KindAward
		}
		reason = ""
	case added:
		kind, reason = KindIncrement, ""
	}
	next := stored
	next.TierIDs, next.Units = d.ranked(after), ledger
	return outcome{
		decision: d.decision(kind, reason, after, from, to, len(ledger)),
		next:     next,
		awarded:  awarded,
		changed:  added || len(awarded) > 0,
	}
}

func (d *Definition) decision(kind Kind, reason Reason, held map[string]bool, from, to string, units int) Decision {
	return Decision{
		AchievementID: d.ID,
		Decision:      kind,
		Reason:        reason,
		From:          from,
		To:            to,
		Final:         len(held) == len(d.Tiers),
		Units:         units,
		Next:          d.nextThreshold(held),
	}
}

// known is false for a tier id this catalog lacks, as after a rollback.
func (d *Definition) held(tierIDs []string) (set map[string]bool, known bool) {
	set = make(map[string]bool, len(tierIDs))
	known = true
	for _, id := range tierIDs {
		if d.tierRank(id) < 0 {
			known = false
			continue
		}
		set[id] = true
	}
	return set, known
}

func (d *Definition) tierRank(id string) int {
	return slices.IndexFunc(d.Tiers, func(t Tier) bool { return t.ID == id })
}

func (d *Definition) highest(held map[string]bool) string {
	for i := len(d.Tiers) - 1; i >= 0; i-- {
		if held[d.Tiers[i].ID] {
			return d.Tiers[i].ID
		}
	}
	return ""
}

func (d *Definition) ranked(held map[string]bool) []string {
	ids := make([]string, 0, len(held))
	for _, t := range d.Tiers {
		if held[t.ID] {
			ids = append(ids, t.ID)
		}
	}
	return ids
}

// Counting continues past the final tier, so a tier appended later lands on
// the next qualifying event.
func (d *Definition) complete(held map[string]bool, units int) bool {
	return len(held) == len(d.Tiers) && units >= d.unitCeiling()
}

func (d *Definition) unitCeiling() int {
	switch {
	case d.Counter == nil:
		return 0
	case d.Counter.Unit == unitOccurrence:
		return maxOccurrenceAt
	default:
		return maxThreshold
	}
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

// routeRank is -1 when no route matches.
func (d *Definition) routeRank(ev Event) int {
	rank := -1
	for i, t := range d.Tiers {
		for _, r := range t.Or {
			if r.Entity == ev.Entity && r.Action == ev.Action && conditionsHold(r.Where, ev.Context) {
				rank = i
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
