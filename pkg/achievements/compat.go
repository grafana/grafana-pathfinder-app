package achievements

import (
	"encoding/json"
	"fmt"
	"math"
	"slices"
)

// BundleBreaks lists what next drops, reorders or redefines from live. Award
// rows and progress name achievements, tiers, counted units and art for good,
// so a published bundle may only add to what an earlier one published.
func BundleBreaks(live, next []byte) ([]string, error) {
	var before, after struct {
		Grammar  string          `json:"grammar"`
		Registry json.RawMessage `json:"registry"`
		Catalog  json.RawMessage `json:"catalog"`
		Art      []string        `json:"art"`
	}
	if err := json.Unmarshal(live, &before); err != nil {
		return nil, fmt.Errorf("live bundle: %w", err)
	}
	if err := json.Unmarshal(next, &after); err != nil {
		return nil, fmt.Errorf("next bundle: %w", err)
	}
	wasMajor, wasMinor, err := parseGrammar(before.Grammar)
	if err != nil {
		return nil, fmt.Errorf("live bundle: %w", err)
	}
	isMajor, isMinor, err := parseGrammar(after.Grammar)
	if err != nil {
		return nil, fmt.Errorf("next bundle: %w", err)
	}
	if wasMajor != isMajor {
		return nil, fmt.Errorf("grammar major changed from %d to %d; another major publishes beside this one", wasMajor, isMajor)
	}
	problems, err := catalogBreaks(orEmpty(before.Catalog), orEmpty(after.Catalog))
	if err != nil {
		return nil, err
	}
	if isMinor < wasMinor {
		problems = append(problems, fmt.Sprintf("grammar went back from %s to %s", before.Grammar, after.Grammar))
	}
	registry, err := registryBreaks(orEmpty(before.Registry), orEmpty(after.Registry))
	if err != nil {
		return nil, err
	}
	problems = append(problems, registry...)
	for _, key := range before.Art {
		if !slices.Contains(after.Art, key) {
			problems = append(problems, fmt.Sprintf("art key %q was removed", key))
		}
	}
	return problems, nil
}

// requiresMinor reads a missing requires as the first minor; LoadBundle rejects
// a malformed one, so it compares as the newest.
func requiresMinor(v string) int {
	if v == "" {
		return 0
	}
	_, minor, err := parseGrammar(v)
	if err != nil {
		return math.MaxInt
	}
	return minor
}

func orEmpty(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || string(raw) == "null" {
		return json.RawMessage("{}")
	}
	return raw
}

type achievementIdentity struct {
	ID       string `json:"id"`
	Requires string `json:"requires"`
	Counter  *struct {
		Unit string `json:"unit"`
	} `json:"counter"`
	Tiers []struct {
		ID string `json:"id"`
	} `json:"tiers"`
}

func (a achievementIdentity) unit() string {
	if a.Counter == nil {
		return ""
	}
	return a.Counter.Unit
}

func (a achievementIdentity) tierIDs() []string {
	ids := make([]string, len(a.Tiers))
	for i, tier := range a.Tiers {
		ids[i] = tier.ID
	}
	return ids
}

