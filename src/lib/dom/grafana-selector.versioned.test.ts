/**
 * Version-aware resolution and ambiguity handling for grafana-selector.
 *
 * Uses a synthetic versioned selector tree with the package's real
 * `resolveSelectors`, so the wiring from `config.buildInfo.version` through
 * forward resolution and the reverse index is exercised end-to-end.
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
import { toGrafanaSelector, findGrafanaSelectorPath } from './grafana-selector';

function elementWithTestId(testId: string): HTMLElement {
  const el = document.createElement('button');
  el.setAttribute('data-testid', testId);
  return el;
}

describe('grafana-selector — version-aware resolution', () => {
  it('resolves forward against the running Grafana version, not latest', () => {
    config.buildInfo.version = '9.0.0';
    expect(toGrafanaSelector('components.Thing.button')).toContain("[data-testid='old thing button']");
  });

  it('resolves forward to the newer value once the running version reaches it', () => {
    config.buildInfo.version = '12.0.0';
    expect(toGrafanaSelector('components.Thing.button')).toContain("[data-testid='data-testid new thing button']");
  });

  it('falls back to the latest values when the version is not valid semver', () => {
    config.buildInfo.version = '1.0';
    expect(toGrafanaSelector('components.Thing.button')).toContain("[data-testid='data-testid new thing button']");
  });

  it('reverse-matches the value the running version renders', () => {
    config.buildInfo.version = '9.0.0';
    expect(findGrafanaSelectorPath(elementWithTestId('old thing button'))).toBe('grafana:components.Thing.button');
  });

  it('does not reverse-match a value from a different version', () => {
    config.buildInfo.version = '9.0.0';
    expect(findGrafanaSelectorPath(elementWithTestId('data-testid new thing button'))).toBeNull();
  });

  it('rebuilds the reverse index when the version changes', () => {
    config.buildInfo.version = '9.0.0';
    expect(findGrafanaSelectorPath(elementWithTestId('old thing button'))).toBe('grafana:components.Thing.button');

    config.buildInfo.version = '12.0.0';
    expect(findGrafanaSelectorPath(elementWithTestId('old thing button'))).toBeNull();
    expect(findGrafanaSelectorPath(elementWithTestId('data-testid new thing button'))).toBe(
      'grafana:components.Thing.button'
    );
  });
});

describe('grafana-selector — ambiguity rejection', () => {
  it('returns null for a value claimed by more than one selector path', () => {
    config.buildInfo.version = '12.0.0';
    expect(findGrafanaSelectorPath(elementWithTestId('data-testid shared value'))).toBeNull();
  });

  it('returns a unique template match with its parameter', () => {
    config.buildInfo.version = '12.0.0';
    expect(findGrafanaSelectorPath(elementWithTestId('data-testid thing row alpha'))).toBe(
      'grafana:components.Tpl.row:alpha'
    );
  });

  it('returns null when a value matches more than one template', () => {
    config.buildInfo.version = '12.0.0';
    expect(findGrafanaSelectorPath(elementWithTestId('data-testid thing row alpha end'))).toBeNull();
  });

  it('never treats an argument-ignoring selector function as a template', () => {
    // Pins the TEMPLATE_SENTINEL contract: the U+E000-delimited sentinel cannot
    // appear in a probe's output unless the function interpolates its argument,
    // so Static.label ('data-testid PARAM label') must not become a template
    // matching unrelated values of the shape 'data-testid ... label'.
    config.buildInfo.version = '12.0.0';
    expect(findGrafanaSelectorPath(elementWithTestId('data-testid foo label'))).toBeNull();
  });
});
