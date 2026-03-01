import { SCHEMA_REGISTRY, listSchemas, exportSchema, exportAllSchemas } from '../commands/schema';

const EXPECTED_SCHEMA_NAMES = ['guide', 'block', 'content', 'manifest', 'repository', 'graph'];

describe('schema command', () => {
  describe('SCHEMA_REGISTRY', () => {
    it('contains all expected schema names', () => {
      expect(Object.keys(SCHEMA_REGISTRY).sort()).toEqual([...EXPECTED_SCHEMA_NAMES].sort());
    });

    it.each(EXPECTED_SCHEMA_NAMES)('has a description for "%s"', (name) => {
      expect(SCHEMA_REGISTRY[name].description).toBeTruthy();
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

    it('omits x-refinements for schemas without refinements', () => {
      const schema = exportSchema('repository', false);
      expect(schema).not.toBeNull();
      expect(schema!['x-refinements']).toBeUndefined();
    });
  });

  describe('exportAllSchemas', () => {
    it('returns an object with all schema keys', () => {
      const all = exportAllSchemas(false);
      expect(Object.keys(all).sort()).toEqual([...EXPECTED_SCHEMA_NAMES].sort());
    });

    it('each schema is valid JSON Schema', () => {
      const all = exportAllSchemas(false);
      for (const name of EXPECTED_SCHEMA_NAMES) {
        expect(all[name]).toBeDefined();
        expect(all[name]['$schema']).toBeDefined();
      }
    });

    it('includes x-schema-version in all schemas when requested', () => {
      const all = exportAllSchemas(true);
      for (const name of EXPECTED_SCHEMA_NAMES) {
        expect(all[name]['x-schema-version']).toBeTruthy();
      }
    });
  });
});
