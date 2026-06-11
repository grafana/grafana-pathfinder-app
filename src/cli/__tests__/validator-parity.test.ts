/**
 * Validator parity test.
 *
 * The CLI has two validation surfaces that overlap by design:
 *  - `validatePackage(dir)` (src/validation/validate-package.ts) — disk
 *    validator used by the CLI `validate` command. Adds asset-reference and
 *    testEnvironment checks the in-memory variant doesn't perform.
 *  - `validatePackageState(content, manifest)` (src/cli/utils/package-io/
 *    state-validation.ts) — in-memory validator that every authoring write
 *    and the MCP `pathfinder_validate` tool route through.
 *
 * The team accepts that these have different scopes. What this test pins is
 * the overlap: on the bundled corpus, the two validators must agree on the
 * top-level validity verdict and on id mismatches. If one starts rejecting a
 * package the other accepts, this fails and forces a deliberate decision.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { ContentJson, ManifestJson } from '../../types/package.types';
import { validatePackage } from '../../validation/validate-package';
import { validatePackageState } from '../utils/package-io';

const BUNDLED_DIR = path.resolve(__dirname, '../../bundled-interactives');

function listPackages(): Array<{ name: string; dir: string }> {
  return fs
    .readdirSync(BUNDLED_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, dir: path.join(BUNDLED_DIR, entry.name) }))
    .filter(({ dir }) => fs.existsSync(path.join(dir, 'content.json')) && fs.existsSync(path.join(dir, 'manifest.json')));
}

describe('validator parity on bundled corpus', () => {
  const packages = listPackages();

  it('finds at least one bundled package to compare against', () => {
    expect(packages.length).toBeGreaterThan(0);
  });

  for (const { name, dir } of packages) {
    describe(name, () => {
      const diskResult = validatePackage(dir);
      const content = JSON.parse(fs.readFileSync(path.join(dir, 'content.json'), 'utf-8')) as ContentJson;
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8')) as ManifestJson;
      const stateOutcome = validatePackageState(content, manifest);

      it('disk validator and in-memory validator agree on top-level validity', () => {
        expect(stateOutcome.ok).toBe(diskResult.isValid);
      });

      it('both validators agree on id mismatch detection', () => {
        const diskHasIdMismatch = diskResult.errors.some((e) => e.code === 'id_mismatch');
        const stateHasIdMismatch = stateOutcome.issues.some((i) => i.code === 'ID_MISMATCH');
        expect(stateHasIdMismatch).toBe(diskHasIdMismatch);
      });
    });
  }
});

describe('validator parity — synthetic divergence cases', () => {
  it('both reject a package whose manifest id differs from content id', () => {
    const content: ContentJson = {
      id: 'real-id',
      title: 'Test',
      blocks: [{ type: 'markdown', content: '# Hello' }],
    } as ContentJson;
    const manifest = {
      id: 'wrong-id',
      type: 'guide',
      description: 'd',
      category: 'c',
      targeting: { match: { urlPrefix: '/' } },
    } as ManifestJson;

    const stateOutcome = validatePackageState(content, manifest);
    expect(stateOutcome.ok).toBe(false);
    expect(stateOutcome.issues.some((i) => i.code === 'ID_MISMATCH')).toBe(true);

    // Mirror on disk for the disk validator.
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'parity-mismatch-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'content.json'), JSON.stringify(content));
      fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest));
      const diskResult = validatePackage(tmpDir);
      expect(diskResult.isValid).toBe(false);
      expect(diskResult.errors.some((e) => e.code === 'id_mismatch')).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
