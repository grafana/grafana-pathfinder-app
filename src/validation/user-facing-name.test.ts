/**
 * @jest-environment node
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LOCALES_DIR = path.join(REPO_ROOT, 'src', 'locales');
const PROBE_PATH = 'src/user-facing-name-lint-probe.tsx';

const RUNNER = `
import { ESLint } from 'eslint';

const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfig: {
    languageOptions: {
      parserOptions: {
        project: null,
        projectService: { allowDefaultProject: [process.env.PROBE_PATH] },
      },
    },
  },
});

const sources = JSON.parse(process.env.PROBE_SOURCES);
const results = {};
for (const [name, source] of Object.entries(sources)) {
  const [result] = await eslint.lintText(source, { filePath: process.env.PROBE_PATH });
  results[name] = result.messages;
}
process.stdout.write(JSON.stringify(results));
`;

type LintMessage = { ruleId: string | null; message: string };

function lintProbes<K extends string>(sources: Record<K, string>): Record<K, LintMessage[]> {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', RUNNER], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    env: { ...process.env, PROBE_SOURCES: JSON.stringify(sources), PROBE_PATH },
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function leafStrings(node: unknown, keyPath: string[] = []): Array<[string, string]> {
  if (typeof node === 'string') {
    return [[keyPath.join('.'), node]];
  }
  if (node !== null && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) => leafStrings(value, [...keyPath, key]));
  }
  return [];
}

describe('user-facing product name', () => {
  describe('lint contract', () => {
    type ProbeName = 'jsxText' | 'jsxAttribute' | 'translationDefault' | 'internalUses';
    let results: Record<ProbeName, LintMessage[]>;

    beforeAll(() => {
      results = lintProbes({
        jsxText: `export const A = () => <p>Pathfinder brings help into Grafana.</p>;`,
        jsxAttribute: `export const A = () => <img alt="Pathfinder" aria-label="Pathfinder panel" />;`,
        translationDefault: `declare const t: (key: string, fallback: string) => string;\nvoid t('a.b', 'Enable Pathfinder');`,
        internalUses: `
declare const t: (key: string, fallback: string) => string;
const pathfinderEnabled = true;
console.log('[Pathfinder] booted', pathfinderEnabled);
export const A = () => <div data-pathfinder-content="" aria-label={t('pathfinder.disabled', 'Interactive learning is disabled')} />;
`,
      });
    });

    const pathfinderMessages = (name: ProbeName) =>
      results[name].filter((m) => m.ruleId === 'no-restricted-syntax' && m.message.includes('Interactive learning'));

    it('rejects "Pathfinder" in JSX text', () => {
      expect(pathfinderMessages('jsxText')).toHaveLength(1);
    });

    it('rejects "Pathfinder" in user-facing JSX attributes', () => {
      expect(pathfinderMessages('jsxAttribute')).toHaveLength(2);
    });

    it('rejects "Pathfinder" in t() default values', () => {
      expect(pathfinderMessages('translationDefault')).toHaveLength(1);
    });

    it('allows identifiers, keys, data attributes, and logs that keep the internal name', () => {
      expect(pathfinderMessages('internalUses')).toEqual([]);
    });
  });

  describe('locale catalogs', () => {
    const catalogs = fs
      .readdirSync(LOCALES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    it.each(catalogs)('%s contains no translated value that names Pathfinder', (locale) => {
      const file = path.join(LOCALES_DIR, locale, 'grafana-pathfinder-app.json');
      const offenders = leafStrings(JSON.parse(fs.readFileSync(file, 'utf-8')))
        .filter(([, value]) => /pathfinder/i.test(value))
        .map(([key]) => key);
      if (offenders.length > 0) {
        throw new Error(
          `${locale} values mention "Pathfinder": ${offenders.join(', ')}. Users know this plugin as ` +
            '"Interactive learning"; "Pathfinder" is the internal name. Rewrite the value (keep the key).'
        );
      }
    });
  });
});
