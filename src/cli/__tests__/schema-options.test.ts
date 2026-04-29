import { Command, Option } from 'commander';
import { z } from 'zod';

import { JsonInteractiveBlockSchema } from '../../types/json-guide.schema';
import {
  describeField,
  fieldNameToFlag,
  parseOptionValues,
  registerSchemaOptions,
  STRUCTURAL_SKIP_FIELDS,
  zodFieldToOption,
} from '../utils/schema-options';

describe('fieldNameToFlag', () => {
  it.each([
    ['reftarget', 'reftarget'],
    ['showMe', 'show-me'],
    ['validateInput', 'validate-input'],
    ['scrollContainer', 'scroll-container'],
    ['openGuide', 'open-guide'],
    ['id', 'id'],
    ['ifAbsent', 'if-absent'],
  ])('converts %s -> %s', (input, expected) => {
    expect(fieldNameToFlag(input)).toBe(expected);
  });
});

describe('describeField', () => {
  it('detects required string', () => {
    expect(describeField(z.string())).toMatchObject({ kind: 'string', optional: false });
  });

  it('detects optional string and reads .describe()', () => {
    const field = z.string().optional().describe('hello');
    expect(describeField(field)).toMatchObject({ kind: 'string', optional: true, description: 'hello' });
  });

  it('detects optional number', () => {
    expect(describeField(z.number().optional())).toMatchObject({ kind: 'number', optional: true });
  });

  it('detects optional boolean', () => {
    expect(describeField(z.boolean().optional())).toMatchObject({ kind: 'boolean', optional: true });
  });

  it('detects enum and lists values', () => {
    const f = z.enum(['a', 'b', 'c']).optional();
    const shape = describeField(f);
    expect(shape.kind).toBe('enum');
    if (shape.kind === 'enum') {
      expect(shape.values).toEqual(['a', 'b', 'c']);
      expect(shape.optional).toBe(true);
    }
  });

  it('detects optional array of strings', () => {
    expect(describeField(z.array(z.string()).optional())).toMatchObject({
      kind: 'array-string',
      optional: true,
    });
  });

  it('detects literal as literal', () => {
    expect(describeField(z.literal('markdown'))).toMatchObject({ kind: 'literal', optional: false });
  });

  it('treats default-wrapped fields as optional', () => {
    expect(describeField(z.string().default('x'))).toMatchObject({ kind: 'string', optional: true });
  });

  it('reports unsupported shapes by reason', () => {
    const u = z.union([z.string(), z.boolean()]);
    expect(describeField(u)).toMatchObject({ kind: 'unsupported' });
  });
});

describe('zodFieldToOption', () => {
  it('returns null for structural skip fields', () => {
    for (const name of STRUCTURAL_SKIP_FIELDS) {
      expect(zodFieldToOption(name, z.string())).toBeNull();
    }
  });

  it('returns null for literals', () => {
    expect(zodFieldToOption('marker', z.literal('x'))).toBeNull();
  });

  it('returns null for unsupported shapes', () => {
    expect(zodFieldToOption('mix', z.union([z.string(), z.boolean()]))).toBeNull();
  });

  it('emits string flag', () => {
    const opt = zodFieldToOption('content', z.string().optional().describe('Markdown body'));
    expect(opt).toBeInstanceOf(Option);
    expect(opt!.flags).toBe('--content <string>');
    expect(opt!.description).toBe('Markdown body');
    expect(opt!.mandatory).toBe(false);
  });

  it('marks required string as mandatory', () => {
    const opt = zodFieldToOption('content', z.string());
    expect(opt!.mandatory).toBe(true);
  });

  it('emits boolean flag with no value', () => {
    const opt = zodFieldToOption('showMe', z.boolean().optional().describe('Show me toggle'));
    expect(opt!.flags).toBe('--show-me');
    expect(opt!.description).toBe('Show me toggle');
    expect(opt!.isBoolean()).toBe(true);
  });

  it('emits enum flag with choices', () => {
    const opt = zodFieldToOption('action', z.enum(['noop', 'navigate', 'button']));
    expect(opt!.flags).toBe('--action <noop|navigate|button>');
    expect(opt!.argChoices).toEqual(['noop', 'navigate', 'button']);
    expect(opt!.mandatory).toBe(true);
  });

  it('emits repeatable array flag with appender parser', () => {
    const opt = zodFieldToOption('requirements', z.array(z.string()).optional().describe('Reqs'));
    expect(opt!.flags).toBe('--requirements <item>');
    // Default starts as empty array; argParser appends each new value.
    expect(opt!.defaultValue).toEqual([]);
    const after1 = opt!.parseArg!('on-page:/dashboards', [] as string[]);
    const after2 = opt!.parseArg!('is-admin', after1);
    expect(after2).toEqual(['on-page:/dashboards', 'is-admin']);
  });

  it('emits number flag with numeric coercion', () => {
    const opt = zodFieldToOption('start', z.number().optional());
    expect(opt!.flags).toBe('--start <number>');
    expect(opt!.parseArg!('42', undefined as unknown as number)).toBe(42);
    expect(() => opt!.parseArg!('not-a-number', undefined as unknown as number)).toThrow();
  });

  it('falls back to a generic description when .describe() is absent', () => {
    const opt = zodFieldToOption('hint', z.string().optional());
    expect(opt!.description).toBe('hint (string, optional)');
  });
});

