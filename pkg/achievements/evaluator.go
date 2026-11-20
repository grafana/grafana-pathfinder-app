package achievements

import (
	"context"
	"errors"
	"slices"
	"time"
)

const maxAttempts = 5

// Evaluator runs RFC §6.3 against a catalog and two ports. It does no I/O of
// its own.
type Evaluator struct {
	catalog *Catalog
	store   Store
	policy  Policy
	now     func() time.Time
}

func NewEvaluator(catalog *Catalog, store Store, policy Policy, now func() time.Time) *Evaluator {
	return &Evaluator{catalog: catalog, store: store, policy: policy, now: now}
}

// Evaluate returns one decision per selected achievement, in catalog order, and
// never a nil slice. A policy refusal is returned as an error.
func (e *Evaluator) Evaluate(ctx context.Context, person Person, ev Event) ([]Decision, error) {
	if err := e.policy.Allow(ctx, person); err != nil {
		return nil, err
	}
	selected := e.catalog.selectFor(ev)
	decisions := make([]Decision, 0, len(selected))
	if len(selected) == 0 {
		return decisions, nil
	}

	ids := make([]string, len(selected))
	for i, d := range selected {
		ids[i] = d.ID
	}
	loaded, loadErr := e.store.LoadProgress(ctx, person, ids)
	for _, d := range selected {
		if loadErr != nil {
			decisions = append(decisions, d.unavailable(Progress{}))
			continue
		}
		decisions = append(decisions, e.settle(ctx, person, d, ev, loaded))
	}
	return decisions, nil
}

func (c *Catalog) selectFor(ev Event) []*Definition {
	var selected []*Definition
	for i := range c.Achievements {
		d := &c.Achievements[i]
		if d.anyPair(func(p Pair) bool { return p.Entity == ev.Entity && p.Action == ev.Action }) {
			selected = append(selected, d)
		}
	}
	return selected
}

func (e *Evaluator) settle(ctx context.Context, person Person, d *Definition, ev Event, loaded map[string]Progress) Decision {
	current, found := loaded[d.ID]
	if !found {
		created, ok := e.ensureProgress(ctx, person, d)
		if !ok {
			return d.unavailable(Progress{})
		}
		current = created
	}

	current, ok := e.repair(ctx, person, d, current)
	if !ok {
		return d.unavailable(current)
	}

	var written []string
	for attempt := 1; ; attempt++ {
		out := d.keepWritten(current, evaluate(d, current, ev), written)
		if !out.changed {
			return out.decision
		}
		for _, tierID := range out.decision.Awarded {
			award := Award{AchievementID: d.ID, TierID: tierID, Entity: ev.Entity, EarnedAt: e.now().UTC()}
			// A 409 is not a failure: the held set, not the create result, decides what is reported (RFC §6.3).
			if err := e.store.CreateAward(ctx, person, award); err != nil && !errors.Is(err, ErrExists) {
				return d.unavailable(current)
			}
			if !slices.Contains(written, tierID) {
				written = append(written, tierID)
			}
		}
		_, err := e.store.SaveProgress(ctx, person, out.next)
		switch {
		case err == nil:
			return out.decision
		case !errors.Is(err, ErrConflict):
			return d.unavailable(current)
		case attempt == maxAttempts:
			return d.decision(KindIgnored, ReasonConflict, nil, heldSet(current.TierIDs), current.Points)
		}
		reloaded, ok := e.reload(ctx, person, d)
		if !ok {
			return d.unavailable(current)
		}
		current = reloaded
	}
}

// repair saves Normalize(row) when the row is repairable, adding no unit,
// points or award, and returns the row the store acknowledged. An
// acknowledgement that cannot be read proves nothing, so the row is re-read.
func (e *Evaluator) repair(ctx context.Context, person Person, d *Definition, row Progress) (Progress, bool) {
	for attempt := 1; Classify(row) == ShapeRepairable; attempt++ {
		if attempt > maxAttempts {
			return row, false
		}
		saved, err := e.store.SaveProgress(ctx, person, Normalize(row))
		var ok bool
		switch {
		case errors.Is(err, ErrConflict):
			row, ok = e.reload(ctx, person, d)
		case err != nil:
			return row, false
		case saved.Version == "":
			row, ok = e.reload(ctx, person, d)
		default:
			row, ok = saved, true
		}
		if !ok {
			return row, false
		}
	}
	return row, true
}

func (e *Evaluator) ensureProgress(ctx context.Context, person Person, d *Definition) (Progress, bool) {
	created, err := e.store.CreateProgress(ctx, person, Progress{AchievementID: d.ID, SchemaVersion: ProgressSchemaVersion})
	switch {
	case err == nil:
		return created, true
	case errors.Is(err, ErrExists):
		return e.reload(ctx, person, d)
	default:
		return Progress{}, false
	}
}

func (e *Evaluator) reload(ctx context.Context, person Person, d *Definition) (Progress, bool) {
	rows, err := e.store.LoadProgress(ctx, person, []string{d.ID})
	row, ok := rows[d.ID]
	return row, err == nil && ok
}

func (d *Definition) unavailable(p Progress) Decision {
	return d.decision(KindIgnored, ReasonStoreUnavailable, nil, heldSet(p.TierIDs), p.Points)
}
