package achievements

import (
	"slices"
	"strconv"
	"strings"
)

const maxUnitIDBytes = 128

type outcome struct {
	decision Decision
	// next is the progress to persist; meaningful only when changed.
	next    Progress
	changed bool
}

// evaluate is the pure step 4 of RFC §6.3: one event against one achievement's
// stored progress.
func evaluate(d *Definition, stored Progress, ev Event) outcome {
	ignored := func(reason Reason) outcome {
		return outcome{decision: d.decision(KindIgnored, reason, stored.Tier, stored.Tier, len(stored.Units), stored.Revision)}
	}
	last := len(d.Tiers)
	switch {
	case stored.SchemaVersion > SchemaVersion:
		return ignored(ReasonRecordNewer)
	case stored.Tier >= last:
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
	routeTier := d.routeTier(ev)
	if len(units) == 0 && routeTier == 0 {
		if sawInvalid {
			return ignored(ReasonInvalidContext)
		}
		return ignored(ReasonConditionNotMet)
	}

	ledger := slices.Clone(stored.Units)
	added := false
	for _, unit := range units {
		i, found := slices.BinarySearch(ledger, unit)
		if !found && len(ledger) < d.topThreshold() {
			ledger = slices.Insert(ledger, i, unit)
			added = true
		}
	}
	tier := max(stored.Tier, d.tierForCount(len(ledger)), routeTier)
	revision := max(stored.Revision, d.Revision)
	earned := tier > stored.Tier

	kind, reason := KindIgnored, ReasonDuplicate
	switch {
	case earned && (stored.Tier == 0 || tier == last):
		kind, reason = KindAward, ""
	case earned:
		kind, reason = KindTierUp, ""
	case added:
		kind, reason = KindIncrement, ""
	}
	next := stored
	next.Tier, next.Units, next.Revision = tier, ledger, revision
	return outcome{
		decision: d.decision(kind, reason, stored.Tier, tier, len(ledger), revision),
		next:     next,
		changed:  added || earned || revision != stored.Revision,
	}
}

func (d *Definition) decision(kind Kind, reason Reason, from, to, units, revision int) Decision {
	return Decision{
		AchievementID: d.ID,
		Decision:      kind,
		Reason:        reason,
		From:          from,
		To:            to,
		Final:         to >= len(d.Tiers),
		Units:         units,
		Next:          d.nextThreshold(to),
		Revision:      revision,
	}
}

func (d *Definition) nextThreshold(tier int) *int {
	if d.Counter == nil || tier >= len(d.Tiers) {
		return nil
	}
	return d.Tiers[tier].At
}

func (d *Definition) topThreshold() int {
	if d.Counter == nil {
		return 0
	}
	return *d.Tiers[len(d.Tiers)-1].At
}

func (d *Definition) tierForCount(n int) int {
	tier := 0
	for _, t := range d.Tiers {
		if t.At != nil && *t.At <= n {
			tier = t.Tier
		}
	}
	return tier
}

func (d *Definition) routeTier(ev Event) int {
	tier := 0
	for _, t := range d.Tiers {
		for _, r := range t.Or {
			if r.Entity == ev.Entity && r.Action == ev.Action && conditionsHold(r.Where, ev.Context) {
				tier = max(tier, t.Tier)
			}
		}
	}
	return tier
}

func (m *Matcher) unitID(ev Event) (string, bool) {
	var unit string
	if m.CountBy.occurrence {
		unit = ev.ID
	} else {
		parts := make([]string, 0, len(m.idFields))
		for _, name := range m.idFields {
			part, ok := scalarString(ev.Context[name])
			if !ok {
				return "", false
			}
			parts = append(parts, part)
		}
		unit = strings.Join(parts, ":")
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
