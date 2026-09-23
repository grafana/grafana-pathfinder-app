import { injectJourneyExtrasIntoJsonGuide, simpleMarkdownToHtml } from './cover-page';
import type { LearningJourneyMetadata, Milestone } from '../../types/content.types';

const milestone = (number: number, overrides: Partial<Milestone> = {}): Milestone => ({
  number,
  title: `Milestone ${number}`,
  url: `https://grafana.com/docs/learning-paths/demo/milestone-${number}/`,
  isActive: false,
  ...overrides,
});

// Cover-page metadata (milestone 0) so generateJourneyContentWithExtras emits a
// Ready-to-Begin button + bottom navigation as a trailing html block.
const coverMetadata: LearningJourneyMetadata = {
  currentMilestone: 0,
  totalMilestones: 2,
  milestones: [milestone(1), milestone(2)],
  baseUrl: 'https://grafana.com/docs/learning-paths/demo/',
};

const guide = (blocks: Array<{ type: string; content?: string }>): string =>
  JSON.stringify({ id: 'demo', title: 'Demo', blocks });

const parseBlocks = (json: string): Array<{ type: string; content?: string }> => JSON.parse(json).blocks;

describe('injectJourneyExtrasIntoJsonGuide — block splicing', () => {
  it('wraps a "what to expect" heading + body into an orange-outline-list html block', () => {
    const input = guide([
      { type: 'markdown', content: "## Here's what to expect\n\n- Learn alerting\n- Build a dashboard" },
    ]);

    const blocks = parseBlocks(injectJourneyExtrasIntoJsonGuide(input, coverMetadata));

    const card = blocks.find((b) => b.type === 'html' && b.content?.includes('orange-outline-list'));
    expect(card).toBeDefined();
    expect(card!.content).toContain('what to expect');
    // The list body is rendered to HTML via simpleMarkdownToHtml.
    expect(card!.content).toContain('<li>Learn alerting</li>');
    expect(card!.content).toContain('<li>Build a dashboard</li>');
  });

  it('preserves content before the heading as its own markdown block', () => {
    const input = guide([{ type: 'markdown', content: "Intro paragraph.\n\n## Here's what to expect\n\n- A thing" }]);

    const blocks = parseBlocks(injectJourneyExtrasIntoJsonGuide(input, coverMetadata));

    expect(blocks[0]).toEqual({ type: 'markdown', content: 'Intro paragraph.' });
    expect(blocks[1]!.type).toBe('html');
    expect(blocks[1]!.content).toContain('orange-outline-list');
  });

  it('preserves content after the next heading as a trailing markdown block', () => {
    const input = guide([
      { type: 'markdown', content: "## Here's what to expect\n\n- A thing\n\n## Next section\n\nMore prose." },
    ]);

    const blocks = parseBlocks(injectJourneyExtrasIntoJsonGuide(input, coverMetadata));

    const card = blocks.find((b) => b.type === 'html' && b.content?.includes('orange-outline-list'))!;
    expect(card.content).toContain('<li>A thing</li>');
    expect(card.content).not.toContain('Next section');

    const remainder = blocks.find((b) => b.type === 'markdown' && b.content?.includes('Next section'));
    expect(remainder).toBeDefined();
    expect(remainder!.content).toContain('More prose.');
  });

  it('pulls the card body from the following block when the heading block has no body', () => {
    const input = guide([
      { type: 'markdown', content: "## Here's what to expect" },
      { type: 'markdown', content: '- Pulled from next block' },
      { type: 'markdown', content: 'Unrelated trailing block' },
    ]);

    const blocks = parseBlocks(injectJourneyExtrasIntoJsonGuide(input, coverMetadata));

    const card = blocks.find((b) => b.type === 'html' && b.content?.includes('orange-outline-list'))!;
    expect(card.content).toContain('<li>Pulled from next block</li>');
    // The consumed block is spliced out; the unrelated block survives.
    expect(blocks.some((b) => b.content === '- Pulled from next block')).toBe(false);
    expect(blocks.some((b) => b.content === 'Unrelated trailing block')).toBe(true);
  });

  it('only wraps the first "what to expect" heading', () => {
    const input = guide([
      { type: 'markdown', content: "## Here's what to expect\n\n- First" },
      { type: 'markdown', content: '## What to expect\n\n- Second' },
    ]);

    const blocks = parseBlocks(injectJourneyExtrasIntoJsonGuide(input, coverMetadata));

    const cards = blocks.filter((b) => b.type === 'html' && b.content?.includes('orange-outline-list'));
    expect(cards).toHaveLength(1);
    expect(cards[0]!.content).toContain('<li>First</li>');
    // The second heading is left untouched as markdown.
    expect(blocks.some((b) => b.type === 'markdown' && b.content?.includes('Second'))).toBe(true);
  });

  it('appends the journey extras (Ready to Begin) as a trailing html block on cover pages', () => {
    const input = guide([{ type: 'markdown', content: 'Just some prose, no expect heading.' }]);

    const blocks = parseBlocks(injectJourneyExtrasIntoJsonGuide(input, coverMetadata));

    const last = blocks[blocks.length - 1]!;
    expect(last.type).toBe('html');
    expect(last.content).toContain('journey-ready-to-begin');
    expect(last.content).toContain('Ready to Begin');
    // No expect heading present → the original markdown block is preserved verbatim.
    expect(blocks[0]).toEqual({ type: 'markdown', content: 'Just some prose, no expect heading.' });
  });

  it('omits the Ready to Begin block entirely when skipReadyToBegin is true', () => {
    const input = guide([{ type: 'markdown', content: 'Just some prose, no expect heading.' }]);

    const result = injectJourneyExtrasIntoJsonGuide(input, coverMetadata, true);

    expect(result).not.toContain('journey-ready-to-begin');
    expect(result).not.toContain('Ready to Begin');
  });

  it('returns the original string unchanged when JSON is invalid', () => {
    const notJson = 'this is not json {';
    expect(injectJourneyExtrasIntoJsonGuide(notJson, coverMetadata)).toBe(notJson);
  });

  it('returns the original string unchanged when there is no blocks array', () => {
    const noBlocks = JSON.stringify({ id: 'demo', title: 'Demo' });
    expect(injectJourneyExtrasIntoJsonGuide(noBlocks, coverMetadata)).toBe(noBlocks);
  });

  it('matches the apostrophe variants of the expect heading (straight and typographic)', () => {
    for (const heading of ["## Here's what to expect", '## Here’s what to expect', '## What to expect']) {
      const input = guide([{ type: 'markdown', content: `${heading}\n\n- Body` }]);
      const blocks = parseBlocks(injectJourneyExtrasIntoJsonGuide(input, coverMetadata));
      expect(blocks.some((b) => b.type === 'html' && b.content?.includes('orange-outline-list'))).toBe(true);
    }
  });
});

