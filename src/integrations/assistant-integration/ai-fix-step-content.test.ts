import { extractStepContent, findGuideBlockById } from './ai-fix-step-content';

describe('findGuideBlockById', () => {
  it('finds a block nested inside a section', () => {
    const blocks = [{ type: 'section', id: 'sec', blocks: [{ id: 'target', type: 'interactive' }] }];
    expect(findGuideBlockById(blocks, 'target')?.id).toBe('target');
  });

  it('finds blocks in conditional whenTrue and whenFalse branches', () => {
    const blocks = [
      {
        type: 'conditional',
        whenTrue: [{ id: 't', type: 'interactive' }],
        whenFalse: [{ id: 'f', type: 'interactive' }],
      },
    ];
    expect(findGuideBlockById(blocks, 't')?.id).toBe('t');
    expect(findGuideBlockById(blocks, 'f')?.id).toBe('f');
  });

  it('returns null when no block matches', () => {
    expect(findGuideBlockById([{ id: 'a' }], 'z')).toBeNull();
  });
});

describe('extractStepContent', () => {
  it('returns content plus tooltip for a top-level step', () => {
    const guide = JSON.stringify({ blocks: [{ id: 's1', content: 'Click run', tooltip: 'the run button' }] });
    const out = extractStepContent(guide, 's1');
    expect(out).toContain('Click run');
    expect(out).toContain('Tooltip: the run button');
  });

  it('extracts sub-step content/comment/hint via containerInfo', () => {
    const guide = JSON.stringify({
      blocks: [
        {
          id: 'multi',
          content: 'Do these steps',
          steps: [{}, { content: 'second', comment: 'note', hint: 'try here' }],
        },
      ],
    });
    const out = extractStepContent(guide, 'ignored', { containerId: 'multi', subStepIndex: 1 });
    expect(out).toContain('Do these steps');
    expect(out).toContain('Sub-step content: second');
    expect(out).toContain('Sub-step comment: note');
    expect(out).toContain('Sub-step hint: try here');
  });

  it('returns an empty string for invalid JSON', () => {
    expect(extractStepContent('{not json', 's1')).toBe('');
  });

  it('returns an empty string when the target block is missing', () => {
    expect(extractStepContent(JSON.stringify({ blocks: [{ id: 'other' }] }), 's1')).toBe('');
  });

  it('caps the output at 1500 characters', () => {
    const guide = JSON.stringify({ blocks: [{ id: 's1', content: 'x'.repeat(2000) }] });
    expect(extractStepContent(guide, 's1').length).toBe(1500);
  });
});
