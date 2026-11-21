import type { JsonBlock } from '../../../../../types/json-guide.types';
import type { ContentJson } from '../../../../../types/package.types';
import { MAX_HINTS, blockHints, currentQualityHints, guideHints, mutationQualityHints, type GuideKind } from '../index';

const guide = (...blocks: unknown[]): ContentJson => ({ id: 'g', title: 'G', blocks }) as unknown as ContentJson;
const md = (content: string, id = 'md'): JsonBlock => ({ type: 'markdown', id, content }) as JsonBlock;
const step = (extra: Record<string, unknown> = {}) => ({
  action: 'highlight',
  reftarget: '[data-testid="x"]',
  requirements: ['on-page:/x'],
  ...extra,
});
const interactive = (extra: Record<string, unknown> = {}): JsonBlock =>
  ({ type: 'interactive', id: 'i', content: 'Click', ...step(extra) }) as JsonBlock;
const multistep = (steps: unknown[]): JsonBlock => ({ type: 'multistep', id: 'm', content: 'Do', steps }) as JsonBlock;
const callout = (id: string): JsonBlock => ({ type: 'callout', id, title: 'T', content: 'c' }) as JsonBlock;
const section = (title: string, ...blocks: unknown[]): JsonBlock =>
  ({ type: 'section', id: 's', title, blocks }) as JsonBlock;

const codes = (content: ContentJson) => blockHints(content).map((h) => h.code);
const guideCodes = (content: ContentJson, kind?: GuideKind) => guideHints(content, kind).map((h) => h.code);

type Case = [rule: string, flagged: JsonBlock, clean: JsonBlock];

const para = (n: number) => Array.from({ length: n }, (_, i) => `Paragraph ${i}.`).join('\n\n');

