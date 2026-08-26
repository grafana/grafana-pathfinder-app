/**
 * Go <-> TypeScript contract ratchet for the four App Platform response
 * envelopes: `/package-recommendations`, `/custom-guide-repository`,
 * `/completion-records/my`, `/completion-records/capability`.
 *
 * The boundary is a process boundary, so no compiler can couple the two
 * descriptions of these shapes. `pkg/plugin/contract_fixtures_test.go` captures
 * real handler responses plus a reflected struct-tag inventory into
 * `pkg/plugin/testdata/contract/`; this test reads those committed bytes and
 * holds them against `src/types/backend-api.schema.ts`. A Go-side envelope
 * change therefore surfaces as a TypeScript failure that names the field.
 *
 * Everything is derived from the goldens and the exported schema registry —
 * there is no hand-written list of fixtures to fall out of date, and every
 * enumeration throws when it comes back empty rather than passing vacuously
 * (the shape `control-bytes.test.ts` establishes).
 */

import * as fs from 'fs';
import * as path from 'path';

import { z } from 'zod';

import {
  BACKEND_RESPONSE_ENVELOPES,
  GO_STRUCT_SCHEMAS,
  JsonValueSchema,
  type BackendResponseEnvelopeKey,
  type GoStructName,
} from '../types/backend-api.schema';
import { DependencyListSchema, PackageTypeSchema } from '../types/package.schema';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONTRACT_DIR = path.join(REPO_ROOT, 'pkg', 'plugin', 'testdata', 'contract');
const TAG_GOLDEN = 'struct-tags.json';
const REGENERATE = 'go test ./pkg/plugin -run TestContract -update';

const GoFieldTagSchema = z.strictObject({
  field: z.string(),
  json: z.string(),
  type: z.string(),
  wire: z.string(),
  omitempty: z.boolean(),
});
const GoStructTagsSchema = z.record(z.string(), z.array(GoFieldTagSchema));

type GoFieldTag = z.infer<typeof GoFieldTagSchema>;

interface ValueGolden {
  file: string;
  envelope: BackendResponseEnvelopeKey;
  body: unknown;
}

function readGolden(file: string): unknown {
  const full = path.join(CONTRACT_DIR, file);
  let raw: string;
  try {
    raw = fs.readFileSync(full, 'utf-8');
  } catch (error) {
    throw new Error(`Could not read contract golden ${full}. Regenerate with \`${REGENERATE}\`.\n${String(error)}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Contract golden ${full} is not valid JSON. Regenerate with \`${REGENERATE}\`.\n${String(error)}`);
  }
}

function isEnvelopeKey(key: string): key is BackendResponseEnvelopeKey {
  return Object.prototype.hasOwnProperty.call(BACKEND_RESPONSE_ENVELOPES, key);
}

/**
 * Enumerate the committed value goldens. Throws rather than returning an empty
 * list: a contract guard that silently finds nothing to check is worse than no
 * guard, because it reads as green.
 */
function collectValueGoldens(): ValueGolden[] {
  let names: string[];
  try {
    names = fs.readdirSync(CONTRACT_DIR);
  } catch (error) {
    throw new Error(
      `Contract golden directory ${CONTRACT_DIR} is missing. It is produced by ` +
        `pkg/plugin/contract_fixtures_test.go — regenerate with \`${REGENERATE}\`.\n${String(error)}`
    );
  }

  const goldens = names
    .filter((name) => name.endsWith('.json') && name !== TAG_GOLDEN)
    .sort()
    .map((file) => {
      const envelope = file.slice(0, file.indexOf('.'));
      if (!isEnvelopeKey(envelope)) {
        throw new Error(
          `Contract golden ${file} has no envelope in BACKEND_RESPONSE_ENVELOPES. Goldens are named ` +
            `<envelope-key>.<variant>.json; either the fixture is stale, or a new route needs a schema in ` +
            `src/types/backend-api.schema.ts.`
        );
      }
      return { file, envelope, body: readGolden(file) };
    });

  if (goldens.length === 0) {
    throw new Error(
      `No value goldens found in ${CONTRACT_DIR}. Regenerate with \`${REGENERATE}\` — an empty enumeration ` +
        `would let this guard pass while checking nothing.`
    );
  }
  return goldens;
}

function collectStructTags(): Record<string, GoFieldTag[]> {
  const parsed = GoStructTagsSchema.safeParse(readGolden(TAG_GOLDEN));
  if (!parsed.success) {
    throw new Error(`${TAG_GOLDEN} does not match the expected inventory shape:\n${z.prettifyError(parsed.error)}`);
  }
  if (Object.keys(parsed.data).length === 0) {
    throw new Error(`${TAG_GOLDEN} inventories no structs. Regenerate with \`${REGENERATE}\`.`);
  }
  return parsed.data;
}

const VALUE_GOLDENS = collectValueGoldens();
const STRUCT_TAGS = collectStructTags();

function schemaFor(envelope: BackendResponseEnvelopeKey): z.ZodObject {
  return GO_STRUCT_SCHEMAS[BACKEND_RESPONSE_ENVELOPES[envelope]];
}

