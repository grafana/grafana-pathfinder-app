/**
 * Warning routing, proven against the real `validatePackage` with the check
 * registry replaced: no shipped check emits a warning yet (#2387 and #2388
 * add them), and the routing is the seam's contract, not theirs.
 */

import * as fs from 'fs';

import { validatePackage } from '../validate-package';
import { createTmpDir, sidecarJson, writePackage } from '../../test-utils/sidecar-package-fixture';
import type { SidecarCheckContext, SidecarFinding } from './types';

const mockRun = jest.fn<SidecarFinding[], [SidecarCheckContext]>();

jest.mock('./registry', () => ({
  SIDECAR_CHECKS: [{ id: 'fake', codes: [], run: (context: SidecarCheckContext) => mockRun(context) }],
}));

const STALE: SidecarFinding = {
  severity: 'warn',
  code: 'sidecar_stale_translation',
  message: 'i18n/ja.json: block "intro" is stale',
  path: ['i18n/ja.json', 'blocks', 'intro'],
  remediation: 'pathfinder-cli sync-translations <dir>',
};

describe('validatePackage — sidecar warnings', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTmpDir();
    mockRun.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('keeps --strict green when the only sidecar findings are warnings', () => {
    mockRun.mockReturnValue([STALE, { ...STALE, code: 'sidecar_orphan_key', path: ['i18n/ja.json', 'blocks', 'old'] }]);
    const dir = writePackage(tmpDir, 'warn-only', { ja: sidecarJson('ja') });

    const result = validatePackage(dir, { strict: true });

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.messages).toEqual(
      expect.arrayContaining([
        {
          severity: 'warn',
          message: STALE.message,
          path: STALE.path,
          remediation: 'pathfinder-cli sync-translations <dir>',
          code: 'sidecar_stale_translation',
        },
      ])
    );
    expect(result.messages.filter((m) => m.severity === 'warn' && m.path?.[0] === 'i18n/ja.json')).toHaveLength(2);
  });

  it('fails the package on a sidecar error, in strict mode or not', () => {
    mockRun.mockReturnValue([
      { severity: 'error', code: 'sidecar_structural_field', message: 'i18n/ja.json: bad', path: ['i18n/ja.json'] },
    ]);
    const dir = writePackage(tmpDir, 'error', { ja: sidecarJson('ja') });

    expect(validatePackage(dir).isValid).toBe(false);
    expect(validatePackage(dir, { strict: true }).isValid).toBe(false);
  });

  it('runs no check for a package with no sidecars', () => {
    mockRun.mockReturnValue([STALE]);
    const result = validatePackage(writePackage(tmpDir, 'plain'), { strict: true });

    expect(mockRun).not.toHaveBeenCalled();
    expect(result.isValid).toBe(true);
  });

  it('runs the checks once per package, with the parsed content and the sidecars', () => {
    mockRun.mockReturnValue([]);
    validatePackage(writePackage(tmpDir, 'once', { ja: sidecarJson('ja'), es: sidecarJson('es') }));

    expect(mockRun).toHaveBeenCalledTimes(1);
    const context = mockRun.mock.calls[0]![0];
    expect(context.content.id).toBe('once');
    expect(context.manifest).toBeUndefined();
    expect(context.sidecars.map((s) => s.tag)).toEqual(['es', 'ja']);
  });
});
