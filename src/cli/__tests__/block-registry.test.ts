import { Command } from 'commander';

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
  JsonInteractiveBlockSchema,
  JsonMarkdownBlockSchema,
  JsonSectionBlockSchema,
  VALID_BLOCK_TYPES,
} from '../../types/json-guide.schema';
import { registerSchemaOptions } from '../utils/schema-options';

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
