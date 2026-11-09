import { config } from '@grafana/runtime';

// Multi-tenant boot serves an empty map, so an empty map is unknown (undefined) rather than off.
export function readBootFeatureToggle(name: string): boolean | undefined {
  const toggles = config.featureToggles as Partial<Record<string, boolean>> | undefined;
  if (toggles?.[name] === true) {
    return true;
  }
  return toggles && Object.keys(toggles).length > 0 ? false : undefined;
}
