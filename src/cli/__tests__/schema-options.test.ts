import { Option } from 'commander';
import { z } from 'zod';

import { JsonInteractiveBlockSchema } from '../../types/json-guide.schema';
import { pickContent, pickSupplied } from '../contracts';
import { buildOptionForField } from '../contracts/commander-options';
import { describeField, fieldNameToFlag } from '../utils/schema-options';

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

describe('buildOptionForField', () => {
  it('returns null for literals', () => {
    expect(buildOptionForField('marker', z.literal('x'))).toBeNull();
  });

  it('returns null for unsupported shapes', () => {
    expect(buildOptionForField('mix', z.union([z.string(), z.boolean()]))).toBeNull();
  });

  // A field named `type` used to be dropped by name, which cost `create --type`
  // its flag (§3.4 i). Only shape decides now.
  it('builds an option for a field whose name used to be on the skip list', () => {
    const opt = buildOptionForField('type', z.enum(['guide', 'path']));
    expect(opt!.flags).toBe('--type <guide|path>');
  });

  it('emits string flag', () => {
    const opt = buildOptionForField('content', z.string().optional().describe('Markdown body'));
    expect(opt).toBeInstanceOf(Option);
    expect(opt!.flags).toBe('--content <string>');
    expect(opt!.description).toBe('Markdown body');
    expect(opt!.mandatory).toBe(false);
  });

  it('marks required string as mandatory', () => {
    const opt = buildOptionForField('content', z.string());
    expect(opt!.mandatory).toBe(true);
  });

  it('emits boolean flag with no value', () => {
    const opt = buildOptionForField('showMe', z.boolean().optional().describe('Show me toggle'));
    expect(opt!.flags).toBe('--show-me');
    expect(opt!.description).toBe('Show me toggle');
    expect(opt!.isBoolean()).toBe(true);
  });

  it('emits enum flag with choices', () => {
    const opt = buildOptionForField('action', z.enum(['noop', 'navigate', 'button']));
    expect(opt!.flags).toBe('--action <noop|navigate|button>');
    expect(opt!.argChoices).toEqual(['noop', 'navigate', 'button']);
    expect(opt!.mandatory).toBe(true);
  });

  it('emits repeatable array flag with appender parser', () => {
    const opt = buildOptionForField('requirements', z.array(z.string()).optional().describe('Reqs'));
    expect(opt!.flags).toBe('--requirements <item>');
    // No seed default: the appender starts the list from the first value, so an
    // absent flag stays absent rather than arriving as a Commander-supplied `[]`.
    expect(opt!.defaultValue).toBeUndefined();
    expect(opt!.parseArg!('is-admin', undefined as unknown as string[])).toEqual(['is-admin']);
    const after1 = opt!.parseArg!('on-page:/dashboards', [] as string[]);
    const after2 = opt!.parseArg!('is-admin', after1);
    expect(after2).toEqual(['on-page:/dashboards', 'is-admin']);
  });

  it('emits number flag with numeric coercion', () => {
    const opt = buildOptionForField('start', z.number().optional());
    expect(opt!.flags).toBe('--start <number>');
    expect(opt!.parseArg!('42', undefined as unknown as number)).toBe(42);
    expect(() => opt!.parseArg!('not-a-number', undefined as unknown as number)).toThrow();
  });

  // A value that is not a number fails before any schema check runs, so the message
  // has to state the bounds itself — read off the field rather than restated.
  it.each([
    [z.number(), 'a number'],
    [z.number().int(), 'an integer'],
    [z.number().int().nonnegative(), 'a non-negative integer'],
    [z.number().positive(), 'a positive number'],
    [z.number().int().min(1).optional(), 'a positive integer'],
  ])('reports what a numeric parameter accepts (%#)', (field, expected) => {
    const opt = buildOptionForField('position', field as z.ZodType);
    expect(() => opt!.parseArg!('abc', undefined as unknown as number)).toThrow(
      `--position must be ${expected}, got "abc"`
    );
  });

  it('falls back to a generic description when .describe() is absent', () => {
    const opt = buildOptionForField('hint', z.string().optional());
    expect(opt!.description).toBe('hint (string, optional)');
  });

  it('carries a .describe() from a live runtime schema into help text', () => {
    const shape = JsonInteractiveBlockSchema.shape as Record<string, z.ZodType>;
    expect(buildOptionForField('action', shape.action!)!.description).toBe('Action to perform on target element');
    // What the schema states, and nothing addressed to a particular reader: the
    // pointer at the requirement vocabulary is `CLI_VIEW`'s to add, and is asserted
    // where that view is (contracts.test.ts).
    const requirements = buildOptionForField('requirements', shape.requirements!)!.description;
    expect(requirements).toBe('Prerequisite conditions (e.g., on-page:/dashboards, is-admin)');
  });

  it('prefers a caller-supplied description over the schema wording', () => {
    const opt = buildOptionForField('requirements', z.array(z.string()).optional().describe('Reqs'), {
      description: 'Reqs | as this surface would put it',
    });
    expect(opt!.description).toBe('Reqs | as this surface would put it');
  });
});

/**
 * The successors to `parseOptionValues`. Two named rules rather than one function with
 * an implicit policy, because creating and patching disagree about what an empty
 * repeatable means.
 */
describe('selecting supplied parameters', () => {
  const keys = ['action', 'reftarget', 'showMe', 'requirements'];

  it('forwards known parameters and drops unknown ones', () => {
    const input = { action: 'navigate', reftarget: '[data-testid="x"]', showMe: true, somethingElse: 'ignored' };
    expect(pickContent(input, keys)).toEqual({
      action: 'navigate',
      reftarget: '[data-testid="x"]',
      showMe: true,
    });
  });

  it('drops an empty repeatable when creating', () => {
    expect(pickContent({ action: 'noop', requirements: [] }, keys)).toEqual({ action: 'noop' });
  });

  it('keeps an empty repeatable when patching, because it means "clear this"', () => {
    expect(pickSupplied({ action: 'noop', requirements: [] }, keys)).toEqual({ action: 'noop', requirements: [] });
  });

  it('selection round-trips through the runtime schema', () => {
    const Schema = z.object({
      type: z.literal('interactive'),
      action: z.enum(['noop', 'navigate']),
      reftarget: z.string().optional(),
      showMe: z.boolean().optional(),
      requirements: z.array(z.string()).optional(),
    });
    const selected = pickContent({ action: 'navigate', reftarget: '[data-testid="x"]', showMe: true }, keys);
    // The discriminator is supplied by the command, not by the parameter bag.
    expect(Schema.safeParse({ type: 'interactive', ...selected }).success).toBe(true);
  });
});