function acceptsUndefined(schema: z.ZodType): boolean {
  return schema.safeParse(undefined).success;
}

function normalizedZodWireType(schema: z.core.$ZodType): string {
  if (schema === JsonValueSchema) {
    return 'json';
  }
  if (schema instanceof z.ZodOptional) {
    return normalizedZodWireType(schema.unwrap());
  }
  if (schema instanceof z.ZodNullable) {
    return `nullable<${normalizedZodWireType(schema.unwrap())}>`;
  }
  if (schema instanceof z.ZodString) {
    return 'string';
  }
  if (schema instanceof z.ZodBoolean) {
    return 'boolean';
  }
  if (schema instanceof z.ZodNumber) {
    return schema.format === 'safeint' || schema.format === 'int32' || schema.format === 'uint32'
      ? 'integer'
      : 'number';
  }
  if (schema instanceof z.ZodArray) {
    return `array<${normalizedZodWireType(schema.element)}>`;
  }
  if (schema instanceof z.ZodObject) {
    return 'object';
  }
  if (schema instanceof z.ZodRecord) {
    return `record<${normalizedZodWireType(schema.valueType)}>`;
  }
  if (schema instanceof z.ZodLazy) {
    throw new Error('Use the shared JsonValueSchema for arbitrary JSON fields so their wire type is explicit.');
  }
  throw new Error(`No normalized JSON wire descriptor for Zod type ${schema.constructor.name}.`);
}

function assertStructTagsMatchSchema(goStruct: string, fields: GoFieldTag[]): void {
  const schema: z.ZodObject | undefined = GO_STRUCT_SCHEMAS[goStruct as GoStructName];
  if (!schema) {
    throw new Error(
      `Go struct ${goStruct} is on the wire but has no schema. Add one to src/types/backend-api.schema.ts ` +
        `and register it in GO_STRUCT_SCHEMAS.`
    );
  }

  const shape = schema.shape as Record<string, z.ZodType | undefined>;
  expect(fields.length).toBeGreaterThan(0);

  const undeclared = fields.filter((field) => !shape[field.json]);
  if (undeclared.length > 0) {
    throw new Error(
      `Go emits ${goStruct} fields that no schema declares: ` +
        `${undeclared.map((field) => `${field.json} (${field.type})`).join(', ')}. Add them to ` +
        `src/types/backend-api.schema.ts — until then the frontend cannot see them.`
    );
  }

  const unemitted = Object.keys(shape).filter((key) => !fields.some((field) => field.json === key));
  if (unemitted.length > 0) {
    throw new Error(
      `src/types/backend-api.schema.ts declares ${goStruct} fields Go no longer emits: ` +
        `${unemitted.join(', ')}. Remove them, or restore them in pkg/plugin.`
    );
  }

  for (const field of fields) {
    const sub = shape[field.json]!;
    const expectedWire = normalizedZodWireType(sub);
    if (field.wire !== expectedWire) {
      throw new Error(
        `${goStruct}.${field.json} is ${field.wire} on the Go wire (${field.type}), but its Zod schema ` +
          `accepts ${expectedWire}. Update src/types/backend-api.schema.ts to match.`
      );
    }

    const optional = acceptsUndefined(sub);
    if (optional !== field.omitempty) {
      throw new Error(
        field.omitempty
          ? `${goStruct}.${field.json} is omitempty in Go, so its schema must accept undefined (.optional()).`
          : `${goStruct}.${field.json} has no omitempty in Go, so it is always on the wire and its schema ` +
              `must not accept undefined.`
      );
    }
  }
}

describe('backend API contract: enumeration', () => {
  it('finds committed value goldens', () => {
    expect(VALUE_GOLDENS.length).toBeGreaterThan(0);
  });

  it('has at least one value golden per envelope', () => {
    const covered = new Set(VALUE_GOLDENS.map((g) => g.envelope));
    const missing = Object.keys(BACKEND_RESPONSE_ENVELOPES).filter(
      (key) => !covered.has(key as BackendResponseEnvelopeKey)
    );
    expect(missing).toEqual([]);
  });
});

describe('backend API contract: value goldens parse', () => {
  it.each(VALUE_GOLDENS.map((g) => [g.file, g] as const))('%s', (_file, golden) => {
    const result = schemaFor(golden.envelope).safeParse(golden.body);
    if (!result.success) {
      throw new Error(
        `${golden.file} does not match the schema for ${BACKEND_RESPONSE_ENVELOPES[golden.envelope]}:\n` +
          `${z.prettifyError(result.error)}\n` +
          `Either the Go envelope changed (update src/types/backend-api.schema.ts) or the golden is stale ` +
          `(regenerate with \`${REGENERATE}\`).`
      );
    }
  });
});

