/**
 * Learn journey flag ownership guard
 *
 * `pathfinder.learn-journey-mode` is the release gate for Grafana Learn
 * journeys (docs/design/GRAFANA_LEARN.md). The registry in
 * src/utils/openfeature.ts declares it and src/utils/learn-journey-mode.ts is
 * the one reader. Any other module that names the flag, by literal or by the
 * exported LEARN_JOURNEY_MODE_FLAG constant, can read the gate without going
 * through the accessor, and a second reader is how a gate-off path stops being
 * today's behavior.
 */

import * as fs from 'fs';
import * as path from 'path';

import { SRC_DIR, collectSourceFiles, isTestFile, toPosixPath } from './import-graph';

const OWNERS = new Set(['utils/openfeature.ts', 'utils/learn-journey-mode.ts']);

const FLAG_NAMES = [/pathfinder\.learn-journey-mode(?![\w-])/, /\bLEARN_JOURNEY_MODE_FLAG\b/];

const ADVICE =
  'Only the flag registry and src/utils/learn-journey-mode.ts may name the Learn journey flag. ' +
  'Readers must call isLearnJourneyModeEnabled() or isLearnJourneyModeUrl() instead of reading the flag. ' +
  'To change the default or add an owner, do it in the release-gate change, and update OWNERS here and docs/design/GRAFANA_LEARN.md together.';

function filesNamingTheFlag(): string[] {
  return collectSourceFiles()
    .filter((file) => !isTestFile(file))
    .map((file) => ({ relPath: toPosixPath(path.relative(SRC_DIR, file)), text: fs.readFileSync(file, 'utf-8') }))
    .filter(({ relPath }) => !OWNERS.has(relPath))
    .filter(({ text }) => FLAG_NAMES.some((pattern) => pattern.test(text)))
    .map(({ relPath }) => `src/${relPath}`);
}

describe('Learn journey flag ownership', () => {
  it('names the flag only in the registry and the enablement accessor', () => {
    const offenders = filesNamingTheFlag();
    if (offenders.length > 0) {
      throw new Error(`${offenders.join('\n')}\n\n${ADVICE}`);
    }
  });

  it('still finds the flag in both owners, so the scan cannot pass vacuously', () => {
    for (const owner of OWNERS) {
      const text = fs.readFileSync(path.join(SRC_DIR, owner), 'utf-8');
      expect(FLAG_NAMES.some((pattern) => pattern.test(text))).toBe(true);
    }
  });

  it('reports the exact flag name but not a sibling flag that extends it', () => {
    const matches = (text: string) => FLAG_NAMES.some((pattern) => pattern.test(text));
    expect(matches("getFlag('pathfinder.learn-journey-mode')")).toBe(true);
    expect(matches("getFlag('pathfinder.learn-journey-mode-ai')")).toBe(false);
  });
});
