import { normalizeJsonGuideAliases } from './normalize-guide-aliases';
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
      targetstate: true,
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
    expect(out.targetstate).toBe(true);
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
    expect(blocks[0]!.targetstate).toBe(true);
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
