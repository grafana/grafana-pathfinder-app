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

it.each([
  (json: string) => `Here is the customized guide:\n\n\`\`\`json\n${json}\n\`\`\`\nReview it before publishing.`,
  (json: string) => `Here is your guide:\n${json}\nDone.`,
  (json: string) => JSON.stringify({ guide: JSON.parse(json) }),
])('accepts a complete guide surrounded by Assistant formatting', (wrap) => {
  expect(parseCustomizedGuide(wrap(JSON.stringify(source)), source, url)).toEqual(source);
});

it('restores the client-owned id before validating a response that omits it', () => {
  expect(parseCustomizedGuide(JSON.stringify({ title: 'New', blocks: source.blocks }), source, url).id).toBe(source.id);
});

it('reports the invalid field rather than hiding schema errors', () => {
  expect(() => parseCustomizedGuide(JSON.stringify({ ...source, blocks: [{ type: 'invalid' }] }), source, url)).toThrow(
    /blocks/
  );
});
