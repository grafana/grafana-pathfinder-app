import { SIDECAR_FINDING_CODES, SIDECAR_SEAM_CODES } from './codes';
import { SIDECAR_CHECKS } from './registry';
import { contextOf } from '../../test-utils/sidecar-check-context';

describe('sidecar check registry', () => {
  it('lists every v1 check in report order', () => {
    expect(SIDECAR_CHECKS.map((check) => check.id)).toEqual([
      'language-tag',
      'manifest-block-fields',
      'projection-conformance',
      'orphan-key',
      'source-hash',
      'translatable-ids',
      'text-dependent-selector',
    ]);
  });

  it('gives every check a distinct id', () => {
    const ids = SIDECAR_CHECKS.map((check) => check.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tags every pending stub with its issue', () => {
    for (const check of SIDECAR_CHECKS.filter((c) => c.pendingIssue !== undefined)) {
      expect(check.pendingIssue).toMatch(/^#\d+$/);
    }
  });

  it('keeps every stub silent until its check lands', () => {
    for (const check of SIDECAR_CHECKS.filter((c) => c.pendingIssue !== undefined)) {
      expect(check.run(contextOf([]))).toEqual([]);
    }
  });

  it('declares every code in the union once: a check owns it, or the seam does', () => {
    const owned = [...SIDECAR_CHECKS.flatMap((check) => check.codes), ...SIDECAR_SEAM_CODES];
    expect([...owned].sort()).toEqual([...SIDECAR_FINDING_CODES].sort());
    expect(new Set(owned).size).toBe(owned.length);
  });
});
