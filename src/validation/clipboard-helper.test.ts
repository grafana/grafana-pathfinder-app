/**
 * Clipboard helper ratchet
 *
 * `navigator.clipboard` is undefined on plain-HTTP origins and in some embedded
 * browsers, and `navigator.clipboard.writeText(...)` then throws synchronously,
 * so a `.then()`/`.catch()` chained on it never runs and the copy button does
 * nothing (#2076). Copies go through `copyTextToClipboard` in
 * src/lib/clipboard.ts, which resolves to a boolean instead of throwing.
 *
 * This guard flags any other production file that touches
 * `navigator.clipboard` directly. The allowlist holds the sites that `await`
 * the call inside a try/catch in an async function, which already catches the
 * synchronous throw; it can only shrink.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  ARCHITECTURE_BY_DESIGN,
  SRC_DIR,
  assertRatchet,
  collectSourceFiles,
  isTestFile,
  toPosixPath,
  validateAllowedArchitectureEntries,
  type AllowedArchitectureEntry,
} from './import-graph';

const HELPER = 'lib/clipboard.ts';

const AWAITED_IN_TRY =
  'Awaits writeText inside try/catch in an async function, which already catches the synchronous throw.';

const ALLOWED_DIRECT_CLIPBOARD_CALLS: readonly AllowedArchitectureEntry[] = [
  {
    violation: 'components/block-editor/utils/github-pr.ts',
    reason: AWAITED_IN_TRY,
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'components/interactive-tutorial/terminal-step.tsx',
    reason: AWAITED_IN_TRY,
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  { violation: 'components/kiosk/KioskPage.tsx', reason: AWAITED_IN_TRY, tracking: ARCHITECTURE_BY_DESIGN },
  {
    violation: 'components/LiveSession/PresenterControls.tsx',
    reason: AWAITED_IN_TRY,
    tracking: ARCHITECTURE_BY_DESIGN,
  },
  {
    violation: 'docs-retrieval/components/docs/code-block.tsx',
    reason: AWAITED_IN_TRY,
    tracking: ARCHITECTURE_BY_DESIGN,
  },
];

const DIRECT_CLIPBOARD_RE = /\bnavigator\s*\.\s*clipboard\b/;

function findDirectClipboardCalls(): Set<string> {
  const violations = new Set<string>();
  for (const file of collectSourceFiles()) {
    if (isTestFile(file)) {
      continue;
    }
    const relative = toPosixPath(path.relative(SRC_DIR, file));
    if (relative === HELPER) {
      continue;
    }
    const source = fs.readFileSync(file, 'utf-8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    if (DIRECT_CLIPBOARD_RE.test(source)) {
      violations.add(relative);
    }
  }
  return violations;
}

describe('clipboard helper ratchet', () => {
  const violations = findDirectClipboardCalls();
  const allowlist = new Set(ALLOWED_DIRECT_CLIPBOARD_CALLS.map((entry) => entry.violation));

  it('every allowlist entry is justified', () => {
    expect(validateAllowedArchitectureEntries(ALLOWED_DIRECT_CLIPBOARD_CALLS, { allowByDesign: true })).toEqual([]);
  });

  it('no new direct navigator.clipboard use outside src/lib/clipboard.ts', () => {
    assertRatchet(
      violations,
      allowlist,
      'direct navigator.clipboard use',
      'ALLOWED_DIRECT_CLIPBOARD_CALLS',
      'Use copyTextToClipboard from src/lib/clipboard.ts. A raw navigator.clipboard.writeText(...) throws ' +
        'synchronously when the clipboard API is missing, so chained .then()/.catch() handlers never run (#2076).'
    );
  });

  it('the helper itself still exists', () => {
    expect(fs.existsSync(path.join(SRC_DIR, HELPER))).toBe(true);
  });
});
