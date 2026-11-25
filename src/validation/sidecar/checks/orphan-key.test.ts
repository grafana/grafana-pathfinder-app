import type { ContentJson } from '../../../types/package.types';
import type { TranslationSidecar } from '../../../types/translation-sidecar.schema';
import { contextOf, sidecarOf } from '../../../test-utils/sidecar-check-context';
import { validateSidecars } from '../index';
import { orphanKeyCheck } from './orphan-key';

const content = {
  id: 'guide',
  title: 'Guide',
  blocks: [
    { type: 'markdown', id: 'intro', content: 'Hello' },
    {
      type: 'section',
      id: 'setup',
      title: 'Setup',
      blocks: [
        { type: 'multistep', id: 'add-panel', content: 'Add it.', steps: [{ id: 'open-menu', action: 'button' }] },
        {
          type: 'conditional',
          id: 'branch',
          conditions: ['x'],
          whenTrue: [{ type: 'markdown', id: 'deep-true', content: 'a' }],
          whenFalse: [{ type: 'markdown', id: 'deep-false', content: 'b' }],
        },
      ],
    },
  ],
} as unknown as ContentJson;

const run = (blocks: TranslationSidecar['blocks'], tag = 'ja') =>
  orphanKeyCheck.run(contextOf([sidecarOf(tag, { blocks })], { content }));

describe('orphan-key check', () => {
  it('finds nothing when every key matches a block, nested ones and both branches included', () => {
    expect(
      run({
        intro: { content: 'x' },
        setup: { title: 'x' },
        'add-panel': { content: 'x', steps: { 'open-menu': { description: 'x' } } },
        'deep-true': { content: 'x' },
        'deep-false': { content: 'x' },
      })
    ).toEqual([]);
  });

  it('finds nothing in a sidecar with no blocks', () => {
    expect(run(undefined)).toEqual([]);
  });

  it('warns on a top-level key that matches no block, naming the id and what to do', () => {
    expect(run({ intro: { content: 'x' }, gone: { content: 'x' } })).toEqual([
      {
        severity: 'warn',
        code: 'sidecar_orphan_key',
        message: 'i18n/ja.json: blocks.gone matches no block id in content.json',
        path: ['i18n/ja.json', 'blocks', 'gone'],
        remediation: expect.stringMatching(/renamed.*re-key.*removed.*delete/),
      },
    ]);
  });

  it('warns on a key that used to match a nested block', () => {
    const findings = run({ 'old-nested': { content: 'x' } });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ code: 'sidecar_orphan_key', path: ['i18n/ja.json', 'blocks', 'old-nested'] });
  });

  it('warns on a step key its block no longer has', () => {
    expect(
      run({ 'add-panel': { steps: { 'open-menu': { description: 'x' }, 'old-step': { description: 'x' } } } })
    ).toEqual([
      {
        severity: 'warn',
        code: 'sidecar_orphan_step',
        message: 'i18n/ja.json: blocks.add-panel.steps.old-step matches no step id in block "add-panel"',
        path: ['i18n/ja.json', 'blocks', 'add-panel', 'steps', 'old-step'],
        remediation: expect.stringMatching(/renamed.*re-key.*removed.*delete/),
      },
    ]);
  });

  it('leaves a steps entry on a block with no steps to projection-conformance', () => {
    expect(run({ intro: { steps: { whatever: { description: 'x' } } } })).toEqual([]);
  });

  it('reports one finding for an orphaned block, not one per step', () => {
    expect(run({ gone: { steps: { a: { description: 'x' } } } }).map((finding) => finding.code)).toEqual([
      'sidecar_orphan_key',
    ]);
  });

  it('reports each sidecar under its own file', () => {
    const findings = orphanKeyCheck.run(
      contextOf([sidecarOf('ja', { blocks: { a: {} } }), sidecarOf('ja-JP', { blocks: { b: {} } })], { content })
    );
    expect(findings.map((finding) => finding.path[0])).toEqual(['i18n/ja.json', 'i18n/ja-JP.json']);
  });

  it('is routed as a warning that survives --strict', () => {
    const { errors, messages } = validateSidecars({
      content,
      manifest: undefined,
      sidecars: [sidecarOf('ja', { blocks: { gone: {} } })],
    });
    expect(errors).toEqual([]);
    expect(messages).toEqual([expect.objectContaining({ severity: 'warn', code: 'sidecar_orphan_key' })]);
  });
});
