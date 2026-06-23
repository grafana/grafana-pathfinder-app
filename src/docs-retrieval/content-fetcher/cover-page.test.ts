import { injectJourneyExtrasIntoJsonGuide, simpleMarkdownToHtml } from './cover-page';
import type { LearningJourneyMetadata, Milestone } from '../../types/content.types';

const milestone = (number: number, overrides: Partial<Milestone> = {}): Milestone => ({
  number,
  title: `Milestone ${number}`,
  duration: '5m',
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
