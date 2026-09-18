import {
  REQUIREMENT_DESCRIPTIONS,
  REQUIREMENT_TOKEN_CATALOGUE,
  type RequirementTokenDoc,
} from '../../types/requirements.types';
import { SCHEMA_REGISTRY, listSchemas, exportSchema, exportAllSchemas } from '../commands/schema';

const EXPECTED_SCHEMA_NAMES = [
  'guide',
  'block',
  'content',
  'manifest',
  'repository',
  'graph',
  'e2e-report',
  'e2e-multi-report',
];

describe('schema command', () => {
  describe('SCHEMA_REGISTRY', () => {
    it('contains all expected schema names', () => {
      expect(Object.keys(SCHEMA_REGISTRY).sort()).toEqual([...EXPECTED_SCHEMA_NAMES].sort());
    });

    it.each(EXPECTED_SCHEMA_NAMES)('has a description for "%s"', (name) => {
      const entry = SCHEMA_REGISTRY[name];
      expect(entry).toBeDefined();
      expect(entry!.description).toBeTruthy();
    });
  });

  describe('listSchemas', () => {
    it('returns all expected schema names with descriptions', () => {
      const schemas = listSchemas();
      expect(schemas).toHaveLength(EXPECTED_SCHEMA_NAMES.length);
      for (const entry of schemas) {
        expect(entry.name).toBeTruthy();
        expect(entry.description).toBeTruthy();
        expect(EXPECTED_SCHEMA_NAMES).toContain(entry.name);
      }
    });
  });

  describe('exportSchema', () => {
    it.each(EXPECTED_SCHEMA_NAMES)('produces valid JSON Schema for "%s"', (name) => {
      const schema = exportSchema(name, false);
      expect(schema).not.toBeNull();
      expect(schema!['$schema']).toBeDefined();
    });

    it('returns null for unknown schema name', () => {
      expect(exportSchema('nonexistent', false)).toBeNull();
    });

    it('includes x-schema-version when --version is set', () => {
      const schema = exportSchema('guide', true);
      expect(schema).not.toBeNull();
      expect(schema!['x-schema-version']).toBeTruthy();
    });

    it('omits x-schema-version when --version is not set', () => {
      const schema = exportSchema('guide', false);
      expect(schema).not.toBeNull();
      expect(schema!['x-schema-version']).toBeUndefined();
    });

    it('includes x-refinements for schemas with refinements', () => {
      const schema = exportSchema('guide', false);
      expect(schema).not.toBeNull();
      expect(schema!['x-refinements']).toBeDefined();
      expect(Array.isArray(schema!['x-refinements'])).toBe(true);
      expect((schema!['x-refinements'] as string[]).length).toBeGreaterThan(0);
    });

    it('exports accurate challenge mode and snippet reference descriptions', () => {
      const schema = exportSchema('block', false);
      const serialized = JSON.stringify(schema);

      expect(serialized).toContain('Upstream snippet ID, resolved after validation and before render');
      expect(serialized).toContain("The schema has no default: JSON that omits mode resolves to 'coda' at runtime");
      expect(serialized).not.toContain('Upstream snippet ID to resolve at parse time');
      expect(serialized).not.toContain("'coda' (default)");
    });

    it('omits x-refinements for schemas without refinements', () => {
      const schema = exportSchema('repository', false);
      expect(schema).not.toBeNull();
      expect(schema!['x-refinements']).toBeUndefined();
    });

    // `RequirementTokenSchema` is a refined `z.string()`, so a `requirements` /
    // `conditions` field converts to `{ type: 'string' }` and the vocabulary it
    // actually accepts is invisible in the export. A consumer that reads only the
    // schema — the case this extension exists for — cannot author a valid guide
    // without it: a step with a `reftarget` needs `exists-reftarget`, and the
    // serialized schema does not contain that string anywhere else.
    describe('x-requirement-tokens', () => {
      it.each(['guide', 'block', 'content'])('publishes the whole vocabulary on "%s"', (name) => {
        const tokens = exportSchema(name, false)?.['x-requirement-tokens'] as RequirementTokenDoc[] | undefined;
        expect(tokens?.map((entry) => entry.token)).toEqual(REQUIREMENT_TOKEN_CATALOGUE.map((entry) => entry.token));
      });

      it.each(Object.keys(REQUIREMENT_DESCRIPTIONS))('serializes %s into the guide export', (token) => {
        expect(JSON.stringify(exportSchema('guide', true))).toContain(token);
      });

      it.each(['repository', 'graph', 'e2e-report'])('omits it from "%s", which takes no tokens', (name) => {
        expect(exportSchema(name, false)?.['x-requirement-tokens']).toBeUndefined();
      });
    });

    // Regression: see src/cli/commands/schema.ts `convertSchema`. The block
    // schema is recursive, so the default zod-to-JSON-Schema `reused: 'inline'`
    // emits ~28 MB of duplicated subtrees for content / block / guide. With
    // `reused: 'ref'` the same exports are ~35 KB. If this test starts failing
    // the new value is more useful than the threshold — investigate before
    // bumping the bound.
    it.each(['content', 'block', 'guide'])(
      'emits a bounded recursive schema for "%s" (no exponential inlining)',
      (name) => {
        const schema = exportSchema(name, false);
        expect(schema).not.toBeNull();
        const serialized = JSON.stringify(schema);
        // Empirical: content ~35 KB, block ~30 KB, guide ~40 KB with reused:'ref'.
        // Without it, all three explode to tens of megabytes. 200 KB gives plenty
        // of headroom for legitimate growth without re-admitting the OOM regression.
        expect(serialized.length).toBeLessThan(200_000);
      }
    );
  });

  describe('exportAllSchemas', () => {
    it('returns an object with all schema keys', () => {
      const all = exportAllSchemas(false);
      expect(Object.keys(all).sort()).toEqual([...EXPECTED_SCHEMA_NAMES].sort());
    });

    it('each schema is valid JSON Schema', () => {
      const all = exportAllSchemas(false);
      for (const name of EXPECTED_SCHEMA_NAMES) {
        const schema = all[name];
        expect(schema).toBeDefined();
        expect(schema!['$schema']).toBeDefined();
      }
    });

    it('includes x-schema-version in all schemas when requested', () => {
      const all = exportAllSchemas(true);
      for (const name of EXPECTED_SCHEMA_NAMES) {
        const schema = all[name];
        expect(schema).toBeDefined();
        expect(schema!['x-schema-version']).toBeTruthy();
      }
    });
  });
});
