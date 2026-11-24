import type { ContentJson } from '../../../types/package.types';
import { contextOf, sidecarOf } from '../../../test-utils/sidecar-check-context';
import { validateSidecars } from '../index';
import { translatableIdsCheck } from './translatable-ids';

type Loose = Record<string, any>;

const guide = (blocks: Loose[]) => ({ id: 'guide', title: 'Guide', blocks }) as unknown as ContentJson;
const run = (blocks: Loose[]) => translatableIdsCheck.run(contextOf([sidecarOf('ja')], { content: guide(blocks) }));
const codes = (blocks: Loose[]) => run(blocks).map((finding) => finding.code);
const step = (extra: Loose = {}) => ({ action: 'button', reftarget: 'Save', description: 'Click Save.', ...extra });
const md = (extra: Loose = {}) => ({ type: 'markdown', content: 'Some text', ...extra });

describe('translatable-ids check', () => {
  it('finds nothing when every translatable block and step has a unique id', () => {
    expect(
      run([
        md({ id: 'intro' }),
        { type: 'multistep', id: 'add', content: 'x', steps: [step({ id: 'a' }), step({ id: 'b' })] },
      ])
    ).toEqual([]);
  });

  it('reports a translatable block with no id, with its path and the stamp-ids remediation', () => {
    expect(run([md({ id: 'intro' }), md()])).toEqual([
      {
        severity: 'error',
        code: 'translatable_block_missing_id',
        message: expect.stringContaining('pathfinder-cli stamp-ids <dir>'),
        path: ['content.json', 'blocks', '1'],
        remediation: 'pathfinder-cli stamp-ids <dir>',
      },
    ]);
  });

  it('counts blocks nested in sections and both conditional branches', () => {
    const findings = run([
      { type: 'section', id: 's', title: 'S', blocks: [md()] },
      {
        type: 'conditional',
        id: 'c',
        conditions: ['x'],
        whenTrue: [md()],
        whenFalse: [{ type: 'image', src: 'https://example.com/a.png', alt: 'A' }],
      },
    ]);
    expect(findings.map((finding) => finding.path)).toEqual([
      ['content.json', 'blocks', '0', 'blocks', '0'],
      ['content.json', 'blocks', '1', 'whenTrue', '0'],
      ['content.json', 'blocks', '1', 'whenFalse', '0'],
    ]);
  });

  it('reports every step without an id in a multistep, like interactive-tutorials add-metric-dashboard', () => {
    const findings = run([
      { type: 'multistep', id: 'add-metric', content: 'Add it.', steps: [step(), step(), step()] },
    ]);
    expect(findings.map((finding) => finding.code)).toEqual(Array(3).fill('translatable_step_missing_id'));
    expect(findings.map((finding) => finding.path)).toEqual([
      ['content.json', 'blocks', '0', 'steps', '0'],
      ['content.json', 'blocks', '0', 'steps', '1'],
      ['content.json', 'blocks', '0', 'steps', '2'],
    ]);
    expect(findings[0]).toMatchObject({ remediation: 'pathfinder-cli stamp-ids <dir>' });
  });

  it('checks the steps of a guided block too', () => {
    expect(codes([{ type: 'guided', id: 'g', content: 'x', steps: [step()] }])).toEqual([
      'translatable_step_missing_id',
    ]);
  });

  it('does not require ids on block types outside the projection table', () => {
    expect(
      run([
        { type: 'quiz', question: 'Q?', choices: [{ id: 'a', text: 'A', correct: true }] },
        { type: 'callout', title: 'Note', content: 'Text' },
        { type: 'divider' },
      ])
    ).toEqual([]);
  });

  it('does not require an id on a table block with no translatable text', () => {
    expect(run([{ type: 'image', src: 'https://example.com/a.png' }])).toEqual([]);
  });

  it('reports a block id used twice, naming both paths, anywhere in the guide', () => {
    const findings = run([md({ id: 'dup' }), { type: 'section', id: 's', title: 'S', blocks: [md({ id: 'dup' })] }]);
    expect(findings).toEqual([
      {
        severity: 'error',
        code: 'duplicate_block_id',
        message: expect.stringMatching(/"dup".*blocks\[0\].*blocks\[1\]\.blocks\[0\].*rename one/),
        path: ['content.json', 'blocks', '1', 'blocks', '0'],
      },
    ]);
  });

  it('reports a step id used twice in one block, but allows the same step id in two blocks', () => {
    expect(
      run([
        { type: 'multistep', id: 'm', content: 'x', steps: [step({ id: 'one' }), step({ id: 'one' })] },
        { type: 'multistep', id: 'n', content: 'x', steps: [step({ id: 'one' })] },
      ])
    ).toEqual([
      {
        severity: 'error',
        code: 'duplicate_step_id',
        message: expect.stringMatching(/"one".*blocks\[0\]\.steps\[0\].*blocks\[0\]\.steps\[1\].*rename one/),
        path: ['content.json', 'blocks', '0', 'steps', '1'],
      },
    ]);
  });

  it('only runs for a package that ships a sidecar', () => {
    const content = guide([md()]);
    expect(validateSidecars({ content, manifest: undefined, sidecars: [] }).errors).toEqual([]);
    expect(validateSidecars({ content, manifest: undefined, sidecars: [sidecarOf('ja')] }).errors).toEqual([
      expect.objectContaining({ code: 'translatable_block_missing_id' }),
    ]);
  });

  it('still runs when the only sidecar is unreadable', () => {
    const unreadable = {
      ok: false as const,
      tag: 'ja',
      filePath: '/package/i18n/ja.json',
      code: 'invalid_json' as const,
      message: 'Invalid JSON',
    };
    const { errors } = validateSidecars({ content: guide([md()]), manifest: undefined, sidecars: [unreadable] });
    expect(errors.map((error) => error.code)).toEqual(['sidecar_unreadable', 'translatable_block_missing_id']);
  });
});
