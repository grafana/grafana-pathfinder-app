package achievements

import (
	"crypto/sha256"
	"encoding/hex"
	"maps"
	"slices"
	"strconv"
	"strings"
)

// The AchievementProgress CRD caps a unit at 520 characters, unit prefix included.
const maxUnitIDBytes = 520

// digestMarker starts the key of a unit too long to store whole; a length-prefixed key starts with a digit.
const digestMarker = "#"

// maxEventIDs bounds Progress.EventIDs: one id per ledger entry, and at most
// one more per held tier, for an event that held it without a ledger entry.
const maxEventIDs = maxUnits + maxTiers

type outcome struct {
	decision Decision
	// next is the progress to persist; meaningful only when changed.
	next    Progress
	changed bool
	// unit is the ledger key the event counted, recorded on the award it earns.
	unit string
}

// evaluate is the pure step 4 of RFC §6.3, changed as
// docs/design/ACHIEVEMENTS_RFC_DEPARTURES.md records: one event against one
// achievement's stored progress. Only the lowest tier not held accrues, and an
// event earns at most that tier; points past its goal do not carry over.
func evaluate(d *Definition, stored Progress, ev Event) outcome {
	if Classify(stored) == ShapeRepairable {
		stored = Normalize(stored)
	}
	held := heldSet(stored.TierIDs)
	ignored := func(reason Reason) outcome {
		return outcome{decision: d.decision(KindIgnored, reason, nil, held, stored.Points)}
	}
	current := d.lowestUnheld(held)
	switch {
	case stored.SchemaVersion > ProgressSchemaVersion:
		return ignored(ReasonRecordNewer)
	case current < 0:
		return ignored(ReasonComplete)
	case hasEventID(stored.EventIDs, ev.ID):
		return ignored(ReasonDuplicate)
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
	next.SchemaVersion = ProgressSchemaVersion
	next.Units = slices.Insert(slices.Clone(stored.Units), i, unit)
	next.EventIDs = withEventID(stored.EventIDs, ev.ID)
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
		unit:     unit,
	}
}

// apply settles ev against stored, a saved row with no stranded tier.
func (d *Definition) apply(stored Progress, ev Event, written []string) outcome {
	if Classify(stored) == ShapeRepairable {
		stored = Normalize(stored)
	}
	return d.keepHeld(stored, evaluate(d, stored, ev), ev, written)
}

// healThenApply scores ev against stored with each stranded tier held. When ev
// would earn a tier on top of the heal, it returns the heal alone, to be saved
// first: an award created against an unsaved heal, which a lost
// compare-and-swap could prove wrong, would outlive it.
func (d *Definition) healThenApply(stored Progress, stranded []Award, ev Event, written []string) (out outcome, healOnly bool) {
	healed := d.heal(stored, stranded)
	out = d.apply(healed, ev, written)
	switch {
	case len(out.decision.Awarded) > 0:
		return outcome{next: healed, changed: true}, true
	case !out.changed:
		out.next, out.changed = healed, true
	}
	return out, false
}

func tierIDs(awards []Award) []string {
	ids := make([]string, len(awards))
	for i, a := range awards {
		ids[i] = a.TierID
	}
	return ids
}

// heal completes each stranded tier's failed save, spending the unit and the
// event id its award row records, so the earning event's retry is a duplicate.
func (d *Definition) heal(stored Progress, stranded []Award) Progress {
	held := heldSet(stored.TierIDs)
	units := slices.Clone(stored.Units)
	ids := stored.EventIDs
	for _, a := range stranded {
		held[a.TierID] = true
		if i, found := slices.BinarySearch(units, a.Unit); !found && len(units) < maxUnits {
			units = slices.Insert(units, i, a.Unit)
		}
		ids = withEventID(ids, a.EventID)
	}
	healed := stored
	healed.SchemaVersion = ProgressSchemaVersion
	healed.TierIDs = d.mergeHeld(stored.TierIDs, held)
	healed.Units = units
	healed.EventIDs = ids
	healed.Points = 0
	return healed
}

// keepHeld finishes out, ev scored against stored, so the save also holds every
// tier in written. A re-run after a conflict can find the event's unit counted
// by another writer at a lower worth, and must not leave those awards unheld.
// The decision reports each tier the save adds to stored's held set.
func (d *Definition) keepHeld(stored Progress, out outcome, ev Event, written []string) outcome {
	if out.decision.Reason == ReasonRecordNewer {
		return out
	}
	base := stored
	if out.changed {
		base = out.next
	}
	held := heldSet(base.TierIDs)
	after := maps.Clone(held)
	for _, id := range written {
		after[id] = true
	}
	if len(after) == len(held) {
		return out
	}
	next := base
	next.SchemaVersion = ProgressSchemaVersion
	next.TierIDs = d.mergeHeld(base.TierIDs, after)
	next.EventIDs = withEventID(base.EventIDs, ev.ID)
	if d.lowestUnheld(after) != d.lowestUnheld(held) {
		next.Points = 0
	}
	before := heldSet(stored.TierIDs)
	var awarded []string
	for _, t := range d.Tiers {
		if after[t.ID] && !before[t.ID] {
			awarded = append(awarded, t.ID)
		}
	}
	return outcome{
		decision: d.decision(d.kind(awarded, before, after), "", awarded, after, next.Points),
		next:     next,
		changed:  true,
		unit:     out.unit,
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

// withHealed reports the tiers this call's heal saves held beside those dec
// reports, against row, the last row this call saved or loaded.
func (d *Definition) withHealed(dec Decision, healed []string, row Progress) Decision {
	if len(healed) == 0 || dec.Reason.Transient() {
		return dec
	}
	after := heldSet(row.TierIDs)
	before := maps.Clone(after)
	var awarded []string
	for _, t := range d.Tiers {
		if slices.Contains(healed, t.ID) || slices.Contains(dec.Awarded, t.ID) {
			awarded = append(awarded, t.ID)
			delete(before, t.ID)
		}
	}
	return d.decision(d.kind(awarded, before, after), "", awarded, after, row.Points)
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
		dec.Final, dec.Units, dec.Next, dec.NextTier = false, points, &goal, d.Tiers[i].ID
	}
	return dec
}

func hasEventID(ids []string, id string) bool {
	_, found := slices.BinarySearch(ids, id)
	return found && id != ""
}

// withEventID adds id to the sorted ids unless it is empty, listed or over the bound.
func withEventID(ids []string, id string) []string {
	i, found := slices.BinarySearch(ids, id)
	if id == "" || found || len(ids) >= maxEventIDs {
		return ids
	}
	return slices.Insert(slices.Clone(ids), i, id)
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
	id := r.unit + ":" + key.String()
	if len(id) > maxUnitIDBytes {
		sum := sha256.Sum256([]byte(key.String()))
		id = r.unit + ":" + digestMarker + hex.EncodeToString(sum[:])
	}
	return id, true
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
