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
// stored progress. Only the lowest tier not held accrues, and an event earns at
// most that tier; points past its goal do not carry over.
func evaluate(d *Definition, stored Progress, ev Event) outcome {
	held := heldSet(stored.TierIDs)
	ignored := func(reason Reason) outcome {
		return outcome{decision: d.decision(KindIgnored, reason, nil, held, stored.Points)}
	}
	current := d.lowestUnheld(held)
	switch {
	case stored.SchemaVersion > SchemaVersion:
		return ignored(ReasonRecordNewer)
	case current < 0:
		return ignored(ReasonComplete)
	}

	tier := &d.Tiers[current]
	unit, worth, reason := tier.score(ev)
	if reason != "" {
		return ignored(reason)
	}
	i, found := slices.BinarySearch(stored.Units, unit)
	switch {
	case found:
		return ignored(ReasonDuplicate)
	case len(stored.Units) >= maxUnits:
		return ignored(ReasonComplete)
	}

	next := stored
	next.Units = slices.Insert(slices.Clone(stored.Units), i, unit)
	next.Points = stored.Points + worth
	after := held
	var awarded []string
	if next.Points >= tier.Goal {
		awarded = []string{tier.ID}
		after = maps.Clone(held)
		after[tier.ID] = true
		next.TierIDs = d.mergeHeld(stored.TierIDs, after)
		next.Points = 0
	}
	return outcome{
		decision: d.decision(d.kind(awarded, held, after), "", awarded, after, next.Points),
		next:     next,
		changed:  true,
	}
}

// score is the unit ev counts toward t and the highest worth among the rules
// of t it matches. Validation makes every rule on one pair count one unit.
func (t *Tier) score(ev Event) (unit string, worth int, reason Reason) {
	sawInvalid := false
	for i := range t.Rules {
		r := &t.Rules[i]
		if r.Entity != ev.Entity || r.Action != ev.Action || !conditionsHold(r.Where, ev.Context) {
			continue
		}
		key, ok := r.unitID(ev)
		if !ok {
			sawInvalid = true
			continue
		}
		unit, worth = key, max(worth, r.worth())
	}
	switch {
	case worth > 0:
		return unit, worth, ""
	case sawInvalid:
		return "", 0, ReasonInvalidContext
	default:
		return "", 0, ReasonConditionNotMet
	}
}

func (d *Definition) kind(awarded []string, before, after map[string]bool) Kind {
	switch {
	case len(awarded) > 0 && (!d.holdsAny(before) || d.holdsAll(after)):
		return KindAward
	case len(awarded) > 0:
		return KindTierUp
	default:
		return KindIncrement
	}
}

// decision reports points toward the lowest tier not in held, and its goal.
func (d *Definition) decision(kind Kind, reason Reason, awarded []string, held map[string]bool, points int) Decision {
	if awarded == nil {
		awarded = []string{}
	}
	dec := Decision{
		AchievementID: d.ID,
		Decision:      kind,
		Reason:        reason,
		Awarded:       awarded,
		Final:         true,
	}
	if i := d.lowestUnheld(held); i >= 0 {
		goal := d.Tiers[i].Goal
		dec.Final, dec.Units, dec.Next = false, points, &goal
	}
	return dec
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

func (d *Definition) lowestUnheld(held map[string]bool) int {
	return slices.IndexFunc(d.Tiers, func(t Tier) bool { return !held[t.ID] })
}

// unitID is the ledger key of the unit ev brings: the rule's unit and ":",
// then each id field (the event id for an occurrence) as byte length, ":" and
// the field, as in "guide:7:bundled4:tour".
func (r *Rule) unitID(ev Event) (string, bool) {
	var key strings.Builder
	add := func(part string) {
		key.WriteString(strconv.Itoa(len(part)))
		key.WriteByte(':')
		key.WriteString(part)
	}
	if r.unit == unitOccurrence {
		if ev.ID == "" {
			return "", false
		}
		add(ev.ID)
	}
	for _, name := range r.idFields {
		part, ok := scalarString(ev.Context[name])
		if !ok {
			return "", false
		}
		add(part)
	}
	if key.Len() > maxUnitIDBytes {
		return "", false
	}
	return r.unit + ":" + key.String(), true
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