// The React cover-page hero (LearningPathTableOfContents) already renders
// this path's own title and description — a guide authored the older,
// hero-less way opens with the same title+intro as its own leading block,
// which reads as a plain duplicate once the hero exists (captain-reported).
describe("injectJourneyExtrasIntoJsonGuide — drops the guide's own duplicate leading title block", () => {
  it('drops a leading markdown block that starts with a heading', () => {
    const input = guide([
      { type: 'markdown', content: '# Demo tracked learning path\n\nA local demo path exercising Path Tracks.' },
      { type: 'markdown', content: 'Real, unique milestone-list prose.' },
    ]);

    const blocks = parseBlocks(injectJourneyExtrasIntoJsonGuide(input, coverMetadata, true));

    expect(blocks[0]).toEqual({ type: 'markdown', content: 'Real, unique milestone-list prose.' });
    expect(blocks.some((b) => b.content?.includes('Demo tracked learning path'))).toBe(false);
  });

  it('leaves a leading block alone when it has no heading of its own (unique prose, not a duplicated title)', () => {
    const input = guide([{ type: 'markdown', content: "Intro paragraph.\n\n## Here's what to expect\n\n- A thing" }]);

    const blocks = parseBlocks(injectJourneyExtrasIntoJsonGuide(input, coverMetadata, true));

    expect(blocks[0]).toEqual({ type: 'markdown', content: 'Intro paragraph.' });
  });

  // The common minimal case (this task's own demo guide): the whole guide
  // body was just the duplicated title+intro, nothing else. Rendering empty
  // below the hero is correct — the hero already said everything it did.
  // A truly empty `blocks: []` fails at render time (ContentProcessor treats
  // zero parsed elements as a parsing error), so this must stay non-empty.
  it('replaces the guide body with an empty, real element when the leading heading block was its only content', () => {
    const input = guide([{ type: 'markdown', content: '# Demo tracked learning path\n\nJust the title.' }]);

    const blocks = parseBlocks(injectJourneyExtrasIntoJsonGuide(input, coverMetadata, true));

    expect(blocks).toEqual([{ type: 'html', content: '<div></div>' }]);
  });

  // Regression: block-editor-tutorial/content.json's own leading block opens
  // with a heading (duplicate-looking title+intro) but goes on to cover real
  // sections ("What are guides?", "Block types overview") inside that SAME
  // block. Dropping the whole block would silently delete that real content —
  // only the title+intro portion, up to the first real section heading, may
  // go.
  it("keeps a leading heading block's own real sections, dropping only its title+intro", () => {
    const input = guide([
      {
        type: 'markdown',
        content:
          '# Welcome to the guide editor! 🎉\n\n' +
          'This template demonstrates all the **block types** you can use to create interactive guides.\n\n' +
          '## What are guides?\n\n' +
          'Guides are interactive tutorials that help users learn Grafana.\n\n' +
          '## Block types overview\n\n' +
          'Click any block in the editor to see its structure.',
      },
    ]);

    const blocks = parseBlocks(injectJourneyExtrasIntoJsonGuide(input, coverMetadata, true));

    expect(blocks[0]!.content).not.toContain('Welcome to the guide editor');
    expect(blocks[0]!.content).not.toContain('This template demonstrates');
    expect(blocks[0]!.content).toContain('## What are guides?');
    expect(blocks[0]!.content).toContain('Guides are interactive tutorials');
    expect(blocks[0]!.content).toContain('## Block types overview');
    expect(blocks[0]!.content).toContain('Click any block in the editor');
  });

  // Regression: the leading-heading detector matches H1-H6, but the
  // "next heading" boundary it stopped at previously only matched H1-H3
  // (borrowed from the unrelated "what to expect" card logic). An H4+
  // leading title followed by an H4+ real section found no boundary and
  // dropped the whole block, including the real section.
  it('keeps a real H4 section after an H4 leading title+intro', () => {
    const input = guide([
      {
        type: 'markdown',
        content:
          '#### My Guide Title\n\n' + 'Some intro.\n\n' + '#### Real deep section\n\n' + 'Content that matters.',
      },
    ]);

    const blocks = parseBlocks(injectJourneyExtrasIntoJsonGuide(input, coverMetadata, true));

    expect(blocks[0]!.content).not.toContain('My Guide Title');
    expect(blocks[0]!.content).not.toContain('Some intro');
    expect(blocks[0]!.content).toContain('#### Real deep section');
    expect(blocks[0]!.content).toContain('Content that matters');
  });
});

// simpleMarkdownToHtml has broad coverage in content-fetcher.test.ts; these
// assert the behaviors the cover-page card relies on (link sanitization).
describe('simpleMarkdownToHtml — link safety used by cover cards', () => {
  it('drops javascript: hrefs but keeps the label', () => {
    expect(simpleMarkdownToHtml('[click](javascript:alert)')).toBe('<p>click</p>');
  });

  it('keeps safe https links', () => {
    expect(simpleMarkdownToHtml('[Grafana](https://grafana.com)')).toBe(
      '<p><a href="https://grafana.com">Grafana</a></p>'
    );
  });
});
