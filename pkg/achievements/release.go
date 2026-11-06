package achievements

import (
	"errors"
	"fmt"
	"slices"
)

// CheckRelease enforces the author rules (RFC §6.2, Lifecycle) against the last
// release: awards already given depend on its ids, tier order and units.
func CheckRelease(releasedRegistry, registry *Registry, released, current *Catalog) error {
	return errors.Join(checkRegistryRelease(releasedRegistry, registry), checkCatalogRelease(released, current))
}

func checkCatalogRelease(released, current *Catalog) error {
	var errs []error
	for i := range released.Achievements {
		base := &released.Achievements[i]
		cur := current.definition(base.ID)
		if cur == nil {
			errs = append(errs, fmt.Errorf("release: achievement %q was removed or its id changed", base.ID))
			continue
		}
		where := fmt.Sprintf("release: achievement %q", base.ID)
		if (base.Counter == nil) != (cur.Counter == nil) || (base.Counter != nil && base.Counter.Unit != cur.Counter.Unit) {
			errs = append(errs, fmt.Errorf("%s: counter unit changed", where))
		}
		last := -1
		for _, t := range base.Tiers {
			rank := cur.tierRank(t.ID)
			switch {
			case rank < 0:
				errs = append(errs, fmt.Errorf("%s: tier %q was removed or its id changed", where, t.ID))
			case rank < last:
				errs = append(errs, fmt.Errorf("%s: tier %q moved below a tier it was released above", where, t.ID))
			default:
				last = rank
			}
		}
	}
	return errors.Join(errs...)
}

func checkRegistryRelease(released, current *Registry) error {
	var errs []error
	for _, entity := range sortedKeys(released.Entities) {
		for _, name := range sortedKeys(released.Entities[entity].Actions) {
			base := released.Entities[entity].Actions[name]
			where := fmt.Sprintf("release: %s.%s", entity, name)
			cur, ok := current.action(entity, name)
			if !ok {
				errs = append(errs, fmt.Errorf("%s was removed", where))
				continue
			}
			for _, field := range sortedKeys(base.Context) {
				if got, ok := cur.Context[field]; !ok || got.Type != base.Context[field].Type {
					errs = append(errs, fmt.Errorf("%s: context field %q was removed or retyped", where, field))
				}
			}
			for i, res := range base.Resources {
				if i >= len(cur.Resources) || cur.Resources[i].Unit != res.Unit || !slices.Equal(cur.Resources[i].ID, res.ID) {
					errs = append(errs, fmt.Errorf("%s: resource %d (%q) was removed, reordered, or identifies its unit differently", where, i, res.Unit))
				}
			}
		}
	}
	return errors.Join(errs...)
}
