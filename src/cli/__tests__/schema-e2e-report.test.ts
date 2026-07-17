/**
 * The E2E report schema must be exportable as JSON Schema from the CLI so the
 * runner image is self-describing: the orchestrator extracts the exact contract
 * via `pathfinder-cli schema e2e-report`.
 */

import { exportSchema, listSchemas } from '../commands/schema';

describe('schema command — e2e-report registration', () => {
  it('lists the e2e report schemas', () => {
    const names = listSchemas().map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['e2e-report', 'e2e-multi-report']));
  });

  it('exports a valid JSON Schema with the versioned $id and version metadata', () => {
    const schema = exportSchema('e2e-report', true);

    expect(schema).not.toBeNull();
    expect(String(schema?.$id)).toContain('e2e-test-report-1.0.0');
    expect(schema?.['x-schema-version']).toBe('1.0.0');
  });

  it('exports the multi-guide report schema without throwing', () => {
    expect(() => exportSchema('e2e-multi-report', false)).not.toThrow();
    expect(exportSchema('e2e-multi-report', false)).not.toBeNull();
  });
});
