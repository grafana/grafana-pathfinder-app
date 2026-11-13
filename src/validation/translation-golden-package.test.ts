/**
 * The golden translation fixture against today's disk-facing tooling: a
 * package that ships `i18n/` validates and indexes as any other package, and
 * its sidecars read back through the one sidecar reader.
 */

import * as fs from 'fs';
import * as path from 'path';

import { buildRepository } from '../cli/commands/build-repository';
import { readPackageSidecars } from '../cli/utils/package-io';
import { serializeJson } from '../cli/utils/package-io/disk';
import { validatePackage } from './validate-package';

const FIXTURES = path.join(__dirname, '..', 'lib', 'guide-translation', 'fixtures');
const PACKAGES = path.join(FIXTURES, 'packages');
const PACKAGE_DIR = path.join(PACKAGES, 'translation-golden');

describe('golden translation fixture package', () => {
  it('validates with no errors or warnings, even in strict mode', () => {
    const result = validatePackage(PACKAGE_DIR, { strict: true });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.isValid).toBe(true);
  });

  it('indexes to the expected repository.json', () => {
    const { repository, errors, warnings } = buildRepository(PACKAGES);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'expected', 'repository.json'), 'utf-8'));
    expect(JSON.parse(JSON.stringify(repository))).toEqual(expected);
  });

  it('reads both sidecars through the sidecar reader', () => {
    const results = readPackageSidecars(PACKAGE_DIR);
    expect(results.map((result) => [result.tag, result.ok])).toEqual([
      ['ja', true],
      ['ja-JP', true],
    ]);
  });

  it('stores each sidecar exactly as the sidecar writer would', () => {
    for (const tag of ['ja', 'ja-JP']) {
      const raw = fs.readFileSync(path.join(PACKAGE_DIR, 'i18n', `${tag}.json`), 'utf-8');
      expect(serializeJson(JSON.parse(raw))).toBe(raw);
    }
  });
});
