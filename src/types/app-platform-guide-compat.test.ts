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
        conditions: ['always'],
        whenTrue: [{ type: 'divider', id: 'true-divider' }],
        whenFalse: [{ type: 'divider', id: 'false-divider' }],
      },
    ]);

    expect(decodeAppPlatformGuideBlocks(persisted)).toEqual([
      {
        type: 'conditional',
        conditions: ['always'],
        whenTrue: [{ type: 'divider', id: 'true-divider' }],
        whenFalse: [{ type: 'divider', id: 'false-divider' }],
      },
    ]);
  });

  it('does not reinterpret ordinary markdown', () => {
    const markdown: JsonBlock[] = [{ type: 'markdown', id: 'rule', content: '---' }];

    expect(decodeAppPlatformGuideBlocks(markdown)).toEqual(markdown);
  });
});
