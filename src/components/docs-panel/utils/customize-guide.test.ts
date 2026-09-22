import type { JsonGuide } from '../../../types/json-guide.types';
import {
  buildGuideCustomizationPrompt,
  buildGuideRepairPrompt,
  GUIDE_CUSTOMIZATION_MAX_CHARS,
  parseCustomizedGuide,
} from './customize-guide';

const source: JsonGuide = {
  id: 'private-copy',
  title: 'Original (copy)',
  blocks: [{ type: 'markdown', content: 'Original content' }],
};
const url = 'https://grafana.com/guides/example/content.json';

it('includes the full guide and all customization answers', () => {
  const answers = { audience: 'New developers', outcome: 'Query our logs', environment: 'Loki: production' };
  expect(JSON.parse(buildGuideCustomizationPrompt(source, answers))).toMatchObject({
    customization: answers,
    guide: source,
  });
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

const interactiveSource: JsonGuide = {
  ...source,
  blocks: [
    {
      type: 'section',
      id: 'setup',
      title: 'Set up the data source',
      blocks: [
        {
          type: 'interactive',
          action: 'navigate',
          reftarget: '/connections/datasources',
          content: 'Open data sources',
        },
      ],
    },
  ],
};

it('rejects a retained interactive section converted to a static checklist', () => {
  const generated = {
    ...interactiveSource,
    blocks: [
      {
        type: 'section',
        id: 'setup',
        title: 'Prepare your data source',
        blocks: [{ type: 'markdown', content: 'Ask your administrator to configure Prometheus.' }],
      },
    ],
  };
  expect(() => parseCustomizedGuide(JSON.stringify(generated), interactiveSource, url)).toThrow(
    /setup.*lost its interactive steps/
  );
});

it('accepts interactive setup adapted to an existing data source without changing the source', () => {
  const generated: JsonGuide = {
    ...interactiveSource,
    blocks: [
      {
        type: 'section',
        id: 'setup',
        title: 'Open play Pathfinder',
        blocks: [
          {
            type: 'interactive',
            action: 'navigate',
            reftarget: '/connections/datasources/edit/play',
            content: 'Open play Pathfinder',
          },
        ],
      },
    ],
  };
  expect(parseCustomizedGuide(JSON.stringify(generated), interactiveSource, url)).toEqual(generated);
  expect(interactiveSource.blocks[0]).toMatchObject({ title: 'Set up the data source' });
});

it('checks interactive sections nested in conditional branches', () => {
  const nested: JsonGuide = {
    ...source,
    blocks: [
      {
        type: 'conditional',
        conditions: ['has-datasource:prometheus'],
        whenTrue: interactiveSource.blocks,
        whenFalse: [],
      },
    ],
  };
  const generated: JsonGuide = {
    ...nested,
    blocks: [
      {
        type: 'conditional',
        conditions: ['has-datasource:prometheus'],
        whenTrue: [
          {
            type: 'section',
            id: 'setup',
            title: 'Setup',
            blocks: [{ type: 'markdown', content: 'Configure it yourself' }],
          },
        ],
        whenFalse: [],
      },
    ],
  };
  expect(() => parseCustomizedGuide(JSON.stringify(generated), nested, url)).toThrow(/lost its interactive steps/);
});

it('allows obsolete sections to be removed rather than keeping misleading instructions', () => {
  expect(parseCustomizedGuide(JSON.stringify(source), interactiveSource, url)).toEqual(source);
});

it('includes a compact action reference and the same environment on repair', () => {
  const answers = { audience: '', outcome: 'Use Prometheus', environment: '' };
  const context = { grafanaVersion: '13.2.2', uiFeatures: { queryEditorNext: true } };
  const initial = JSON.parse(buildGuideCustomizationPrompt(source, answers, [], context));
  const repair = JSON.parse(buildGuideRepairPrompt(source, answers, 'invalid', 'invalid JSON', [], context));
  expect(initial.blockReference.interactive.action).toBe('formfill');
  expect(repair.blockReference).toEqual(initial.blockReference);
  expect(repair.grafanaContext).toEqual(context);
});

it('rejects oversized initial and repair prompts without truncating the guide', () => {
  const answers = { audience: '', outcome: 'Customize', environment: '' };
  const large = 'x'.repeat(GUIDE_CUSTOMIZATION_MAX_CHARS);
  expect(() => buildGuideCustomizationPrompt(source, { ...answers, environment: large })).toThrow(/too large/);
  expect(() => buildGuideRepairPrompt(source, answers, large, 'invalid')).toThrow(/too large/);
  expect(source.blocks).toHaveLength(1);
});
