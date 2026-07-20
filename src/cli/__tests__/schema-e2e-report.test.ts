/**
 * The E2E report schema must be exportable as JSON Schema from the CLI so the
 * runner image is self-describing: the orchestrator extracts the exact contract
 * via `pathfinder-cli schema e2e-report`.
 */

import Ajv2020 from 'ajv/dist/2020';
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

  it('produces ajv-compilable JSON Schema for e2e-report and e2e-multi-report', () => {
    const ajv = new Ajv2020({ strict: false });
    expect(() => ajv.compile(exportSchema('e2e-report', false)!)).not.toThrow();
    expect(() => ajv.compile(exportSchema('e2e-multi-report', false)!)).not.toThrow();
  });

  it('exports open-world schemas (no additionalProperties: false) for independent deployability', () => {
    const hasAdditionalPropertiesFalse = (node: unknown): boolean => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) {
        return false;
      }
      const obj = node as Record<string, unknown>;
      if (obj['additionalProperties'] === false) {
        return true;
      }
      return Object.values(obj).some(hasAdditionalPropertiesFalse);
    };
    expect(hasAdditionalPropertiesFalse(exportSchema('e2e-report', false))).toBe(false);
    expect(hasAdditionalPropertiesFalse(exportSchema('e2e-multi-report', false))).toBe(false);
  });
});
