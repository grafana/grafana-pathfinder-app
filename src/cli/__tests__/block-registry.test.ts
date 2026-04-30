import { Command } from 'commander';
import type { z } from 'zod';

import {
  BLOCK_SCHEMA_MAP,
  BLOCK_TYPES,
  CLI_EXCLUDED_BLOCK_TYPES,
  CONTAINER_BLOCK_TYPES,
  getBlockSchema,
  isBlockType,
  isContainerBlockType,
} from '../utils/block-registry';
import {
  BLOCK_FIELD_VALIDATORS,
  CHOICE_FIELD_VALIDATORS,
  MANIFEST_FIELD_VALIDATORS,
  STEP_FIELD_VALIDATORS,
} from '../utils/cli-validators';
import {
  JsonInteractiveBlockSchema,
  JsonMarkdownBlockSchema,
  JsonQuizChoiceSchema,
  JsonSectionBlockSchema,
  JsonStepSchema,
  VALID_BLOCK_TYPES,
} from '../../types/json-guide.schema';
import { ManifestJsonObjectSchema } from '../../types/package.schema';
import { registerSchemaOptions } from '../utils/schema-options';

// Some authoring schemas wrap a `z.object({...})` with `.refine()` /
// `.superRefine()`; the `.shape` accessor still resolves at runtime in Zod v4.
// Cast through `unknown` so the tests can introspect them uniformly.
function shapeOf(schema: unknown): Record<string, z.ZodType> {
  return (schema as { shape: Record<string, z.ZodType> }).shape;
}

describe('BLOCK_SCHEMA_MAP completeness', () => {
  it('every VALID_BLOCK_TYPES entry is either registered or explicitly excluded', () => {
    const registered = new Set(Object.keys(BLOCK_SCHEMA_MAP));
    const missing: string[] = [];
    for (const t of VALID_BLOCK_TYPES) {
      if (!registered.has(t) && !CLI_EXCLUDED_BLOCK_TYPES.has(t)) {
        missing.push(t);
      }
    }
    expect(missing).toEqual([]);
  });

  it('no registered block type is also in the excluded set', () => {
    const overlap = Object.keys(BLOCK_SCHEMA_MAP).filter((t) => CLI_EXCLUDED_BLOCK_TYPES.has(t));
    expect(overlap).toEqual([]);
  });

  it('every excluded block type is a real block type', () => {
    for (const t of CLI_EXCLUDED_BLOCK_TYPES) {
      expect(VALID_BLOCK_TYPES.has(t)).toBe(true);
    }
  });

  it('every registered key matches its schema discriminator', () => {
    // The schema's `type` literal must equal the key it lives under in the
    // registry. Without this, an `add-block <type>` subcommand would emit a
    // payload with the wrong discriminator and fail validation.
    for (const [key, schema] of Object.entries(BLOCK_SCHEMA_MAP)) {
      const sample: Record<string, unknown> = { type: key };
      // Fill in the minimum required fields per block so we can safeParse a
      // discriminator; the schemas we care about all default `id`/optional
      // fields, so this is enough for several but not all of them. For the
      // ones that need more, just check that `safeParse({ type })` returns
      // either success OR an error that is *not* about the discriminator.
      const result = schema.safeParse(sample);
      if (!result.success) {
        const typeIssue = result.error.issues.find((i) => i.path[0] === 'type');
        expect(typeIssue).toBeUndefined();
      }
    }
  });
});

describe('BLOCK_TYPES ordering', () => {
  it('matches BLOCK_SCHEMA_MAP key insertion order', () => {
    expect(BLOCK_TYPES).toEqual(Object.keys(BLOCK_SCHEMA_MAP));
  });
});

describe('CONTAINER_BLOCK_TYPES', () => {
  it.each(['section', 'conditional', 'assistant', 'multistep', 'guided', 'quiz'] as const)('%s is a container', (t) => {
    expect(isContainerBlockType(t)).toBe(true);
  });

  it.each(['markdown', 'interactive', 'html', 'image', 'video', 'input', 'terminal', 'code-block'] as const)(
    '%s is not a container',
    (t) => {
      expect(isContainerBlockType(t)).toBe(false);
    }
  );

  it('every container is a registered block type', () => {
    for (const t of CONTAINER_BLOCK_TYPES) {
      expect(t in BLOCK_SCHEMA_MAP).toBe(true);
    }
  });
});

describe('getBlockSchema', () => {
  it('returns the schema for a registered type', () => {
    expect(getBlockSchema('markdown')).toBe(JsonMarkdownBlockSchema);
    expect(getBlockSchema('interactive')).toBe(JsonInteractiveBlockSchema);
    expect(getBlockSchema('section')).toBe(JsonSectionBlockSchema);
  });

  it('returns undefined for excluded types', () => {
    expect(getBlockSchema('grot-guide')).toBeUndefined();
  });

  it('returns undefined for unknown types', () => {
    expect(getBlockSchema('not-a-block')).toBeUndefined();
    expect(getBlockSchema('')).toBeUndefined();
  });
});

describe('isBlockType', () => {
  it('narrows known types', () => {
    expect(isBlockType('markdown')).toBe(true);
    expect(isBlockType('terminal-connect')).toBe(true);
  });

  it('rejects excluded types', () => {
    expect(isBlockType('grot-guide')).toBe(false);
  });

  it('rejects unknown strings', () => {
    expect(isBlockType('not-a-block')).toBe(false);
    expect(isBlockType('')).toBe(false);
  });
});

