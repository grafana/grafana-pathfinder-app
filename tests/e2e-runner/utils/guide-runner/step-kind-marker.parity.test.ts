/**
 * Parity tripwire — every tracked step-type kind in `STEP_TYPE_SCHEMAS`
 * must set the shared `data-test-step-kind` root marker on its component,
 * and the e2e runner's discovery selector must be built from the
 * registry's `STEP_TYPE_KIND_KEYS` instead of a hardcoded kind list or
 * the old `data-testid^="interactive-step-"` prefix match.
 *
 * This locks in the fix for the confirmed step-discovery contract defect:
 * the old selector also matched the `interactive-step-completed-<id>`
 * badge (same prefix, different element) and had no way to recognize
 * quiz/terminal/terminal-connect/codeblock/challenge steps.
 *
 * Mirrors the pattern in `step-type-registry.test.ts` (data-driven schema
 * checks) and `content-renderer.registry-parity.test.ts` (source scanning).
 */

import * as fs from 'fs';
import * as path from 'path';

import { STEP_TYPE_SCHEMAS, type StepTypeKind } from '../../../../src/components/interactive-tutorial/step-type-registry';

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

  it('discovery.ts builds its step selector from STEP_TYPE_KIND_KEYS, not a hardcoded kind list', () => {
    const source = fs.readFileSync(DISCOVERY_FILE, 'utf8');
    expect(source).toMatch(/STEP_TYPE_KIND_KEYS/);
    expect(source).toMatch(/data-test-step-kind/);
  });

  it('discovery.ts no longer selects steps by the interactive-step- testid prefix', () => {
    const source = fs.readFileSync(DISCOVERY_FILE, 'utf8');
    expect(source).not.toMatch(/data-testid\^="interactive-step-"/);
  });
});
