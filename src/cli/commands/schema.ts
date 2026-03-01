/**
 * Schema Command
 *
 * Exports Zod schemas as JSON Schema for cross-language consumers.
 * Uses Zod v4's native z.toJSONSchema() for conversion.
 */

import { Command } from 'commander';
import { z } from 'zod';

import { JsonGuideSchemaStrict, JsonBlockSchema, CURRENT_SCHEMA_VERSION } from '../../types/json-guide.schema';
import {
  ContentJsonSchema,
  ManifestJsonObjectSchema,
  RepositoryJsonSchema,
  DependencyGraphSchema,
} from '../../types/package.schema';

interface SchemaRegistryEntry {
  schema: z.ZodType;
  description: string;
  refinements?: string[];
}

/**
 * Registry of named schemas available for export.
 * Keys are the public names used on the CLI.
 */
export const SCHEMA_REGISTRY: Record<string, SchemaRegistryEntry> = {
  guide: {
    schema: JsonGuideSchemaStrict,
    description: 'Root JSON guide schema (strict, no extra fields)',
    refinements: [
      "Non-noop actions require 'reftarget' (step and interactive blocks)",
      "formfill with validateInput requires 'targetvalue' (step and interactive blocks)",
    ],
  },
  block: {
    schema: JsonBlockSchema,
    description: 'Union of all block types with depth-limited nesting',
    refinements: [
      "Non-noop actions require 'reftarget'",
      "formfill with validateInput requires 'targetvalue'",
    ],
  },
  content: {
    schema: ContentJsonSchema,
    description: 'Content JSON schema (content.json in two-file packages)',
    refinements: [
      "Non-noop actions require 'reftarget' (in nested blocks)",
      "formfill with validateInput requires 'targetvalue' (in nested blocks)",
    ],
  },
  manifest: {
    schema: ManifestJsonObjectSchema,
    description: 'Manifest JSON schema (manifest.json, without cross-field refinement)',
  },
  repository: {
    schema: RepositoryJsonSchema,
    description: 'Repository index schema (repository.json)',
  },
  graph: {
    schema: DependencyGraphSchema,
    description: 'Dependency graph schema (D3-compatible output)',
  },
};

function convertSchema(entry: SchemaRegistryEntry, includeVersion: boolean): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(entry.schema) as Record<string, unknown>;

  if (entry.refinements && entry.refinements.length > 0) {
    jsonSchema['x-refinements'] = entry.refinements;
  }

  if (includeVersion) {
    jsonSchema['x-schema-version'] = CURRENT_SCHEMA_VERSION;
  }

  return jsonSchema;
}

export function listSchemas(): Array<{ name: string; description: string }> {
  return Object.entries(SCHEMA_REGISTRY).map(([name, entry]) => ({
    name,
    description: entry.description,
  }));
}

export function exportSchema(name: string, includeVersion: boolean): Record<string, unknown> | null {
  const entry = SCHEMA_REGISTRY[name];
  if (!entry) {
    return null;
  }
  return convertSchema(entry, includeVersion);
}

export function exportAllSchemas(includeVersion: boolean): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [name, entry] of Object.entries(SCHEMA_REGISTRY)) {
    result[name] = convertSchema(entry, includeVersion);
  }
  return result;
}

interface SchemaOptions {
  list?: boolean;
  all?: boolean;
  includeVersion?: boolean;
}

export const schemaCommand = new Command('schema')
  .description('Export Zod validation schemas as JSON Schema')
  .argument('[name]', 'Schema name to export')
  .option('--list', 'List available schema names with descriptions')
  .option('--all', 'Export all schemas as a single JSON object keyed by name')
  .option('--include-version', 'Include schema version in output metadata')
  .action((name: string | undefined, options: SchemaOptions) => {
    try {
      if (options.list) {
        const schemas = listSchemas();
        console.log(JSON.stringify(schemas, null, 2));
        return;
      }

      if (options.all) {
        const all = exportAllSchemas(!!options.includeVersion);
        console.log(JSON.stringify(all, null, 2));
        return;
      }

      if (!name) {
        console.error('Please specify a schema name, or use --list or --all');
        console.error('Available schemas: ' + Object.keys(SCHEMA_REGISTRY).join(', '));
        process.exit(1);
      }

      const schema = exportSchema(name, !!options.includeVersion);
      if (!schema) {
        console.error(`Unknown schema: "${name}"`);
        console.error('Available schemas: ' + Object.keys(SCHEMA_REGISTRY).join(', '));
        process.exit(1);
      }

      console.log(JSON.stringify(schema, null, 2));
    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
      process.exit(1);
    }
  });