describe('block rules', () => {
  const cases: Case[] = [
    ['NOOP_STEP', interactive({ action: 'noop' }), interactive()],
    ['SINGLE_STEP_MULTISTEP', multistep([step()]), multistep([step(), step()])],
    ['MISSING_ON_PAGE', interactive({ requirements: [] }), interactive({ requirements: ['on-page:/x'] })],
    [
      'MISSING_ON_PAGE',
      multistep([step({ requirements: [] }), step()]),
      interactive({ action: 'navigate', requirements: [] }),
    ],
    [
      'TEXT_SELECTOR',
      interactive({ reftarget: 'button[aria-label="Save"]' }),
      interactive({ reftarget: 'grafana:nav/save' }),
    ],
    [
      'TEXT_SELECTOR',
      interactive({ reftarget: 'Save dashboard' }),
      interactive({ action: 'button', reftarget: 'Save dashboard' }),
    ],
    [
      'TEXT_SELECTOR',
      multistep([step({ reftarget: 'a:contains("Save")' }), step()]),
      interactive({ reftarget: '[data-testid="TODO-save"]', content: '**⚠️ TODO: add the selector for save**' }),
    ],
    [
      'PLACEHOLDER_LEAD_MISSING',
      interactive({ reftarget: '[data-testid="TODO-save"]' }),
      interactive({ reftarget: '[data-testid="TODO-save"]', content: '**⚠️ TODO: add the selector for save**' }),
    ],
    [
      'PLACEHOLDER_LEAD_ORPHANED',
      interactive({ content: '**⚠️ TODO: add the selector for save** Click save' }),
      interactive({ content: 'Click save' }),
    ],
    [
      'PLACEHOLDER_LEAD_MISSING',
      multistep([
        step({ reftarget: '[data-testid="TODO-save"]', description: '**⚠️ TODO: add the selector for save**' }),
        step(),
      ]),
      {
        ...multistep([step({ reftarget: '[data-testid="TODO-save"]' }), step()]),
        content: '**⚠️ TODO: add the selector for save** Do',
      } as JsonBlock,
    ],
    [
      'PLACEHOLDER_LEAD_ORPHANED',
      { ...multistep([step(), step()]), content: '**⚠️ TODO: add the selector for save** Do' } as JsonBlock,
      {
        ...multistep([step({ reftarget: '[data-testid="TODO-save"]' }), step()]),
        content: '**⚠️ TODO: add the selector for save** Do',
      } as JsonBlock,
    ],
    [
      'PLACEHOLDER_LEAD_ORPHANED',
      {
        type: 'code-block',
        id: 'c',
        content: '**⚠️ TODO: add the selector for editor**',
        reftarget: '.editor',
      } as JsonBlock,
      {
        type: 'code-block',
        id: 'c',
        content: '**⚠️ TODO: add the selector for editor**',
        reftarget: '[data-testid="TODO-editor"]',
      } as JsonBlock,
    ],
    [
      'PLACEHOLDER_UNRESOLVED',
      multistep([step({ reftarget: '[data-testid="TODO-save"]' }), step()]),
      interactive({ reftarget: '[data-testid="save"]' }),
    ],
    ['HTML_STYLING', { type: 'html', id: 'h', content: '<p>x</p>' } as JsonBlock, md('plain')],
    ['HTML_STYLING', md('<span style="color:red">x</span>'), md('<kbd>x</kbd>')],
    ['NUMBERED_SECTION_TITLE', section('1. Create'), section('Create')],
    ['NUMBERED_SECTION_TITLE', section('step 2: Create'), section('Stepping up')],
    ['LONG_PARAGRAPH', md(Array(131).fill('word').join(' ')), md(Array(130).fill('word').join(' '))],
    ['PARAGRAPH_RUN', md(para(4)), md(`${para(3)}\n\n## Heading\n\n${para(3)}`)],
    ['CODE_FENCE_NO_LANG', md('```\nx\n```'), md('```yaml\nx\n```')],
    [
      'PROSE_UI_STEP',
      section('S', md('Intro.', 'a'), md('Click **Add new panel**, then select **Time series**.', 'b')),
      section('S', md('Intro.', 'a'), md('Panels are built from **queries**.', 'b')),
    ],
    [
      'PROSE_UI_STEP',
      section('S', md('Click **Save** to continue.', 'a')),
      section('S', md('Here is the **Save** button.', 'a')),
    ],
    [
      'MISSING_VERIFY',
      interactive({ action: 'button', reftarget: 'Save dashboard' }),
      interactive({ action: 'button', reftarget: 'Save dashboard', verify: 'on-page:/d/x' }),
    ],
    [
      'MISSING_VERIFY',
      interactive({ content: 'Save dashboard' }),
      interactive({ content: 'Save dashboard', verify: 'on-page:/d/x' }),
    ],
    [
      'EDITOR_CODE_IN_MARKDOWN',
      section('S', md('Enter this query in the editor:\n\n```sql\nSELECT 1\n```')),
      section('S', md('Example output:\n\n```sql\nSELECT 1\n```')),
    ],
    ['ADJACENT_SECTIONS', section('A'), section('A')],
    ['ADJACENT_VISUALS', { type: 'divider', id: 'd1' } as JsonBlock, { type: 'divider', id: 'd1' } as JsonBlock],
  ];

  it('does not flag MISSING_VERIFY on multistep or guided steps, which cannot carry verify', () => {
    const steps = [
      step({ action: 'button', reftarget: 'Save dashboard' }),
      step({ description: 'Save the dashboard' }),
    ];
    const guided = { type: 'guided', id: 'g', content: 'Do', steps } as unknown as JsonBlock;
    expect(codes(guide(multistep(steps)))).not.toContain('MISSING_VERIFY');
    expect(codes(guide(guided))).not.toContain('MISSING_VERIFY');
  });

  it.each(cases)('%s flags and clears', (rule, flagged, clean) => {
    const wrap = (block: JsonBlock) =>
      rule === 'ADJACENT_VISUALS' || rule === 'ADJACENT_SECTIONS'
        ? guide(
            block,
            block === flagged ? (rule === 'ADJACENT_SECTIONS' ? section('B') : callout('c2')) : md('between')
          )
        : guide(block);
    expect(codes(wrap(flagged))).toContain(rule);
    expect(codes(wrap(clean))).not.toContain(rule);
  });

  it('reports the sub-path of a flagged step and falls back to the path for an unidentified block', () => {
    const hints = blockHints(guide(multistep([step(), step({ action: 'noop' })])));
    expect(hints.find((h) => h.code === 'NOOP_STEP')).toMatchObject({ blockId: 'm', path: 'blocks[0].steps[1]' });
    expect(blockHints(guide({ type: 'markdown', content: '<p class="a">x</p>' }))[0]?.blockId).toBe('blocks[0]');
  });
});

