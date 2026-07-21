/**
 * Version-aware resolution and ambiguity handling for grafana-selector.
 *
 * Uses a synthetic versioned selector tree with the package's real
 * `resolveSelectors`, so forward resolution and reverse lookup exercise
 * explicit target versions end-to-end.
 */

import { describe, it, expect } from '@jest/globals';
jest.mock('@grafana/runtime', () => ({
  config: { buildInfo: { version: 'latest' } },
}));

jest.mock('@grafana/e2e-selectors', () => {
  const actual = jest.requireActual('@grafana/e2e-selectors');
  return {
    resolveSelectors: actual.resolveSelectors,
    versionedComponents: {
      Thing: {
        button: {
          '11.0.0': 'data-testid new thing button',
          '8.5.0': 'old thing button',
        },
      },
      Dupe: {
        one: { '8.5.0': 'data-testid shared value' },
      },
      Tpl: {
        row: { '8.5.0': (title: string) => `data-testid thing row ${title}` },
        cell: { '8.5.0': (title: string) => `data-testid thing ${title} end` },
      },
      Static: {
        label: { '8.5.0': () => 'data-testid PARAM label' },
      },
    },
    versionedPages: {
      DupePage: {
        two: { '8.5.0': 'data-testid shared value' },
      },
    },
  };
});
import { config } from '@grafana/runtime';
import { toGrafanaSelector } from './grafana-selector';

import { findGrafanaSelectorPathForVersion, toGrafanaSelectorForVersion } from './grafana-selector-core';
describe('grafana-selector browser adapter', () => {
  it('resolves against the running Grafana version', () => {
    config.buildInfo.version = '9.0.0';
    expect(toGrafanaSelector('components.Thing.button')).toContain("[data-testid='old thing button']");
  });
});

describe('grafana-selector — version-aware resolution', () => {
  it('resolves forward against the running Grafana version, not latest', () => {
    expect(toGrafanaSelectorForVersion('components.Thing.button', '9.0.0')).toContain(
      "[data-testid='old thing button']"
    );
  });

  it('resolves forward to the newer value once the running version reaches it', () => {
    expect(toGrafanaSelectorForVersion('components.Thing.button', '12.0.0')).toContain(
      "[data-testid='data-testid new thing button']"
    );
  });

  it('falls back to the latest values when the version is not valid semver', () => {
    expect(toGrafanaSelectorForVersion('components.Thing.button', '1.0')).toContain(
      "[data-testid='data-testid new thing button']"
    );
  });

  it('reverse-matches the value the running version renders', () => {
    expect(findGrafanaSelectorPathForVersion(['old thing button'], '9.0.0')).toBe('grafana:components.Thing.button');
  });

  it('does not reverse-match a value from a different version', () => {
    expect(findGrafanaSelectorPathForVersion(['data-testid new thing button'], '9.0.0')).toBeNull();
  });

  it('rebuilds the reverse index when the version changes', () => {
    expect(findGrafanaSelectorPathForVersion(['old thing button'], '9.0.0')).toBe('grafana:components.Thing.button');
    expect(findGrafanaSelectorPathForVersion(['old thing button'], '12.0.0')).toBeNull();
    expect(findGrafanaSelectorPathForVersion(['data-testid new thing button'], '12.0.0')).toBe(
      'grafana:components.Thing.button'
    );
  });
});

describe('grafana-selector — ambiguity rejection', () => {
  it('returns null for a value claimed by more than one selector path', () => {
    expect(findGrafanaSelectorPathForVersion(['data-testid shared value'], '12.0.0')).toBeNull();
  });

  it('returns a unique template match with its parameter', () => {
    expect(findGrafanaSelectorPathForVersion(['data-testid thing row alpha'], '12.0.0')).toBe(
      'grafana:components.Tpl.row:alpha'
    );
  });

  it('returns null when a value matches more than one template', () => {
    expect(findGrafanaSelectorPathForVersion(['data-testid thing row alpha end'], '12.0.0')).toBeNull();
  });

  it('never treats an argument-ignoring selector function as a template', () => {
    // Pins the TEMPLATE_SENTINEL contract: the U+E000-delimited sentinel cannot
    // appear in a probe's output unless the function interpolates its argument,
    // so Static.label ('data-testid PARAM label') must not become a template
    // matching unrelated values of the shape 'data-testid ... label'.
    expect(findGrafanaSelectorPathForVersion(['data-testid foo label'], '12.0.0')).toBeNull();
  });
});
