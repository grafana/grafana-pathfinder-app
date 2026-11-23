/**
 * Guide translations flag ownership guard
 *
 * `pathfinder.guide-translations` is the release gate for translated guides
 * (docs/design/I18N.md). The registry in src/utils/openfeature.ts declares it
 * and src/utils/guide-translations-enablement.ts is the one reader. Any other
 * module that names the flag, by literal or by the exported
 * GUIDE_TRANSLATIONS_FLAG constant, can read the gate without going through
 * the accessor.
 */

import * as fs from 'fs';
import * as path from 'path';

import { SRC_DIR, collectSourceFiles, isTestFile, toPosixPath } from './import-graph';

const OWNERS = new Set(['utils/openfeature.ts', 'utils/guide-translations-enablement.ts']);

const FLAG_NAMES = [/pathfinder\.guide-translations(?![\w-])/, /\bGUIDE_TRANSLATIONS_FLAG\b/];

const ADVICE =
  'Only the flag registry and src/utils/guide-translations-enablement.ts may name the guide translations flag. ' +
  'Readers must call isGuideTranslationsEnabled() instead of reading the flag. ' +
  'To change the default or add an owner, do it in the release-gate change, and update OWNERS here and docs/design/I18N.md together.';

function filesNamingTheFlag(): string[] {
  return collectSourceFiles()
    .filter((file) => !isTestFile(file))
    .map((file) => ({ relPath: toPosixPath(path.relative(SRC_DIR, file)), text: fs.readFileSync(file, 'utf-8') }))
    .filter(({ relPath }) => !OWNERS.has(relPath))
    .filter(({ text }) => FLAG_NAMES.some((pattern) => pattern.test(text)))
    .map(({ relPath }) => `src/${relPath}`);
}

describe('guide translations flag ownership', () => {
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
    expect(matches("getFlag('pathfinder.guide-translations')")).toBe(true);
    expect(matches("getFlag('pathfinder.guide-translations-ai')")).toBe(false);
  });
});
