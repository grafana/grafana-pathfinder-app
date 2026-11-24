/**
 * The route recipe and its invariants table name the Go tests that guard each rule. A renamed or deleted test
 * would leave agents trusting a guard that no longer exists, so every named test must still be defined.
 */

import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const PATTERN_DOC = 'docs/design/BACKEND_PROXY_PATTERN.md';

function goTestFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return goTestFiles(full);
    }
    return entry.name.endsWith('_test.go') ? [full] : [];
  });
}

describe('Backend route pattern doc', () => {
  it('names only Go tests that still exist', () => {
    const doc = fs.readFileSync(path.join(REPO_ROOT, PATTERN_DOC), 'utf8');
    const named = [...new Set([...doc.matchAll(/`(Test[A-Za-z0-9_]+)`/g)].map((match) => match[1]!))];
    expect(named.length).toBeGreaterThan(0);

    const defined = new Set(
      goTestFiles(path.join(REPO_ROOT, 'pkg')).flatMap((file) =>
        [...fs.readFileSync(file, 'utf8').matchAll(/^func (Test[A-Za-z0-9_]+)\(/gm)].map((match) => match[1]!)
      )
    );
    const missing = named.filter((name) => !defined.has(name));
    if (missing.length > 0) {
      throw new Error(
        [
          `${PATTERN_DOC} names Go tests that no file under pkg/ defines:`,
          ...missing.map((name) => `  - ${name}`),
          '',
          'Update the doc to the test that now guards the rule, or restore the test.',
        ].join('\n')
      );
    }
  });
});
