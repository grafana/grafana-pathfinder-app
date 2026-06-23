/**
 * Cross-layer end-to-end test for reftarget fallback chains: author a guide with
 * an ordered `reftarget` array, parse it, and resolve it against the DOM through
 * the real selector pipeline. Proves the full path (schema/parser → runtime
 * union → selector-major resolver) without a browser.
 *
 * The motivating scenario: a guide authored in English targets a button by
 * visible text ("Save dashboard"), but the user runs Grafana in German so the
 * button reads "Speichern". The primary (visible-text) selector misses; the
 * stable `data-testid` fallback wins.
 */

import { parseJsonGuide } from './json-parser';
import { resolveWithRetry } from '../lib/dom/selector-retry';
import type { JsonGuide } from '../types/json-guide.types';

function refTargetFromGuide(guide: JsonGuide): string | string[] {
  const result = parseJsonGuide(guide);
  const step = result.data!.elements.find((el) => el.type === 'interactive-step');
  return step!.props.refTarget as string | string[];
}

describe('reftarget fallback chain — parse + resolve end to end', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('falls back from a locale-broken visible-text selector to a stable data-testid', async () => {
    // German locale: the button text is "Speichern", not "Save dashboard".
    document.body.innerHTML = '<button data-testid="save-dashboard">Speichern</button>';

    const guide: JsonGuide = {
      id: 'fallback-e2e',
      title: 'Fallback e2e',
      blocks: [
        {
          type: 'interactive',
          action: 'button',
          content: 'Save the dashboard',
          reftarget: ['Save dashboard', 'button[data-testid="save-dashboard"]'],
        },
      ],
    };

    const refTarget = refTargetFromGuide(guide);
    expect(refTarget).toEqual(['Save dashboard', 'button[data-testid="save-dashboard"]']);

    const resolved = await resolveWithRetry(refTarget, 'button', { delays: [] });

    expect(resolved).not.toBeNull();
    expect(resolved!.selectedIndex).toBe(1);
    expect(resolved!.element.getAttribute('data-testid')).toBe('save-dashboard');
  });

  it('uses the primary selector when it does resolve (English locale)', async () => {
    // English locale: the visible-text primary matches, so the fallback is never used.
    document.body.innerHTML = '<button data-testid="save-dashboard">Save dashboard</button>';

    const guide: JsonGuide = {
      id: 'fallback-e2e',
      title: 'Fallback e2e',
      blocks: [
        {
          type: 'interactive',
          action: 'button',
          content: 'Save the dashboard',
          reftarget: ['Save dashboard', 'button[data-testid="save-dashboard"]'],
        },
      ],
    };

    const resolved = await resolveWithRetry(refTargetFromGuide(guide), 'button', { delays: [] });

    expect(resolved).not.toBeNull();
    expect(resolved!.selectedIndex).toBe(0);
  });

  it('returns null when no selector in the chain resolves', async () => {
    document.body.innerHTML = '<button data-testid="something-else">Other</button>';

    const guide: JsonGuide = {
      id: 'fallback-e2e',
      title: 'Fallback e2e',
      blocks: [
        {
          type: 'interactive',
          action: 'button',
          content: 'Save the dashboard',
          reftarget: ['Save dashboard', 'button[data-testid="save-dashboard"]'],
        },
      ],
    };

    const resolved = await resolveWithRetry(refTargetFromGuide(guide), 'button', { delays: [] });
    expect(resolved).toBeNull();
  });
});
