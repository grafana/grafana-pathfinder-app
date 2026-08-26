import { normalizeJsonGuideAliases, readAliasedField } from './normalize-guide-aliases';
import { validateGuide } from './validate-guide';

describe('normalizeJsonGuideAliases', () => {
  it('renames each camelCase alias to its canonical lowercase name', () => {
    const out = normalizeJsonGuideAliases({
      type: 'interactive',
      targetAction: 'highlight',
      refTarget: '.my-element',
      targetValue: 'expected',
      targetState: true,
    });

    expect(out).toEqual({
      type: 'interactive',
      action: 'highlight',
      reftarget: '.my-element',
      targetvalue: 'expected',
      // Coerced: the canonical wire form is a string.
      targetstate: 'true',
    });
  });

  it('renames targetState on nested multistep and guided steps', () => {
    const out = normalizeJsonGuideAliases({
      blocks: [
        { type: 'multistep', steps: [{ action: 'button', reftarget: 'Add', targetState: 'aria-expanded:true' }] },
      ],
    }) as { blocks: Array<Record<string, any>> };

    expect(out.blocks[0]!.steps[0]).toEqual({
      action: 'button',
      reftarget: 'Add',
      targetstate: 'aria-expanded:true',
    });
  });

  it('keeps the canonical value and drops the alias when both are present', () => {
    const out = normalizeJsonGuideAliases({
      action: 'button',
      targetAction: 'highlight',
      reftarget: 'A',
      refTarget: 'B',
      targetstate: true,
      targetState: false,
    }) as Record<string, unknown>;

    expect(out.action).toBe('button');
    expect(out.reftarget).toBe('A');
    expect(out.targetstate).toBe('true');
    expect(out).not.toHaveProperty('targetAction');
    expect(out).not.toHaveProperty('refTarget');
    expect(out).not.toHaveProperty('targetState');
  });

  it('recurses into blocks[], multistep steps[], and nested section/conditional branches', () => {
    const out = normalizeJsonGuideAliases({
      id: 'g',
      title: 'g',
      blocks: [
        { type: 'interactive', targetAction: 'button', refTarget: 'Save' },
        { type: 'multistep', steps: [{ targetAction: 'highlight', refTarget: '.a' }] },
        {
          type: 'section',
          blocks: [{ type: 'interactive', targetAction: 'formfill', targetValue: 'x' }],
        },
        {
          type: 'conditional',
          whenTrue: [{ type: 'interactive', refTarget: '.t' }],
          whenFalse: [{ type: 'interactive', refTarget: '.f' }],
        },
      ],
    }) as { blocks: Array<Record<string, any>> };

    expect(out.blocks[0]).toMatchObject({ action: 'button', reftarget: 'Save' });
    expect(out.blocks[1]!.steps[0]).toMatchObject({ action: 'highlight', reftarget: '.a' });
    expect(out.blocks[2]!.blocks[0]).toMatchObject({ action: 'formfill', targetvalue: 'x' });
    expect(out.blocks[3]!.whenTrue[0]).toMatchObject({ reftarget: '.t' });
    expect(out.blocks[3]!.whenFalse[0]).toMatchObject({ reftarget: '.f' });
  });

  it('is idempotent', () => {
    const input = { type: 'interactive', targetAction: 'button', refTarget: 'Save' };
    const once = normalizeJsonGuideAliases(input);
    const twice = normalizeJsonGuideAliases(once);
    expect(twice).toEqual(once);
  });

  it('does not mutate its input', () => {
    const input = { type: 'interactive', targetAction: 'button' };
    normalizeJsonGuideAliases(input);
    expect(input).toEqual({ type: 'interactive', targetAction: 'button' });
  });

  it('returns non-object input unchanged', () => {
    expect(normalizeJsonGuideAliases('a string')).toBe('a string');
    expect(normalizeJsonGuideAliases(42)).toBe(42);
    expect(normalizeJsonGuideAliases(null)).toBe(null);
    expect(normalizeJsonGuideAliases(['a', 'b'])).toEqual(['a', 'b']);
  });
});