describe('guide rules', () => {
  const ok = [md('# Title\n\nIntro.', 'a'), md('## One\n\nText.', 'b'), md('Summary.', 'z')];

  it('CLOSING_SUMMARY', () => {
    expect(guideCodes(guide(md('# T'), callout('c')))).toContain('CLOSING_SUMMARY');
    expect(guideCodes(guide(...ok))).not.toContain('CLOSING_SUMMARY');
  });

  it('SMALL_SECTION', () => {
    const steps = [md('lead'), md('one'), md('two')];
    expect(guideCodes(guide(md('# T'), section('S', md('lead'), md('one')), md('end')))).toContain('SMALL_SECTION');
    expect(guideCodes(guide(md('# T'), section('S', ...steps), md('end')))).not.toContain('SMALL_SECTION');
  });

  it('CALLOUTS_PER_TOPIC', () => {
    const two = guide(md('# T'), md('## A'), callout('c1'), callout('c2'), md('end'));
    const split = guide(md('# T'), md('## A'), callout('c1'), md('## B'), callout('c2'), md('end'));
    expect(guideHints(two).filter((h) => h.code === 'CALLOUTS_PER_TOPIC')).toEqual([
      expect.objectContaining({ blockId: 'c2' }),
    ]);
    expect(guideCodes(split)).not.toContain('CALLOUTS_PER_TOPIC');
  });

  it('UNANCHORED_FIRST_STEP', () => {
    expect(guideCodes(guide(md('# T'), interactive({ requirements: [] })))).toContain('UNANCHORED_FIRST_STEP');
    expect(guideCodes(guide(md('# T'), interactive({ action: 'navigate', requirements: [] })))).not.toContain(
      'UNANCHORED_FIRST_STEP'
    );
    expect(guideCodes(guide(md('# T'), interactive()))).not.toContain('UNANCHORED_FIRST_STEP');
  });
});

describe('kind rules', () => {
  const quiz = { type: 'quiz', id: 'q', question: 'Q', choices: [] };

  it('TEACH_NO_QUIZ', () => {
    expect(guideCodes(guide(md('# T')), 'teach')).toContain('TEACH_NO_QUIZ');
    expect(guideCodes(guide(md('# T'), quiz), 'teach')).not.toContain('TEACH_NO_QUIZ');
  });

  it('WALKTHROUGH_NO_INTERACTIVE', () => {
    expect(guideCodes(guide(md('# T')), 'walkthrough')).toContain('WALKTHROUGH_NO_INTERACTIVE');
    expect(guideCodes(guide(md('# T'), multistep([step(), step()])), 'walkthrough')).not.toContain(
      'WALKTHROUGH_NO_INTERACTIVE'
    );
  });

  it('REFERENCE_HAS_INTERACTIVE', () => {
    expect(guideCodes(guide(md('# T'), interactive()), 'reference')).toContain('REFERENCE_HAS_INTERACTIVE');
    expect(guideCodes(guide(md('# T')), 'reference')).not.toContain('REFERENCE_HAS_INTERACTIVE');
  });

  it('skips kind checks and says so when no kind is given', () => {
    const codesWithoutKind = guideCodes(guide(md('# T')));
    expect(codesWithoutKind).toContain('KIND_NOT_GIVEN');
    expect(codesWithoutKind).not.toContain('TEACH_NO_QUIZ');
    expect(guideCodes(guide(md('# T')), 'teach')).not.toContain('KIND_NOT_GIVEN');
  });
});

describe('verified selectors', () => {
  const labelled = interactive({ reftarget: 'button[aria-label="Save"]' });
  const verified = new Set(['button[aria-label="Save"]']);

  it('does not flag a selector in the verified set', () => {
    expect(blockHints(guide(labelled), verified).map((h) => h.code)).not.toContain('TEXT_SELECTOR');
  });

  it('flags the same selector when it is not in the set', () => {
    expect(blockHints(guide(labelled), new Set(['other'])).map((h) => h.code)).toContain('TEXT_SELECTOR');
  });

  it('flags it as before when no set is given', () => {
    expect(codes(guide(labelled))).toContain('TEXT_SELECTOR');
  });
});

describe('runner', () => {
  it('reports only hints that are new after the edit', () => {
    const before = guide(multistep([step()]));
    const after = guide(multistep([step()]), md('more'));
    expect(mutationQualityHints(before, after)).toBeUndefined();
    expect(mutationQualityHints(guide(), before)?.blocks.map((h) => h.code)).toEqual(['SINGLE_STEP_MULTISTEP']);
  });

  it('caps the list and counts what it cut', () => {
    const noisy = guide(...Array.from({ length: 8 }, (_, i) => ({ ...interactive({ action: 'noop' }), id: `n${i}` })));
    const hints = mutationQualityHints(guide(), noisy);
    expect(hints?.blocks).toHaveLength(MAX_HINTS);
    expect(hints?.more).toBe(blockHints(noisy).length - MAX_HINTS);
  });

  it('returns the full current list with guide hints first and no cap', () => {
    const noisy = guide(
      md('x'),
      ...Array.from({ length: 8 }, (_, i) => ({ ...interactive({ action: 'noop' }), id: `n${i}` }))
    );
    const hints = currentQualityHints(noisy);
    expect(Object.keys(hints ?? {})).toEqual(['guide', 'blocks']);
    expect(hints?.guide.map((h) => h.code)).toContain('KIND_NOT_GIVEN');
    expect(hints?.blocks.length).toBeGreaterThan(MAX_HINTS);
  });
});
