/**
 * Schema Command
 *
 * Exports Zod schemas as JSON Schema for cross-language consumers.
 * Uses Zod v4's native z.toJSONSchema() for conversion.
 */

import { z } from 'zod';

import { defineCommand, mountCommander } from '../contracts';
import type { CommandOutcome } from '../utils/output';
import { JsonGuideSchemaStrict, JsonBlockSchema, CURRENT_SCHEMA_VERSION } from '../../types/json-guide.schema';
import {
  ContentJsonSchema,
  ManifestJsonObjectSchema,
  RepositoryJsonSchema,
  DependencyGraphSchema,
} from '../../types/package.schema';
import {
  E2ETestReportSchema,
  MultiGuideReportSchema,
  E2E_REPORT_SCHEMA_VERSION,
  E2E_REPORT_SCHEMA_ID,
  E2E_MULTI_REPORT_SCHEMA_ID,
} from '../e2e/schemas/e2e-report.schema';

interface SchemaRegistryEntry {
  schema: z.ZodType;
  description: string;
  refinements?: string[];
  /** Canonical JSON Schema `$id`. Zod does not surface `.meta({ id })` as `$id` for a directly-converted schema. */
  id?: string;
  /** Version stamped as `x-schema-version`; defaults to the guide schema version. */
  schemaVersion?: string;
  /** When true, strips `additionalProperties: false` from the exported JSON Schema so additive fields are non-breaking. */
  openWorld?: boolean;
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
      "'dataCheck*' fields require inputType 'datasource' (input blocks)",
      "'dataCheck*' fields other than 'dataCheckQuery' require 'dataCheckQuery' (input blocks)",
    ],
  },
  block: {
    schema: JsonBlockSchema,
    description: 'Union of all block types with depth-limited nesting',
    refinements: [
      "Non-noop actions require 'reftarget'",
      "formfill with validateInput requires 'targetvalue'",
      "'dataCheck*' fields require inputType 'datasource'",
      "'dataCheck*' fields other than 'dataCheckQuery' require 'dataCheckQuery'",
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
    refinements: [
      '"milestones" must be a non-empty array when type is "path" or "journey"',
      '"milestones" is only valid when type is "path" or "journey" — type must be "path" or "journey" when milestones is present',
      'Package IDs listed in "milestones" must not also appear in "recommends", "suggests", or "depends"',
    ],
  },
  repository: {
    schema: RepositoryJsonSchema,
    description: 'Repository index schema (repository.json)',
  },
  graph: {
    schema: DependencyGraphSchema,
    description: 'Dependency graph schema (D3-compatible output)',
  },
  'e2e-report': {
    schema: E2ETestReportSchema,
    description: 'E2E single-guide test report',
    id: E2E_REPORT_SCHEMA_ID,
    schemaVersion: E2E_REPORT_SCHEMA_VERSION,
    openWorld: true,
  },
  'e2e-multi-report': {
    schema: MultiGuideReportSchema,
    description: 'E2E multi-guide aggregate test report',
    id: E2E_MULTI_REPORT_SCHEMA_ID,
    schemaVersion: E2E_REPORT_SCHEMA_VERSION,
    openWorld: true,
  },
};

function stripAdditionalPropertiesFalse(node: unknown): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return;
  }
  const obj = node as Record<string, unknown>;
  if (obj['additionalProperties'] === false) {
    delete obj['additionalProperties'];
  }
  for (const value of Object.values(obj)) {
    stripAdditionalPropertiesFalse(value);
  }
}

function convertSchema(entry: SchemaRegistryEntry, includeVersion: boolean): Record<string, unknown> {
  // reused: 'ref' is load-bearing. The block schema is recursive (sections /
  // multisteps / conditionals can each contain blocks), so the default
  // `reused: 'inline'` produces ~28 MB of duplicated subtrees for content /
  // block / guide — enough to OOM a 1 GiB Cloud Run instance during a single
  // tool call. Emitting $defs + $ref keeps the same output under ~35 KB.
  const jsonSchema = z.toJSONSchema(entry.schema, { reused: 'ref' }) as Record<string, unknown>;

  if (entry.openWorld) {
    stripAdditionalPropertiesFalse(jsonSchema);
  }

  if (entry.id) {
    jsonSchema.$id = entry.id;
  }

  if (entry.refinements && entry.refinements.length > 0) {
    jsonSchema['x-refinements'] = entry.refinements;
  }

  if (includeVersion) {
    jsonSchema['x-schema-version'] = entry.schemaVersion ?? CURRENT_SCHEMA_VERSION;
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

const SCHEMA_NAMES = Object.keys(SCHEMA_REGISTRY);

export const SchemaCommand = z.object({
  name: z.string().optional().describe('Schema name to export').meta({ role: 'addressing' }),
  list: z.boolean().optional().describe('List available schema names with descriptions').meta({ role: 'control' }),
  all: z
    .boolean()
    .optional()
    .describe('Export all schemas as a single JSON object keyed by name')
    .meta({ role: 'control' }),
  includeVersion: z
    .boolean()
    .optional()
    .describe('Include schema version in output metadata')
    .meta({ role: 'control' }),
});

export type SchemaInput = z.output<typeof SchemaCommand>;

/**
 * Export one schema, all of them, or the index.
 *
 * `artifact` is what the CLI writes to stdout, `data` the envelope an agent reads.
 * They differ deliberately: a redirected file should hold the schema and nothing else,
 * while an agent benefits from being told which schema it got and what else exists.
 * Deciding both here is what stopped the MCP tool re-deciding the same three cases.
 */
export function runSchema(input: SchemaInput): CommandOutcome {
  const includeVersion = input.includeVersion === true;

  if (input.list === true) {
    const schemas = listSchemas();
    return {
      status: 'ok',
      summary: `${schemas.length} schemas available`,
      artifact: schemas,
      data: { schemas },
    };
  }

  if (input.all === true) {
    const schemas = exportAllSchemas(includeVersion);
    return {
      status: 'ok',
      summary: `Exported ${Object.keys(schemas).length} schemas`,
      artifact: schemas,
      data: { schemas, available: SCHEMA_NAMES },
    };
  }

  if (input.name === undefined) {
    return {
      status: 'error',
      code: 'MISSING_NAME',
      // Named, not spelled as flags: one runner serves both entrypoints, and `--list`
      // would be the wrong vocabulary for an agent (§2).
      message: `Please specify a schema name, or set "list" or "all". Available: ${SCHEMA_NAMES.join(', ')}.`,
    };
  }

  const schema = exportSchema(input.name, includeVersion);
  if (!schema) {
    return {
      status: 'error',
      code: 'UNKNOWN_SCHEMA',
      message: `Unknown schema "${input.name}". Available: ${SCHEMA_NAMES.join(', ')}.`,
    };
  }

  return {
    status: 'ok',
    summary: `Exported ${input.name} schema`,
    artifact: schema,
    data: { name: input.name, schema },
  };
}

export const schemaSpec = defineCommand({
  name: 'schema',
  summary: 'Export Zod validation schemas as JSON Schema',
  schema: SchemaCommand,
  emits: 'artifact',
  run: runSchema,
});

export const schemaCommand = mountCommander(schemaSpec, { positionals: ['name'] });