// The four routes all build non-nil slices, and two Go tests assert `[]` not
// `null` (custom_guide_repository_test.go:156, completion_records_test.go:231).
// Injecting `null` into every required root array proves no `.nullable()` or
// `.catch([])` has crept in to absorb the drift those assertions exist to expose.
describe('backend API contract: required arrays reject null', () => {
  const cases = VALUE_GOLDENS.flatMap((golden) => {
    const goStruct = BACKEND_RESPONSE_ENVELOPES[golden.envelope];
    return (STRUCT_TAGS[goStruct] ?? [])
      .filter((field) => field.wire.startsWith('array<') && !field.omitempty)
      .map((field) => [`${golden.file} -> ${field.json}`, golden, field.json] as const);
  });

  it('has array fields to check', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)('%s', (_label, golden, field) => {
    const body = golden.body as Record<string, unknown>;
    expect(schemaFor(golden.envelope).safeParse({ ...body, [field]: null }).success).toBe(false);
    expect(schemaFor(golden.envelope).safeParse({ ...body, [field]: undefined }).success).toBe(false);
  });
});

describe('backend API contract: struct tags match the schemas', () => {
  it('inventories exactly the structs the registry declares', () => {
    expect(Object.keys(STRUCT_TAGS).sort()).toEqual(Object.keys(GO_STRUCT_SCHEMAS).sort());
  });

  it.each(Object.keys(STRUCT_TAGS).sort())('%s', (goStruct) => {
    assertStructTagsMatchSchema(goStruct, STRUCT_TAGS[goStruct] ?? []);
  });

  it('rejects a regenerated same-value Go type widening', () => {
    const manifestFields = STRUCT_TAGS.customGuideManifest;
    if (!manifestFields) {
      throw new Error('struct-tags.json does not inventory customGuideManifest.');
    }
    const fields = manifestFields.map((field) =>
      field.json === 'milestones' ? { ...field, type: '[]json.RawMessage', wire: 'array<json>' } : field
    );

    expect(() => assertStructTagsMatchSchema('customGuideManifest', fields)).toThrow(
      'customGuideManifest.milestones is array<json> on the Go wire ([]json.RawMessage), ' +
        'but its Zod schema accepts array<string>.'
    );
  });

  it('rejects pointer and numeric widenings that preserve fixture values', () => {
    const responseFields = STRUCT_TAGS.myCompletionsResponse;
    const completionFields = STRUCT_TAGS.collatedCompletion;
    if (!responseFields || !completionFields) {
      throw new Error('struct-tags.json does not inventory the completion response structs.');
    }

    const pointerFields = responseFields.map((field) =>
      field.json === 'capability' ? { ...field, type: '*completionCapability', wire: 'nullable<object>' } : field
    );
    const numberFields = completionFields.map((field) =>
      field.json === 'count' ? { ...field, type: 'float64', wire: 'number' } : field
    );

    expect(() => assertStructTagsMatchSchema('myCompletionsResponse', pointerFields)).toThrow(
      'myCompletionsResponse.capability is nullable<object> on the Go wire (*completionCapability), ' +
        'but its Zod schema accepts object.'
    );
    expect(() => assertStructTagsMatchSchema('collatedCompletion', numberFields)).toThrow(
      'collatedCompletion.count is number on the Go wire (float64), but its Zod schema accepts integer.'
    );
  });

  it('requires the shared arbitrary-JSON schema identity', () => {
    expect(() => normalizedZodWireType(z.json())).toThrow(
      'Use the shared JsonValueSchema for arbitrary JSON fields so their wire type is explicit.'
    );
  });
});

// The third hand-mirror (#1408): pkg/plugin/custom_guide_repository_client.go
// -> src/lib/custom-guide-repository-client.ts. Field names line up, but two Go
// types are wider than anything the TypeScript client admits, and Go cannot
// express the difference. These assertions are the record of that; the client
// closes the gap at its own boundary, not by narrowing the wire.
describe('backend API contract: custom-guide manifest is wider than its mirror', () => {
  const golden = VALUE_GOLDENS.find((g) => g.file === 'custom-guide-repository.wire-widened-manifest.json');

  it('has the widening golden', () => {
    expect(golden).toBeDefined();
  });

  function wireManifest(): Record<string, unknown> {
    const body = golden!.body as { guides: Array<{ manifest?: Record<string, unknown> }> };
    const manifest = body.guides[0]?.manifest;
    if (!manifest) {
      throw new Error('custom-guide-repository.wire-widened-manifest.json has no guides[0].manifest');
    }
    return manifest;
  }

  // Go: `Type string \`json:"type"\`` with no omitempty, so an untyped manifest
  // emits "" — which CustomGuideManifest.type does not admit, so the client
  // maps it to undefined instead.
  it('emits type "" where PackageType admits only guide | path | journey', () => {
    expect(wireManifest().type).toBe('');
    expect(PackageTypeSchema.safeParse('').success).toBe(false);
  });

  // Go: `Depends []json.RawMessage`, forwarding clauses the fully-typed
  // DependencyList rejects. The client declares no `depends` field at all.
  it('emits depends clauses DependencyList rejects', () => {
    const depends = wireManifest().depends;
    expect(Array.isArray(depends)).toBe(true);
    expect(DependencyListSchema.safeParse(depends).success).toBe(false);
  });
});
