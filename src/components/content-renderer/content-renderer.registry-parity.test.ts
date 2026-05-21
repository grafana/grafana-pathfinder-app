/**
 * Parity tripwire — keeps `content-renderer.tsx`'s parse-time
 * step-type recognition wired to the canonical `STEP_TYPE_PARSE_KEYS`
 * registry instead of a duplicated string set.
 *
 * Fails if anyone re-introduces a hardcoded `new Set([...string
 * literals...])` of step-type names in content-renderer. The fix is
 * always: import `STEP_TYPE_PARSE_KEYS` from
 * `components/interactive-tutorial` and pass it to `new Set(...)`.
 */

import * as fs from 'fs';
import * as path from 'path';

// Direct deep import mirrors content-renderer.tsx — the registry module
// is React-free, so the deep import keeps the parity test lightweight.
import { STEP_TYPE_PARSE_KEYS } from '../interactive-tutorial/step-type-registry';

const CONTENT_RENDERER = path.resolve(__dirname, 'content-renderer.tsx');

describe('content-renderer registry parity', () => {
  const source = fs.readFileSync(CONTENT_RENDERER, 'utf8');

  it('imports STEP_TYPE_PARSE_KEYS from the interactive-tutorial barrel', () => {
    expect(source).toMatch(/STEP_TYPE_PARSE_KEYS/);
  });

  it('declares INTERACTIVE_STEP_TYPES from STEP_TYPE_PARSE_KEYS, not from a hardcoded literal array', () => {
    // The legitimate form is `new Set<string>(STEP_TYPE_PARSE_KEYS)`.
    // A regression re-introduces literal step-type names alongside the
    // declaration. The check looks specifically at the line(s)
    // surrounding the `INTERACTIVE_STEP_TYPES` constant.
    const declaration = source.match(/INTERACTIVE_STEP_TYPES[\s\S]{0,400}/);
    expect(declaration).not.toBeNull();
    expect(declaration?.[0]).toContain('STEP_TYPE_PARSE_KEYS');
    // No hardcoded step-name literal between INTERACTIVE_STEP_TYPES and its closing `;`
    const stepNameRegex =
      /['"](interactive-step|interactive-multi-step|interactive-guided|quiz-block|terminal-step|terminal-connect-step|code-block-step|challenge-block)['"]/;
    expect(declaration?.[0]).not.toMatch(stepNameRegex);
  });

  it('does not contain a SECTION_TRACKED_STEP_TYPES constant — collapsed into INTERACTIVE_STEP_TYPES', () => {
    expect(source).not.toContain('SECTION_TRACKED_STEP_TYPES');
  });

  it('every registry parse-type key is a non-empty string', () => {
    STEP_TYPE_PARSE_KEYS.forEach((key) => {
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    });
  });
});
