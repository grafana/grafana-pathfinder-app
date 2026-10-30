package achievements

import (
	"encoding/json"
	"errors"
	"fmt"
)

// CheckBaseline compares the catalog with the last released one (RFC §6.2,
// Lifecycle). New achievements and appended tiers are allowed.
func CheckBaseline(released, current *Catalog) error {
	byID := make(map[string]*Definition, len(current.Achievements))
	for i := range current.Achievements {
		byID[current.Achievements[i].ID] = &current.Achievements[i]
	}
	var errs []error
	for i := range released.Achievements {
		base := &released.Achievements[i]
		cur, ok := byID[base.ID]
		if !ok {
			errs = append(errs, fmt.Errorf("baseline: achievement %q was removed or its id changed", base.ID))
			continue
		}
		errs = append(errs, checkDefinition(base, cur)...)
	}
	return errors.Join(errs...)
}

func checkDefinition(base, cur *Definition) []error {
	where := fmt.Sprintf("baseline: achievement %q", base.ID)
	var errs []error
	if (base.Counter == nil) != (cur.Counter == nil) || (base.Counter != nil && base.Counter.Unit != cur.Counter.Unit) {
		errs = append(errs, fmt.Errorf("%s: counter unit changed", where))
	}
	if len(cur.Tiers) < len(base.Tiers) {
		errs = append(errs, fmt.Errorf("%s: %d tiers removed", where, len(base.Tiers)-len(cur.Tiers)))
	}
	for i := 0; i < min(len(base.Tiers), len(cur.Tiers)); i++ {
		if base.Tiers[i].Art != "" && cur.Tiers[i].Art != "" && base.Tiers[i].Art != cur.Tiers[i].Art {
			errs = append(errs, fmt.Errorf("%s: tier %d was inserted, replaced, or reordered (art %q is now %q)", where, i+1, base.Tiers[i].Art, cur.Tiers[i].Art))
		}
	}
	if cur.Revision < base.Revision {
		errs = append(errs, fmt.Errorf("%s: revision lowered from %d to %d", where, base.Revision, cur.Revision))
	}
	if cur.Revision == base.Revision && rulesJSON(base) != rulesJSON(cur) {
		errs = append(errs, fmt.Errorf("%s: counter or tiers changed without raising revision %d", where, base.Revision))
	}
	return errs
}

func rulesJSON(d *Definition) string {
	b, _ := json.Marshal(struct {
		Counter *Counter `json:"counter"`
		Tiers   []Tier   `json:"tiers"`
	}{d.Counter, d.Tiers})
	return string(b)
}
