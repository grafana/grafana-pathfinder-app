/**
 * Parity tripwire — every tracked step-type kind in `STEP_TYPE_SCHEMAS`
 * must set the shared `data-test-step-kind` root marker on its component,
 * AND the e2e runner's discovery selector must be built from the explicit
 * `EXECUTABLE_STEP_KINDS` boundary (guide-runner/types.ts) rather than a
 * hardcoded kind list or the full registry kind list.
 *
 * This locks in the fix for the confirmed step-discovery contract defect:
 * the old selector matched the `interactive-step-completed-<id>` badge
 * (same prefix, different element). It also locks in the executable-kind
 * boundary: quiz/terminal/terminal-connect/codeblock/challenge steps carry
 * the marker (so the plugin-side contract is uniform across all 8 kinds),
 * but the runner deliberately excludes them from discovery because
 * execution.ts's generic "Do it"/completion-badge executor doesn't know how
 * to drive their kind-specific UI. See EXECUTABLE_STEP_KINDS for the list
 * to extend when execution support for a new kind is added.
 *
 * `discovery.ts` still falls back to the legacy `interactive-step-` prefix
 * selector when the marker selector finds nothing, for compatibility with
 * a deployed plugin build that predates the marker (runner/plugin version
 * skew). This test asserts the marker selector is tried first and that the
 * legacy fallback excludes the completed-step badge — it does not require
 * the legacy selector to be absent.
 *
 * Mirrors the pattern in `step-type-registry.test.ts` (data-driven schema
 * checks) and `content-renderer.registry-parity.test.ts` (source scanning).
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  STEP_TYPE_SCHEMAS,
  STEP_TYPE_KIND_KEYS,
  type StepTypeKind,
} from '../../../../src/components/interactive-tutorial/step-type-registry';
import { EXECUTABLE_STEP_KINDS } from './types';

const INTERACTIVE_TUTORIAL_DIR = path.resolve(__dirname, '../../../../src/components/interactive-tutorial');
const DISCOVERY_FILE = path.resolve(__dirname, 'discovery.ts');

/** Maps each tracked step kind to the component file that renders its root element. */
const KIND_TO_COMPONENT_FILE: Record<StepTypeKind, string> = {
  plain: 'interactive-step.tsx',
  multistep: 'interactive-multi-step.tsx',
  guided: 'interactive-guided.tsx',
  quiz: 'interactive-quiz.tsx',
  terminal: 'terminal-step.tsx',
  'terminal-connect': 'terminal-connect-step.tsx',
  codeblock: 'code-block-step.tsx',
  challenge: 'challenge-block.tsx',
};

/** Kinds intentionally left outside the executable-kind boundary today. */
const DEFERRED_KINDS = ['quiz', 'terminal', 'terminal-connect', 'codeblock', 'challenge'];

describe('step-kind marker parity (runner discovery contract)', () => {
  it('maps every STEP_TYPE_SCHEMAS entry to a component file (fails if a kind is added without updating this test)', () => {
    const mappedKinds = Object.keys(KIND_TO_COMPONENT_FILE).sort();
    const registryKinds = STEP_TYPE_SCHEMAS.map((s) => s.kind).sort();
    expect(mappedKinds).toEqual(registryKinds);
  });

  it.each(STEP_TYPE_SCHEMAS)('$kind: component sets data-test-step-kind on its root element', (schema) => {
    const filePath = path.join(INTERACTIVE_TUTORIAL_DIR, KIND_TO_COMPONENT_FILE[schema.kind]);
    const source = fs.readFileSync(filePath, 'utf8');
    expect(source).toMatch(/data-test-step-kind=\{/);
    expect(source).toContain('.kind}');
  });

  it('EXECUTABLE_STEP_KINDS is exactly plain/multistep/guided — the deferred kinds are quiz/terminal/terminal-connect/codeblock/challenge', () => {
    expect([...EXECUTABLE_STEP_KINDS].sort()).toEqual(['guided', 'multistep', 'plain']);
    const deferred = STEP_TYPE_KIND_KEYS.filter((k) => !(EXECUTABLE_STEP_KINDS as readonly string[]).includes(k));
    expect(deferred.sort()).toEqual([...DEFERRED_KINDS].sort());
  });

  it('discovery.ts builds its step selector from EXECUTABLE_STEP_KINDS (types.ts), not a hardcoded kind list or the full registry', () => {
    const source = fs.readFileSync(DISCOVERY_FILE, 'utf8');
    expect(source).toMatch(/EXECUTABLE_STEP_KINDS/);
    expect(source).not.toMatch(/STEP_TYPE_KIND_KEYS/);
    expect(source).toMatch(/data-test-step-kind/);
  });

  it('discovery.ts tries the marker selector before the legacy testid-prefix fallback', () => {
    const source = fs.readFileSync(DISCOVERY_FILE, 'utf8');
    const markerCallIndex = source.indexOf('page.locator(STEP_KIND_SELECTOR)');
    const legacyCallIndex = source.indexOf('page.locator(LEGACY_STEP_SELECTOR)');
    expect(markerCallIndex).toBeGreaterThan(-1);
    expect(legacyCallIndex).toBeGreaterThan(-1);
    expect(markerCallIndex).toBeLessThan(legacyCallIndex);
    // The fallback call must be conditioned on the marker selector finding nothing.
    const betweenCalls = source.slice(markerCallIndex, legacyCallIndex);
    expect(betweenCalls).toMatch(/stepElements\.length === 0/);
  });

  it('discovery.ts legacy fallback selector excludes the completed-step badge', () => {
    const source = fs.readFileSync(DISCOVERY_FILE, 'utf8');
    expect(source).toMatch(
      /LEGACY_STEP_SELECTOR\s*=\s*'\[data-testid\^="interactive-step-"\]:not\(\[data-testid\^="interactive-step-completed-"\]\)'/
    );
  });
});