func catalogBreaks(live, next []byte) ([]string, error) {
	var before, after struct {
		Achievements []achievementIdentity `json:"achievements"`
	}
	if err := json.Unmarshal(live, &before); err != nil {
		return nil, fmt.Errorf("live catalog: %w", err)
	}
	if err := json.Unmarshal(next, &after); err != nil {
		return nil, fmt.Errorf("next catalog: %w", err)
	}
	now := make(map[string]achievementIdentity, len(after.Achievements))
	var problems []string
	for _, a := range after.Achievements {
		if _, dup := now[a.ID]; dup {
			problems = append(problems, fmt.Sprintf("achievement %q is declared more than once", a.ID))
			continue
		}
		now[a.ID] = a
	}
	for _, was := range before.Achievements {
		is, ok := now[was.ID]
		if !ok {
			problems = append(problems, fmt.Sprintf("achievement %q was removed or renamed", was.ID))
			continue
		}
		if was.unit() != is.unit() {
			problems = append(problems, fmt.Sprintf("achievement %q counter unit changed from %q to %q", was.ID, was.unit(), is.unit()))
		}
		if requiresMinor(is.Requires) > requiresMinor(was.Requires) {
			problems = append(problems, fmt.Sprintf("achievement %q requires grammar %s, up from %s, so plugins that read only the older grammar stop evaluating it; add a new achievement instead", was.ID, is.Requires, was.Requires))
		}
		problems = append(problems, orderBreaks(fmt.Sprintf("achievement %q tier", was.ID), was.tierIDs(), is.tierIDs())...)
	}
	return problems, nil
}

type registryIdentity struct {
	Entities map[string]struct {
		Actions map[string]struct {
			Context map[string]struct {
				Type string `json:"type"`
			} `json:"context"`
			Resources []struct {
				Unit string   `json:"unit"`
				ID   []string `json:"id"`
			} `json:"resources"`
		} `json:"actions"`
	} `json:"entities"`
}

func registryBreaks(live, next []byte) ([]string, error) {
	var before, after registryIdentity
	if err := json.Unmarshal(live, &before); err != nil {
		return nil, fmt.Errorf("live registry: %w", err)
	}
	if err := json.Unmarshal(next, &after); err != nil {
		return nil, fmt.Errorf("next registry: %w", err)
	}
	var problems []string
	for _, entity := range sortedKeys(before.Entities) {
		nowEntity, ok := after.Entities[entity]
		if !ok {
			problems = append(problems, fmt.Sprintf("entity %q was removed", entity))
			continue
		}
		for _, name := range sortedKeys(before.Entities[entity].Actions) {
			was := before.Entities[entity].Actions[name]
			is, ok := nowEntity.Actions[name]
			pair := entity + "." + name
			if !ok {
				problems = append(problems, fmt.Sprintf("%s was removed", pair))
				continue
			}
			for _, field := range sortedKeys(was.Context) {
				f, ok := is.Context[field]
				switch {
				case !ok:
					problems = append(problems, fmt.Sprintf("%s field %q was removed", pair, field))
				case f.Type != was.Context[field].Type:
					problems = append(problems, fmt.Sprintf("%s field %q changed type from %s to %s", pair, field, was.Context[field].Type, f.Type))
				}
			}
			var wasUnits, isUnits []string
			for _, r := range was.Resources {
				wasUnits = append(wasUnits, r.Unit)
			}
			for _, r := range is.Resources {
				isUnits = append(isUnits, r.Unit)
			}
			problems = append(problems, orderBreaks(pair+" resource", wasUnits, isUnits)...)
			for _, r := range was.Resources {
				i := slices.Index(isUnits, r.Unit)
				if i >= 0 && !slices.Equal(r.ID, is.Resources[i].ID) {
					problems = append(problems, fmt.Sprintf("%s resource %q is now identified by %v, not %v", pair, r.Unit, is.Resources[i].ID, r.ID))
				}
			}
		}
	}
	return problems, nil
}

// orderBreaks reports ids missing from now, and earlier ids that no longer
// appear in their earlier order. New ids may appear anywhere.
func orderBreaks(what string, was, now []string) []string {
	var problems, kept []string
	for _, id := range was {
		if slices.Contains(now, id) {
			kept = append(kept, id)
		} else {
			problems = append(problems, fmt.Sprintf("%s %q was removed or renamed", what, id))
		}
	}
	var order []string
	for _, id := range now {
		if slices.Contains(kept, id) {
			order = append(order, id)
		}
	}
	if !slices.Equal(kept, order) {
		problems = append(problems, fmt.Sprintf("%ss were reordered from %v to %v", what, kept, order))
	}
	return problems
}