describe('integration: every registered schema is bridge-compatible', () => {
  // The contract the bridge depends on: every entry in the registry exposes a
  // walkable `.shape` so `registerSchemaOptions` can produce flags for it.
  // This protects against a future block type being added with a non-object
  // root shape (e.g., a discriminated union at the top level), which would
  // silently break `add-block <type> --help`.
  it.each(Object.entries(BLOCK_SCHEMA_MAP))('registers options for %s', (typeName, schema) => {
    const cmd = new Command(typeName);
    expect(() => registerSchemaOptions(cmd, schema)).not.toThrow();
    // Every block has either some flag-emitting field or is a pure-structural
    // container. We at least expect the bridge to walk without error.
    // Additionally, every CLI-creatable block schema has a `type` literal, so
    // the bridge must skip it — assert no `--type` flag is registered.
    const typeFlag = cmd.options.find((o) => o.long === '--type');
    expect(typeFlag).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Item 2: CONTAINER_CHILD_KEYS coverage
// ---------------------------------------------------------------------------
//
// `walkBlocks` and the structural mutators in package-io descend into a
// container's children via the keys listed in `CONTAINER_CHILD_KEYS`. If a
// future container type (block-children-bearing) is added to
// `CONTAINER_BLOCK_TYPES` without a matching entry here, the walker silently
// returns 0 children — `removeBlock`, `moveBlock`, and `inspect` would all
// treat it as a leaf. That's the latent correctness bug this guard prevents.

// Mirror of the private CONTAINER_CHILD_KEYS table in package-io.ts. Kept in
// lockstep deliberately — the test asserts the schema reality matches.
const CONTAINER_CHILD_KEYS_MIRROR: Record<string, string[]> = {
  section: ['blocks'],
  assistant: ['blocks'],
  conditional: ['whenTrue', 'whenFalse'],
};
const CONTAINER_NON_BLOCK_CHILD_KEYS_MIRROR: Record<string, string[]> = {
  multistep: ['steps'],
  guided: ['steps'],
  quiz: ['choices'],
};

describe('CONTAINER_CHILD_KEYS coverage', () => {
  it('every container block type is covered by exactly one of the two child-keys maps', () => {
    // The test mirror duplicates the private maps in package-io.ts; if those
    // change, this test is the canary forcing both to update together.
    for (const t of CONTAINER_BLOCK_TYPES) {
      const inBlockMap = t in CONTAINER_CHILD_KEYS_MIRROR;
      const inNonBlockMap = t in CONTAINER_NON_BLOCK_CHILD_KEYS_MIRROR;
      // Exactly one — block-containers belong in one map, non-block-containers
      // in the other. Belonging to both or neither indicates drift.
      expect(inBlockMap || inNonBlockMap).toBe(true);
      expect(inBlockMap && inNonBlockMap).toBe(false);
    }
  });

  it('every CONTAINER_CHILD_KEYS entry resolves to a real array field on the block schema', () => {
    for (const [type, keys] of Object.entries(CONTAINER_CHILD_KEYS_MIRROR)) {
      const schema = BLOCK_SCHEMA_MAP[type as keyof typeof BLOCK_SCHEMA_MAP];
      expect(schema).toBeDefined();
      const shape = shapeOf(schema);
      for (const key of keys) {
        expect(shape[key]).toBeDefined();
      }
    }
  });

  it('every CONTAINER_NON_BLOCK_CHILD_KEYS entry resolves to a real array field on the block schema', () => {
    for (const [type, keys] of Object.entries(CONTAINER_NON_BLOCK_CHILD_KEYS_MIRROR)) {
      const schema = BLOCK_SCHEMA_MAP[type as keyof typeof BLOCK_SCHEMA_MAP];
      expect(schema).toBeDefined();
      const shape = shapeOf(schema);
      for (const key of keys) {
        expect(shape[key]).toBeDefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Item 7: cli-validators field-name coverage
// ---------------------------------------------------------------------------
//
// `cli-validators.ts` references field names by string. A schema rename
// silently disables CLI-strict validation on the renamed field. These tests
// pin every validator key to a real schema field so renames break loudly.

describe('cli-validators field-name coverage', () => {
  it('every BLOCK_FIELD_VALIDATORS field is a real field on the corresponding block schema', () => {
    for (const [blockType, fields] of Object.entries(BLOCK_FIELD_VALIDATORS)) {
      const schema = BLOCK_SCHEMA_MAP[blockType as keyof typeof BLOCK_SCHEMA_MAP];
      expect(schema).toBeDefined();
      const shape = shapeOf(schema);
      for (const fieldName of Object.keys(fields)) {
        expect({ blockType, fieldName, exists: fieldName in shape }).toEqual({
          blockType,
          fieldName,
          exists: true,
        });
      }
    }
  });

  it('every STEP_FIELD_VALIDATORS field is a real field on JsonStepSchema', () => {
    const shape = shapeOf(JsonStepSchema);
    for (const fieldName of Object.keys(STEP_FIELD_VALIDATORS)) {
      expect({ fieldName, exists: fieldName in shape }).toEqual({ fieldName, exists: true });
    }
  });

  it('every CHOICE_FIELD_VALIDATORS field is a real field on JsonQuizChoiceSchema', () => {
    const shape = shapeOf(JsonQuizChoiceSchema);
    for (const fieldName of Object.keys(CHOICE_FIELD_VALIDATORS)) {
      expect({ fieldName, exists: fieldName in shape }).toEqual({ fieldName, exists: true });
    }
  });

  it('every MANIFEST_FIELD_VALIDATORS field is a real field on ManifestJsonObjectSchema', () => {
    const shape = shapeOf(ManifestJsonObjectSchema);
    for (const fieldName of Object.keys(MANIFEST_FIELD_VALIDATORS)) {
      expect({ fieldName, exists: fieldName in shape }).toEqual({ fieldName, exists: true });
    }
  });
});