describe('registerSchemaOptions', () => {
  it('registers one option per non-structural field', () => {
    const Schema = z.object({
      type: z.literal('interactive'),
      action: z.enum(['noop', 'navigate']),
      reftarget: z.string().optional(),
      showMe: z.boolean().optional(),
      requirements: z.array(z.string()).optional(),
      blocks: z.array(z.string()).optional(), // structural, must skip
    });
    const cmd = new Command('test');
    registerSchemaOptions(cmd, Schema);
    const flags = cmd.options.map((o) => o.flags);
    expect(flags).toEqual(['--action <noop|navigate>', '--reftarget <string>', '--show-me', '--requirements <item>']);
  });

  it('parses a real CLI invocation through the registered options', () => {
    const Schema = z.object({
      type: z.literal('interactive'),
      action: z.enum(['noop', 'navigate']),
      reftarget: z.string().optional(),
      showMe: z.boolean().optional(),
      requirements: z.array(z.string()).optional(),
    });
    const cmd = new Command('test').exitOverride();
    registerSchemaOptions(cmd, Schema);
    cmd.parse(
      [
        '--action',
        'navigate',
        '--reftarget',
        '[data-testid="x"]',
        '--show-me',
        '--requirements',
        'on-page:/',
        '--requirements',
        'is-admin',
      ],
      { from: 'user' }
    );
    expect(cmd.opts()).toEqual({
      action: 'navigate',
      reftarget: '[data-testid="x"]',
      showMe: true,
      requirements: ['on-page:/', 'is-admin'],
    });
  });
});

describe('parseOptionValues', () => {
  const Schema = z.object({
    type: z.literal('interactive'),
    action: z.enum(['noop', 'navigate']),
    reftarget: z.string().optional(),
    showMe: z.boolean().optional(),
    requirements: z.array(z.string()).optional(),
  });

  it('forwards known flag values keyed by camelCase field name', () => {
    const result = parseOptionValues(Schema, {
      action: 'navigate',
      reftarget: '[data-testid="x"]',
      showMe: true,
      requirements: ['on-page:/'],
    });
    expect(result).toEqual({
      action: 'navigate',
      reftarget: '[data-testid="x"]',
      showMe: true,
      requirements: ['on-page:/'],
    });
  });

  it('drops empty array defaults for optional repeatable flags', () => {
    const result = parseOptionValues(Schema, {
      action: 'noop',
      requirements: [],
    });
    expect(result).toEqual({ action: 'noop' });
  });

  it('drops unknown keys', () => {
    const result = parseOptionValues(Schema, {
      action: 'noop',
      somethingElse: 'ignored',
    });
    expect(result).toEqual({ action: 'noop' });
  });

  it('output round-trips through the schema', () => {
    const projected = parseOptionValues(Schema, {
      action: 'navigate',
      reftarget: '[data-testid="x"]',
      showMe: true,
      requirements: ['is-admin'],
    });
    // Add the literal type discriminator that the bridge intentionally skips.
    const result = Schema.safeParse({ type: 'interactive', ...projected });
    expect(result.success).toBe(true);
  });
});

describe('integration with the live JsonInteractiveBlockSchema', () => {
  it('registers exactly the production interactive-block flags', () => {
    const cmd = new Command('interactive');
    registerSchemaOptions(cmd, JsonInteractiveBlockSchema);
    const flags = cmd.options.map((o) => o.flags).sort();
    expect(flags).toEqual(
      [
        '--id <string>',
        '--action <highlight|button|formfill|navigate|hover|noop|popout>',
        '--reftarget <string>',
        '--targetvalue <string>',
        '--content <string>',
        '--tooltip <string>',
        '--requirements <item>',
        '--objectives <item>',
        '--skippable',
        '--hint <string>',
        '--form-hint <string>',
        '--validate-input',
        '--show-me',
        '--do-it',
        '--complete-early',
        '--verify <string>',
        '--lazy-render',
        '--scroll-container <string>',
        '--open-guide <string>',
        '--assistant-enabled',
        '--assistant-id <string>',
        '--assistant-type <query|config|code|text>',
      ].sort()
    );
  });

  it('a parsed CLI invocation round-trips through the live schema', () => {
    const cmd = new Command('interactive').exitOverride();
    registerSchemaOptions(cmd, JsonInteractiveBlockSchema);
    cmd.parse(
      [
        '--action',
        'navigate',
        '--reftarget',
        '[data-testid="nav-item-connections"]',
        '--content',
        'Open the Connections page.',
        '--show-me',
        '--requirements',
        'on-page:/',
      ],
      { from: 'user' }
    );
    const projected = parseOptionValues(JsonInteractiveBlockSchema, cmd.opts());
    const result = JsonInteractiveBlockSchema.safeParse({ type: 'interactive', ...projected });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.action).toBe('navigate');
    expect(result.data.reftarget).toBe('[data-testid="nav-item-connections"]');
    expect(result.data.showMe).toBe(true);
    expect(result.data.requirements).toEqual(['on-page:/']);
  });

  it('forwards the .describe() text into Commander help output', () => {
    const cmd = new Command('interactive');
    registerSchemaOptions(cmd, JsonInteractiveBlockSchema);
    const action = cmd.options.find((o) => o.long === '--action');
    expect(action?.description).toBe('Action to perform on target element');
    const requirements = cmd.options.find((o) => o.long === '--requirements');
    // The bridge enriches requirements/conditions descriptions with a pointer
    // to `pathfinder-cli requirements list` so authors discover valid tokens
    // without leaving --help. Assert the describe() text and the suffix
    // separately so future suffix changes don't tangle the .describe() check.
    expect(requirements?.description).toContain('Prerequisite conditions (e.g., on-page:/dashboards, is-admin)');
    expect(requirements?.description).toContain('pathfinder-cli requirements list');
  });
});
