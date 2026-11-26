/**
 * @jest-environment node
 */

/** The `stampIds` rule: which units get an id, and which id. */

import type { ContentJson } from '../../types/package.types';
import { stampIds } from '../utils/package-io';

type Loose = Record<string, any>;

function guide(blocks: Loose[]): ContentJson {
  return { schemaVersion: '1.1.0', id: 'stamp-demo', title: 'Stamp demo', blocks } as unknown as ContentJson;
}

function ids(content: ContentJson): unknown[] {
  const out: unknown[] = [];
  const visit = (blocks: Loose[]) => {
    for (const block of blocks) {
      out.push(block.id);
      for (const step of block.steps ?? []) {
        out.push(step.id);
      }
      visit(block.blocks ?? []);
      visit(block.whenTrue ?? []);
      visit(block.whenFalse ?? []);
    }
  };
  visit(content.blocks as Loose[]);
  return out;
}

const md = (extra: Loose = {}) => ({ type: 'markdown', content: 'Some text', ...extra });
const step = (extra: Loose = {}) => ({ action: 'button', reftarget: 'Save', description: 'Click Save.', ...extra });

describe('stampIds', () => {
  it('stamps a guide with no ids as <type>-<n> in document order', () => {
    const { content, stamped } = stampIds(
      guide([md(), { type: 'image', src: 'https://example.com/a.png', alt: 'A' }, md({ content: 'More' })])
    );
    expect(ids(content)).toEqual(['markdown-1', 'image-1', 'markdown-2']);
    expect(stamped.map((s) => s.id)).toEqual(['markdown-1', 'image-1', 'markdown-2']);
  });

  it('never changes an existing id and picks the smallest free number', () => {
    const { content } = stampIds(guide([md({ id: 'intro' }), md(), md({ id: 'markdown-2' }), md()]));
    expect(ids(content)).toEqual(['intro', 'markdown-1', 'markdown-2', 'markdown-3']);
  });

  it('avoids a generated name that a later block already owns', () => {
    const { content } = stampIds(guide([md(), md({ id: 'markdown-1' })]));
    expect(ids(content)).toEqual(['markdown-2', 'markdown-1']);
  });

  it('descends sections, collapsibles, assistants and both conditional branches', () => {
    const { content } = stampIds(
      guide([
        {
          type: 'section',
          id: 'outer',
          title: 'Outer',
          blocks: [
            md(),
            {
              type: 'conditional',
              conditions: ['has-datasource:prometheus'],
              whenTrue: [md({ content: 'yes' })],
              whenFalse: [md({ content: 'no' })],
            },
          ],
        },
        { type: 'collapsible', id: 'more', title: 'More', blocks: [md({ content: 'inside' })] },
      ])
    );
    expect(ids(content)).toEqual([
      'outer',
      'markdown-1',
      'conditional-1',
      'markdown-2',
      'markdown-3',
      'more',
      'markdown-4',
    ]);
  });

  it('stamps the steps of a multistep like drilldown-metrics-lj/add-metric-dashboard', () => {
    const { content, stamped } = stampIds(
      guide([{ type: 'multistep', content: 'Add the metric to a dashboard.', steps: [step(), step(), step()] }])
    );
    expect(ids(content)).toEqual(['multistep-1', 'multistep-1-step-1', 'multistep-1-step-2', 'multistep-1-step-3']);
    expect(stamped.filter((s) => s.kind === 'step').map((s) => s.parentId)).toEqual([
      'multistep-1',
      'multistep-1',
      'multistep-1',
    ]);
  });

  it('keeps existing step ids and numbers the rest around them', () => {
    const { content } = stampIds(
      guide([
        {
          type: 'guided',
          id: 'save',
          content: 'Save it.',
          steps: [step(), step({ id: 'save-step-2' }), step(), step({ id: 'confirm' })],
        },
      ])
    );
    expect(ids(content)).toEqual(['save', 'save-step-1', 'save-step-2', 'save-step-3', 'confirm']);
  });

  it('leaves block types outside the projection table alone', () => {
    const input = guide([
      { type: 'quiz', question: 'Q?', choices: [{ id: 'a', text: 'A', correct: true }] },
      { type: 'callout', title: 'Note', content: 'Text' },
    ]);
    const { content, stamped } = stampIds(input);
    expect(stamped).toEqual([]);
    expect(content).toEqual(input);
  });

  it('writes the id after type on a block and first on a step', () => {
    const { content } = stampIds(guide([{ type: 'multistep', content: 'x', steps: [step()] }]));
    const block = content.blocks[0] as Loose;
    expect(Object.keys(block)).toEqual(['type', 'id', 'content', 'steps']);
    expect(Object.keys(block.steps[0])).toEqual(['id', 'action', 'reftarget', 'description']);
  });

  it('does not change its input', () => {
    const input = guide([md(), { type: 'multistep', content: 'x', steps: [step()] }]);
    const before = JSON.stringify(input);
    stampIds(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('is deterministic and stamps nothing the second time', () => {
    const input = guide([
      md(),
      { type: 'section', title: 'S', blocks: [md(), { type: 'guided', content: 'g', steps: [step(), step()] }] },
    ]);
    const first = stampIds(input);
    expect(JSON.stringify(stampIds(input).content)).toBe(JSON.stringify(first.content));
    const second = stampIds(first.content);
    expect(second.stamped).toEqual([]);
    expect(JSON.stringify(second.content)).toBe(JSON.stringify(first.content));
  });

  it('treats an empty id as missing', () => {
    const { content } = stampIds(guide([md({ id: '' })]));
    expect(ids(content)).toEqual(['markdown-1']);
  });
});
