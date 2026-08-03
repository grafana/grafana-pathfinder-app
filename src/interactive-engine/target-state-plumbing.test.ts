/**
 * Tripwire for `executeInteractiveAction` call sites that forget `targetState`.
 *
 * The parameter list is positional and every argument is optional, so omitting
 * `targetState` compiles, passes unit tests, and silently reverts a toggle step
 * to blind clicking. That happened twice while building this feature: once in
 * `content-renderer`'s prop list, and once in the `'show'` calls, which were
 * skipped on the assumption that show mode never needs the state — it does, to
 * tell the user there is nothing to change.
 *
 * The invariant: a call threading step context far enough to pass
 * `targetComment` must also pass the state.
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(full);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Argument text of every `executeInteractiveAction(...)` invocation. */
function callSites(): Array<{ file: string; args: string }> {
  const sites: Array<{ file: string; args: string }> = [];

  for (const file of walk(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    let index = source.indexOf('executeInteractiveAction(');
    while (index !== -1) {
      // Skip the definition itself, which declares rather than passes.
      const preceding = source.slice(Math.max(0, index - 30), index);
      if (!/const\s+$/.test(preceding)) {
        let depth = 0;
        let cursor = index + 'executeInteractiveAction'.length;
        const start = cursor + 1;
        do {
          if (source[cursor] === '(') {
            depth++;
          } else if (source[cursor] === ')') {
            depth--;
          }
          cursor++;
        } while (depth > 0 && cursor < source.length);
        sites.push({ file: path.relative(SRC, file), args: source.slice(start, cursor - 1) });
      }
      index = source.indexOf('executeInteractiveAction(', index + 1);
    }
  }

  return sites;
}

describe('executeInteractiveAction targetState plumbing', () => {
  it('finds the call sites, so a rename cannot make this test vacuous', () => {
    expect(callSites().length).toBeGreaterThanOrEqual(6);
  });

  it('passes targetState wherever it passes targetComment', () => {
    const offenders = callSites()
      .filter((site) => /targetComment/.test(site.args) && !/targetState/.test(site.args))
      .map((site) => `${site.file}: executeInteractiveAction(${site.args.replace(/\s+/g, ' ').trim()})`);

    expect(offenders).toEqual([]);
  });
});
