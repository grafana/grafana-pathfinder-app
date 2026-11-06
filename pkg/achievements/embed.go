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

func LoadBundled() (*Registry, *Catalog, error) {
	registry, err := LoadRegistry(registryJSON)
	if err != nil {
		return nil, nil, fmt.Errorf("bundled registry: %w", err)
	}
	catalog, err := LoadCatalog(catalogJSON, registry)
	if err != nil {
		return nil, nil, fmt.Errorf("bundled catalog: %w", err)
	}
	return registry, catalog, nil
}
