import { preserveGuideUrls } from './preserve-guide-urls';
import type { JsonGuide } from '../../../types/json-guide.types';

const baseUrl = 'https://cdn.example.com/guides/demo/content.json';

function copy(blocks: JsonGuide['blocks']) {
  return preserveGuideUrls({ id: 'test', title: 'Test', blocks }, baseUrl).blocks;
}

it('preserves relative media in nested blocks without touching actions, code or Grafana routes', () => {
  const blocks: JsonGuide['blocks'] = [
    {
      type: 'section',
      title: 'Media',
      blocks: [
        { type: 'image', src: 'assets/demo.png', alt: 'Demo' },
        { type: 'video', provider: 'native', src: '../demo.mp4' },
        { type: 'markdown', content: '[Dashboard](/d/demo) and `![code](assets/code.png)`' },
        { type: 'interactive', action: 'navigate', reftarget: '/d/demo', content: 'Open dashboard' },
      ],
    },
  ];
  const result = copy(blocks);
  expect(result).toEqual([
    {
      ...blocks[0],
      blocks: [
        { type: 'image', src: 'https://cdn.example.com/guides/demo/assets/demo.png', alt: 'Demo' },
        { type: 'video', provider: 'native', src: 'https://cdn.example.com/guides/demo.mp4' },
        ...(blocks[0]?.type === 'section' ? blocks[0].blocks.slice(2) : []),
      ],
    },
  ]);
});

it('preserves media and document links embedded in Markdown and HTML', () => {
  const result = copy([
    { type: 'markdown', content: '![Demo](./demo.png)\n\n[Reference](../reference/)\n\n[Local](#step)' },
    { type: 'html', content: '<img src="/media/demo.png"><a href="./details">Details</a>' },
  ]);
  expect(JSON.stringify(result)).toContain('https://cdn.example.com/guides/demo/demo.png');
  expect(JSON.stringify(result)).toContain('https://cdn.example.com/guides/reference/');
  expect(JSON.stringify(result)).toContain('#step');
  expect(JSON.stringify(result)).toContain('https://cdn.example.com/media/demo.png');
  expect(JSON.stringify(result)).toContain('https://cdn.example.com/guides/demo/details');
});

it('uses the existing bundled asset fallback and rejects unsafe schemes', () => {
  expect(
    preserveGuideUrls({ id: 'x', title: 'X', blocks: [{ type: 'image', src: 'demo.png' }] }, 'bundled:demo').blocks
  ).toEqual([{ type: 'image', src: 'https://grafana.com/demo.png' }]);
  expect(() => copy([{ type: 'image', src: 'javascript:alert(1)' }])).toThrow('unsupported');
});

it('resolves protocol-relative media without changing absolute media URLs', () => {
  expect(
    copy([
      { type: 'image', src: '//cdn.example.com/demo.png' },
      { type: 'image', src: 'https://cdn.example.com/existing.png' },
    ])
  ).toEqual([
    { type: 'image', src: 'https://cdn.example.com/demo.png' },
    { type: 'image', src: 'https://cdn.example.com/existing.png' },
  ]);
});
