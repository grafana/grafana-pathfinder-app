import type { JsonBlock } from './json-guide.types';
import {
  decodeAppPlatformGuideBlocks,
  encodeAppPlatformGuideBlocks,
  PERSISTED_DIVIDER_MARKDOWN,
} from './app-platform-guide-compat';

describe('App Platform guide compatibility', () => {
  it('stores dividers as markdown that pre-divider readers can validate', () => {
    const blocks: JsonBlock[] = [
      { type: 'divider', id: 'top-level' },
      {
        type: 'section',
        id: 'section',
        blocks: [{ type: 'divider', id: 'nested' }],
      },
    ];

    expect(encodeAppPlatformGuideBlocks(blocks)).toEqual([
      { type: 'markdown', id: 'top-level', content: PERSISTED_DIVIDER_MARKDOWN },
      {
        type: 'section',
        id: 'section',
        blocks: [{ type: 'markdown', id: 'nested', content: PERSISTED_DIVIDER_MARKDOWN }],
      },
    ]);
  });

  it('restores persisted divider markdown for current readers', () => {
    const persisted = encodeAppPlatformGuideBlocks([
      {
        type: 'conditional',
        conditions: ['on-page:/'],
        whenTrue: [{ type: 'divider', id: 'true-divider' }],
        whenFalse: [{ type: 'divider', id: 'false-divider' }],
      },
    ]);

    expect(decodeAppPlatformGuideBlocks(persisted)).toEqual({
      ok: true,
      blocks: [
        {
          type: 'conditional',
          conditions: ['on-page:/'],
          whenTrue: [{ type: 'divider', id: 'true-divider' }],
          whenFalse: [{ type: 'divider', id: 'false-divider' }],
        },
      ],
    });
  });

  it.each(['hide', 'heading-only'] as const)(
    'round-trips checkbox groups and %s sections through CRD-compatible fields',
    (mode) => {
      const guide: JsonBlock[] = [
        {
          type: 'input',
          inputType: 'checkbox-group',
          prompt: 'Which environments?',
          variableName: 'environments',
          choices: [{ id: 'production', text: 'Production' }],
        },
        {
          type: 'section',
          id: 'production',
          title: 'Production',
          whenRequirementsUnmet: mode,
          requirements: ['var-environments:includes:production'],
          autoCollapse: false,
          blocks: [{ type: 'markdown', content: 'Configure production' }],
        },
      ];
      const encoded = encodeAppPlatformGuideBlocks(guide);
      expect(encoded[0]).toMatchObject({ inputType: 'text' });
      expect(encoded[1]).toMatchObject({ type: 'conditional' });
      expect(JSON.stringify(encoded)).not.toContain('whenRequirementsUnmet');
      expect(decodeAppPlatformGuideBlocks(encoded)).toEqual({ ok: true, blocks: guide });
    }
  );

  it('does not reinterpret ordinary markdown', () => {
    const markdown: JsonBlock[] = [{ type: 'markdown', id: 'rule', content: '---' }];

    expect(decodeAppPlatformGuideBlocks(markdown)).toEqual({ ok: true, blocks: markdown });
  });

  it('preserves unknown fields from newer deployments after validation', () => {
    const persisted = [
      {
        type: 'section',
        id: 'future-section',
        futureSectionOption: 'keep-me',
        blocks: [{ type: 'markdown', content: 'Future content', futureBlockOption: { enabled: true } }],
      },
    ];

    const decoded = decodeAppPlatformGuideBlocks(persisted);
    expect(decoded.ok && encodeAppPlatformGuideBlocks(decoded.blocks)).toEqual(persisted);
  });

  it('normalizes legacy action aliases on blocks and multistep steps', () => {
    expect(
      decodeAppPlatformGuideBlocks([
        {
          type: 'interactive',
          content: 'Open Explore',
          targetAction: 'navigate',
          refTarget: '/explore',
        },
        {
          type: 'multistep',
          content: 'Configure it',
          steps: [{ targetAction: 'button', refTarget: 'Save', targetState: true }],
        },
      ])
    ).toEqual({
      ok: true,
      blocks: [
        { type: 'interactive', content: 'Open Explore', action: 'navigate', reftarget: '/explore' },
        {
          type: 'multistep',
          content: 'Configure it',
          steps: [{ action: 'button', reftarget: 'Save', targetstate: 'true' }],
        },
      ],
    });
  });

  it('rejects malformed data in a persisted section visibility wrapper', () => {
    const [wrapper] = encodeAppPlatformGuideBlocks([
      { type: 'section', id: 'summary', whenRequirementsUnmet: 'hide', blocks: [] },
    ]);
    expect(decodeAppPlatformGuideBlocks([{ ...wrapper, whenFalse: null }]).ok).toBe(false);
  });

  it.each([null, '', 17])('restores a stored divider without an unusable id (%p)', (id) => {
    expect(decodeAppPlatformGuideBlocks([{ type: 'markdown', id, content: PERSISTED_DIVIDER_MARKDOWN }])).toEqual({
      ok: true,
      blocks: [{ type: 'divider' }],
    });
  });

  it('returns a validation error for excessively nested external data', () => {
    let block: unknown = { type: 'divider' };
    for (let depth = 0; depth < 10000; depth++) {
      block = { type: 'conditional', conditions: ['always'], whenTrue: [block], whenFalse: [] };
    }
    expect(decodeAppPlatformGuideBlocks([block]).ok).toBe(false);
  });

  it('returns validation issues before recursively decoding malformed external data', () => {
    const result = decodeAppPlatformGuideBlocks([
      {
        type: 'conditional',
        conditions: ['on-page:/'],
        whenTrue: [{ type: 'divider' }],
        whenFalse: [{ content: PERSISTED_DIVIDER_MARKDOWN }],
      },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
