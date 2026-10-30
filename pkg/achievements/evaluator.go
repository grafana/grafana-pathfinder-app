package achievements

import (
	"context"
	"errors"
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

	for range maxAttempts {
		out := evaluate(d, current, ev)
		if !out.changed {
			return out.decision
		}
		for tier := current.Tier + 1; tier <= out.next.Tier; tier++ {
			award := Award{AchievementID: d.ID, Tier: tier, Route: ev.Entity, Revision: out.next.Revision, EarnedAt: e.now().UTC()}
			if err := e.store.CreateAward(ctx, person, award); err != nil && !errors.Is(err, ErrExists) {
				return d.unavailable(current)
			}
		}
		_, err := e.store.SaveProgress(ctx, person, out.next)
		switch {
		case err == nil:
			return out.decision
		case !errors.Is(err, ErrConflict):
			return d.unavailable(current)
		}
		reloaded, ok := e.reload(ctx, person, d)
		if !ok {
			return d.unavailable(current)
		}
		current = reloaded
	}
	return d.decision(KindIgnored, ReasonConflict, current.Tier, current.Tier, len(current.Units), current.Revision)
}

func (e *Evaluator) ensureProgress(ctx context.Context, person Person, d *Definition) (Progress, bool) {
	created, err := e.store.CreateProgress(ctx, person, Progress{AchievementID: d.ID, Revision: d.Revision})
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
	return d.decision(KindIgnored, ReasonStoreUnavailable, p.Tier, p.Tier, len(p.Units), max(p.Revision, d.Revision))
}
