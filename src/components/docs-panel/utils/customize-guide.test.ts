import type { JsonGuide } from '../../../types/json-guide.types';
import { buildGuideCustomizationPrompt, parseCustomizedGuide } from './customize-guide';

const source: JsonGuide = {
  id: 'private-copy',
  title: 'Original (copy)',
  blocks: [{ type: 'markdown', content: 'Original content' }],
};
const url = 'https://grafana.com/guides/example/content.json';

it('includes the full guide and all customization answers', () => {
  const answers = { audience: 'New developers', outcome: 'Query our logs', environment: 'Loki: production' };
  expect(JSON.parse(buildGuideCustomizationPrompt(source, answers))).toEqual({ customization: answers, guide: source });
});

it('keeps the independent copy identity and resolves generated relative media', () => {
  const generated = {
    ...source,
    id: 'public-original',
    title: 'Our guide',
    blocks: [{ type: 'image', src: './image.png', alt: 'Example' }],
  };
  const result = parseCustomizedGuide('```json\n' + JSON.stringify(generated) + '\n```', source, url);
  expect(result.id).toBe(source.id);
  expect(result.title).toBe('Our guide');
  expect(result.blocks[0]).toMatchObject({ src: 'https://grafana.com/guides/example/image.png' });
  expect(source.blocks[0]).toEqual({ type: 'markdown', content: 'Original content' });
});

it.each([
  'not JSON',
  JSON.stringify({ ...source, blocks: [] }),
  JSON.stringify({ ...source, blocks: [{ type: 'unknown' }] }),
  JSON.stringify({
    ...source,
    blocks: [{ type: 'section', title: 'Nested', blocks: [{ type: 'snippet-ref', snippetId: 'shared' }] }],
  }),
])('rejects unusable assistant output: %s', (response) => {
  expect(() => parseCustomizedGuide(response, source, url)).toThrow();
});
