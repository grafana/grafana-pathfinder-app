import { config } from '@grafana/runtime';

import { querySelectorAllEnhanced } from './enhanced-selector';
import { findGrafanaSelectorPathForVersion, toGrafanaSelectorForVersion } from './grafana-selector-core';

function getGrafanaVersion(): string {
  return config.buildInfo.version || 'latest';
}

export function toGrafanaSelector(selectorPath: string, selectorId?: string): string {
  return toGrafanaSelectorForVersion(selectorPath, getGrafanaVersion(), selectorId);
}

export function findByGrafanaSelector(selectorPath: string, selectorId?: string): HTMLElement[] {
  return querySelectorAllEnhanced(toGrafanaSelector(selectorPath, selectorId)).elements;
}

export function findOneByGrafanaSelector(selectorPath: string, selectorId?: string): HTMLElement | null {
  return findByGrafanaSelector(selectorPath, selectorId)[0] ?? null;
}

export function existsByGrafanaSelector(selectorPath: string, selectorId?: string): boolean {
  return findByGrafanaSelector(selectorPath, selectorId).length > 0;
}

/**
 * Returns null for unknown or ambiguous values so callers can fall back to CSS generation.
 */
export function findGrafanaSelectorPath(element: HTMLElement): string | null {
  const values = [element.getAttribute('data-testid'), element.getAttribute('aria-label')].filter(
    (value): value is string => Boolean(value)
  );
  return findGrafanaSelectorPathForVersion(values, getGrafanaVersion());
}