// An alias the normalizer doesn't know is not a validation error — the schema
// strips it and the guide comes back valid without the field. This is what the
// missing targetState entry did: camelCase guides validated clean and lost the
// toggle state on the way through.
describe('camelCase aliases survive validateGuide', () => {
  const guideWith = (block: Record<string, unknown>, step: Record<string, unknown>) => ({
    schemaVersion: '1.0.0',
    id: 'alias-guide',
    title: 'Alias guide',
    blocks: [
      { type: 'interactive', content: 'Open the drawer', ...block },
      { type: 'multistep', content: 'Add a panel', steps: [step] },
    ],
  });

  it('keeps targetState as targetstate on a block and a nested step', () => {
    const result = validateGuide(
      guideWith(
        { action: 'highlight', reftarget: '#drawer', targetState: true },
        { action: 'button', reftarget: 'Add', targetState: 'aria-expanded:true' }
      )
    );

    expect(result.isValid).toBe(true);
    expect(result.warnings).toEqual([]);
    const blocks = result.guide!.blocks as Array<Record<string, any>>;
    // Coerced to the string form on the way through — see below.
    expect(blocks[0]!.targetstate).toBe('true');
    expect(blocks[1]!.steps[0]!.targetstate).toBe('aria-expanded:true');
  });

  it('keeps the other three aliases, so targetState is not a special case', () => {
    const result = validateGuide(
      guideWith(
        { targetAction: 'formfill', refTarget: '#name', targetValue: 'demo' },
        { targetAction: 'button', refTarget: 'Add' }
      )
    );

    expect(result.isValid).toBe(true);
    const blocks = result.guide!.blocks as Array<Record<string, any>>;
    expect(blocks[0]).toMatchObject({ action: 'formfill', reftarget: '#name', targetvalue: 'demo' });
    expect(blocks[1]!.steps[0]).toMatchObject({ action: 'button', reftarget: 'Add' });
  });
});

// `targetstate` has to express both "drive this control on" and
// "<attribute>:<value>", and the backend InteractiveGuide CRD cannot model a
// field that is boolean-or-string: a CUE disjunction across two JSON types
// renders `"type": ["string","boolean"]`, which is not valid Kubernetes
// JSONSchemaProps. Declaring it string-only there means a raw boolean is
// rejected with a 422 rather than pruned, so the boolean must be gone before a
// guide reaches the API. Authors still write `true` because it reads better;
// these tests pin the coercion that makes both true at once.
describe('boolean targetstate is coerced to its string form', () => {
  const guideWithTargetState = (value: unknown) => ({
    schemaVersion: '1.0.0',
    id: 'target-state-guide',
    title: 'Target state guide',
    blocks: [
      {
        type: 'interactive',
        content: 'Open the drawer',
        action: 'highlight',
        reftarget: '#drawer',
        targetstate: value,
      },
      {
        type: 'multistep',
        content: 'Add a panel',
        steps: [{ action: 'button', reftarget: 'Add', targetstate: value }],
      },
    ],
  });

  it.each([
    [true, 'true'],
    [false, 'false'],
  ])('turns %p into %p on a block and a nested step', (authored, expected) => {
    const result = validateGuide(guideWithTargetState(authored));

    expect(result.isValid).toBe(true);
    const blocks = result.guide!.blocks as Array<Record<string, any>>;
    expect(blocks[0]!.targetstate).toBe(expected);
    expect(blocks[1]!.steps[0]!.targetstate).toBe(expected);
  });

  it('leaves the string forms untouched', () => {
    for (const value of ['true', 'false', 'aria-expanded:true', 'data-state:open']) {
      const result = validateGuide(guideWithTargetState(value));
      expect(result.isValid).toBe(true);
      const blocks = result.guide!.blocks as Array<Record<string, any>>;
      expect(blocks[0]!.targetstate).toBe(value);
    }
  });

  it('coerces only targetstate, not every boolean field', () => {
    const result = validateGuide({
      schemaVersion: '1.0.0',
      id: 'other-booleans',
      title: 'Other booleans',
      blocks: [
        {
          type: 'interactive',
          content: 'Fill the name',
          action: 'formfill',
          reftarget: '#name',
          targetvalue: 'demo',
          validateInput: true,
          skippable: false,
        },
      ],
    });

    expect(result.isValid).toBe(true);
    const blocks = result.guide!.blocks as Array<Record<string, any>>;
    expect(blocks[0]!.validateInput).toBe(true);
    expect(blocks[0]!.skippable).toBe(false);
  });

  it('is idempotent, so a re-validated guide is unchanged', () => {
    const once = validateGuide(guideWithTargetState(true));
    const twice = validateGuide(once.guide!);

    expect(twice.isValid).toBe(true);
    expect(twice.guide).toEqual(once.guide);
  });
});

describe('readAliasedField', () => {
  it('reads the canonical field when it is present', () => {
    expect(readAliasedField({ action: 'navigate' }, 'action')).toBe('navigate');
  });

  it('falls back to the camelCase alias on an unnormalized record', () => {
    expect(readAliasedField({ targetAction: 'navigate' }, 'action')).toBe('navigate');
    expect(readAliasedField({ refTarget: '/dashboards' }, 'reftarget')).toBe('/dashboards');
  });

  it('prefers the canonical field over the alias, matching the normalizer', () => {
    const raw = { action: 'navigate', targetAction: 'highlight' };
    const normalized = normalizeJsonGuideAliases(raw) as Record<string, unknown>;

    expect(readAliasedField(raw, 'action')).toBe('navigate');
    expect(readAliasedField(raw, 'action')).toBe(normalized.action);
  });

  it('returns undefined when neither the canonical field nor an alias is present', () => {
    expect(readAliasedField({ type: 'markdown' }, 'action')).toBeUndefined();
  });
});
