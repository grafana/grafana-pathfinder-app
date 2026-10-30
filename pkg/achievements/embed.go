package achievements

import (
	_ "embed"
	"fmt"
)

// Tier thresholds in data/achievements.json are placeholders; the enablement
// team owns them (RFC §11.2).
//
//go:embed data/achievements.json
var catalogJSON []byte

//go:embed data/events.json
var registryJSON []byte

//go:embed data/achievements.baseline.json
var baselineJSON []byte

// LoadBundled parses the embedded registry and catalog and checks the catalog
// against the embedded baseline of the last released one.
func LoadBundled() (*Registry, *Catalog, error) {
	registry, err := LoadRegistry(registryJSON)
	if err != nil {
		return nil, nil, fmt.Errorf("bundled registry: %w", err)
	}
	catalog, err := LoadCatalog(catalogJSON, registry)
	if err != nil {
		return nil, nil, fmt.Errorf("bundled catalog: %w", err)
	}
	baseline, err := LoadCatalog(baselineJSON, registry)
	if err != nil {
		return nil, nil, fmt.Errorf("bundled baseline: %w", err)
	}
	if err := CheckBaseline(baseline, catalog); err != nil {
		return nil, nil, fmt.Errorf("bundled catalog: %w", err)
	}
	return registry, catalog, nil
}
