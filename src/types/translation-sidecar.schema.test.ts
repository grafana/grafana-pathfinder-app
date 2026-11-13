import { TranslationSidecarSchema } from './translation-sidecar.schema';

const HASH = `sha256:${'0'.repeat(64)}`;

// docs/design/I18N.md §5.3, with the guide title carried as a `guide` entry.
const DESIGN_DOC_EXAMPLE = {
  schemaVersion: '1.0.0',
  language: 'ja',
  baseRef: { commit: '8f2c41d', path: 'first-dashboard/content.json' },
  guide: { title: '最初のダッシュボードを作成する', reviewed: true, _sourceHash: HASH },
  manifest: {
    description: 'パネルの追加からダッシュボードの保存までを学びます。',
    category: 'はじめに',
    reviewed: true,
    _sourceHash: HASH,
  },
  blocks: {
    'intro-md': { content: '# ようこそ\n\nこのガイドでは…', reviewed: true, _sourceHash: HASH },
    'add-panel': { content: 'パネルを追加します。', tooltip: 'ここをクリック', reviewed: true, _sourceHash: HASH },
    'save-dashboard': {
      content: 'ダッシュボードを保存します。',
      steps: {
        'open-save': { description: '保存ダイアログを開きます。' },
        'confirm-save': { description: '保存を確定します。' },
      },
      reviewed: false,
      _sourceHash: HASH,
    },
  },
};

describe('TranslationSidecarSchema', () => {
  it('accepts the design doc example', () => {
    const result = TranslationSidecarSchema.safeParse(DESIGN_DOC_EXAMPLE);
    expect(result.success).toBe(true);
  });

  it('accepts a metapackage sidecar with only a manifest entry', () => {
    const result = TranslationSidecarSchema.safeParse({
      schemaVersion: '1.0.0',
      language: 'ja',
      manifest: { description: '説明', reviewed: true, _sourceHash: HASH },
    });
    expect(result.success).toBe(true);
  });

  it('accepts the tooling-stamped availability latch', () => {
    const result = TranslationSidecarSchema.safeParse({ ...DESIGN_DOC_EXAMPLE, _available: true });
    expect(result.success).toBe(true);
  });

  it.each([
    ['a bare top-level title', { title: 'タイトル' }],
    ['an unknown root key', { notes: 'x' }],
    ['an unknown underscore root key', { _reviewedBy: 'someone' }],
  ])('rejects %s', (_label, extra) => {
    const result = TranslationSidecarSchema.safeParse({ ...DESIGN_DOC_EXAMPLE, ...extra });
    expect(result.success).toBe(false);
  });

  it('requires schemaVersion and language', () => {
    expect(TranslationSidecarSchema.safeParse({ language: 'ja' }).success).toBe(false);
    expect(TranslationSidecarSchema.safeParse({ schemaVersion: '1.0.0' }).success).toBe(false);
  });

  it('parses unknown fields inside a block entry, so a check can name them', () => {
    const result = TranslationSidecarSchema.safeParse({
      schemaVersion: '1.0.0',
      language: 'ja',
      blocks: {
        'intro-md': { content: '本文', tooltip: '不要', reftarget: 'button', requirements: ['x'] },
      },
    });
    expect(result.success).toBe(true);
    expect(result.data?.blocks?.['intro-md']).toEqual({
      content: '本文',
      tooltip: '不要',
      reftarget: 'button',
      requirements: ['x'],
    });
  });

  it('parses unknown keys inside the manifest entry, so a check can name them', () => {
    const result = TranslationSidecarSchema.safeParse({
      schemaVersion: '1.0.0',
      language: 'ja',
      manifest: { description: '説明', milestones: ['a'] },
    });
    expect(result.success).toBe(true);
    expect(result.data?.manifest?.milestones).toEqual(['a']);
  });

  it('rejects an unknown key in the guide entry', () => {
    const result = TranslationSidecarSchema.safeParse({
      schemaVersion: '1.0.0',
      language: 'ja',
      guide: { title: 'タイトル', description: '説明' },
    });
    expect(result.success).toBe(false);
  });

  it('requires step fields to be strings', () => {
    const result = TranslationSidecarSchema.safeParse({
      schemaVersion: '1.0.0',
      language: 'ja',
      blocks: { 'save-dashboard': { steps: { 'open-save': { description: 5 } } } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-boolean review mark', () => {
    const result = TranslationSidecarSchema.safeParse({
      schemaVersion: '1.0.0',
      language: 'ja',
      blocks: { 'intro-md': { content: '本文', reviewed: 'yes' } },
    });
    expect(result.success).toBe(false);
  });
});
