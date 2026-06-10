import { normalizeJsonGuideAliases } from './normalize-guide-aliases';

describe('normalizeJsonGuideAliases', () => {
  it('renames each camelCase alias to its canonical lowercase name', () => {
    const out = normalizeJsonGuideAliases({
      type: 'interactive',
      targetAction: 'highlight',
      refTarget: '.my-element',
      targetValue: 'expected',
    });

    expect(out).toEqual({
      type: 'interactive',
      action: 'highlight',
      reftarget: '.my-element',
      targetvalue: 'expected',
    });
  });

  it('keeps the canonical value and drops the alias when both are present', () => {
    const out = normalizeJsonGuideAliases({
      action: 'button',
      targetAction: 'highlight',
      reftarget: 'A',
      refTarget: 'B',
    }) as Record<string, unknown>;

    expect(out.action).toBe('button');
    expect(out.reftarget).toBe('A');
    expect(out).not.toHaveProperty('targetAction');
    expect(out).not.toHaveProperty('refTarget');
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
