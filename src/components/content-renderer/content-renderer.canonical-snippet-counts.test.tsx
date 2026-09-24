/**
 * One source guide, two opening paths, one denominator (#1665).
 *
 * A direct open hands the renderer the pre-inlining tree; a prepared launch
 * hands it the snippet-EXPANDED tree. The counting rule gives a `snippet-ref`
 * one position however many blocks it resolves to, so counting whichever tree
 * arrived gave the same guide two different totals — and the frozen index kept
 * whichever one the reader's first opening path produced.
 *
 * These cross the real seam: the real `prepareGuideLaunch`, the real inliner,
 * the real counter, the real frozen-index store. Only the network fetch and the
 * snippet CDN are mocked, because those are boundaries rather than behaviour
 * under test.
 */
import React, { useLayoutEffect } from 'react';
import { act, cleanup, render } from '@testing-library/react';

import { evictAllGuideIndexes, getGuideIndex } from '../../global-state/active-guide-index';
import { resetContentKeyForTests } from '../../global-state/content-key';
import { resolveCountedBlockStepId } from '../../global-state/guide-step-id-resolver';
import { injectJourneyExtrasIntoJsonGuide } from '../../docs-retrieval/content-fetcher/cover-page';
import { rewriteGuideTrees } from '../../lib/guide-counting-source';
import { computeGuideBlockIndex, guideProgress } from '../../lib/guide-stats';
import { logger } from '../../lib/logging';
import { getSnippetResolver } from '../../snippet-engine/caching-snippet-resolver';
import type { SnippetResolver } from '../../snippet-engine/types';
import type { LearningJourneyMetadata, Milestone, PreparedRawContent, RawContent } from '../../types/content.types';
import type { JsonBlock, JsonGuide } from '../../types/json-guide.types';
import { loadDocsTabContentResult } from '../docs-panel/utils/docs-tab-loader';
import { prepareGuideLaunch } from '../docs-panel/utils/prepare-guide-launch';
import { ContentRenderer } from './content-renderer';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

jest.mock('../docs-panel/utils/docs-tab-loader', () => ({
  loadDocsTabContentResult: jest.fn(),
}));

jest.mock('../../snippet-engine/caching-snippet-resolver', () => ({
  getSnippetResolver: jest.fn(),
}));

const mockGetSnippetResolver = getSnippetResolver as unknown as jest.Mock;

const SNIPPET_ID = 'two-block-snippet';
const GUIDE_URL = 'https://grafana.com/docs/learning-journeys/snippets/step-1/';

/** Two blocks behind one reference — the arithmetic the two paths disagreed on. */
const SNIPPET_BLOCKS: JsonBlock[] = [
  { type: 'markdown', content: 'Snippet block one' },
  { type: 'markdown', content: 'Snippet block two' },
];

/** A snippet whose own body holds a reference — the inliner is single-pass. */
const NESTED_REF_SNIPPET_BLOCKS: JsonBlock[] = [
  { type: 'snippet-ref', snippetId: 'inner-snippet' },
  { type: 'markdown', content: 'Beside the nested reference' },
];

const milestone = (number: number): Milestone => ({
  number,
  title: `Milestone ${number}`,
  url: `https://grafana.com/docs/learning-journeys/snippets/step-${number}/`,
  isActive: false,
});

/**
 * A real milestone (not the cover, milestone 0 — the cover's own bottom-nav
 * extras block is deliberately suppressed now, since it duplicated the React
 * cover-page hero's Resume/Start CTA and the sticky toolbar's own Next/Previous),
 * so the journey rewrite still appends its trailing bottom-nav extras block.
 */
const journeyMetadata: LearningJourneyMetadata = {
  currentMilestone: 1,
  totalMilestones: 2,
  milestones: [milestone(1), milestone(2)],
  baseUrl: 'https://grafana.com/docs/learning-journeys/snippets/',
};

function resolvesTo(blocks: JsonBlock[]): SnippetResolver {
  return {
    resolve: jest.fn(async (id: string) => ({
      ok: true as const,
      id,
      source: 'online-cdn' as const,
      snippet: { id, title: id, description: 'test snippet', blocks },
    })),
  };
}

const failingResolver: SnippetResolver = {
  resolve: jest.fn(async (id: string) => ({
    ok: false as const,
    id,
    error: { code: 'not-found' as const, message: 'no catalog in tests' },
  })),
};

/** Resolves the outer id to a body holding a further reference; the inner id to plain blocks. */
const nestedRefResolver: SnippetResolver = {
  resolve: jest.fn(async (id: string) => ({
    ok: true as const,
    id,
    source: 'online-cdn' as const,
    snippet: {
      id,
      title: id,
      description: 'test snippet',
      blocks: id === SNIPPET_ID ? NESTED_REF_SNIPPET_BLOCKS : SNIPPET_BLOCKS,
    },
  })),
};

/** What `docs-panel.tsx` does to a journey payload before it renders. */
function withJourneyExtras(content: RawContent): RawContent {
  return rewriteGuideTrees(content, (guideJson) => injectJourneyExtrasIntoJsonGuide(guideJson, journeyMetadata, true));
}

/** One reference expanding into two blocks, beside one ordinary sibling. */
function refPlusSibling(): JsonGuide {
  return {
    id: 'snippet-guide',
    title: 'Snippet guide',
    blocks: [
      { type: 'snippet-ref', snippetId: SNIPPET_ID },
      { type: 'markdown', id: 'after-ref', content: 'Ordinary sibling' },
    ],
  };
}

function rawContent(guide: JsonGuide, url = GUIDE_URL): RawContent {
  return {
    content: JSON.stringify(guide),
    metadata: { title: guide.title },
    type: 'interactive',
    url,
    lastFetched: '2026-09-15T00:00:00.000Z',
  };
}

/** Stands in for `docs-panel.tsx`, which publishes the active tab URL from a layout effect. */
function PanelLike({ content }: { content: RawContent }) {
  useLayoutEffect(() => {
    window.__DocsPluginActiveTabUrl = content.url;
  }, [content.url]);

  return <ContentRenderer key={content.url} content={content} />;
}

/** Renders and lets the post-mount snippet overlay land. */
async function renderGuide(content: RawContent) {
  const result = render(<PanelLike content={content} />);
  await act(async () => {
    await Promise.resolve();
  });
  return result;
}

/** The reader closes the guide, then the index store starts the next opening path clean. */
function closeAndReset() {
  cleanup();
  act(() => evictAllGuideIndexes());
}

/** The launch path: fetch once, expand, hand the result to the renderer. */
async function prepared(guide: JsonGuide, url = GUIDE_URL): Promise<PreparedRawContent> {
  (loadDocsTabContentResult as jest.Mock).mockResolvedValue({ content: rawContent(guide, url) });
  const result = await prepareGuideLaunch(url, { title: guide.title, source: 'home_page' });
  if (!result.ok) {
    throw new Error(`prepareGuideLaunch failed: ${result.error}`);
  }
  return result.launch.preparedContent;
}

function canonicalIndexOf(guide: JsonGuide) {
  return computeGuideBlockIndex(guide.blocks, { resolveStepId: resolveCountedBlockStepId });
}

function totalAt(url = GUIDE_URL): number | undefined {
  return getGuideIndex(url)?.index.totalBlockCount;
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  resetContentKeyForTests();
  evictAllGuideIndexes();
  delete window.__DocsPluginActiveTabUrl;
  delete window.__DocsPluginContentKey;
  mockGetSnippetResolver.mockReturnValue(resolvesTo(SNIPPET_BLOCKS));
});

afterEach(() => {
  localStorage.clear();
  delete window.__DocsPluginActiveTabUrl;
  delete window.__DocsPluginContentKey;
});

describe('canonical snippet counts across direct and prepared launches', () => {
  it('counts one reference as one block on both paths, though the expanded tree holds three', async () => {
    const guide = refPlusSibling();

    await renderGuide(rawContent(guide));
    const directTotal = totalAt();

    closeAndReset();
    const preparedContent = await prepared(guide);
    await renderGuide(preparedContent);
    const preparedTotal = totalAt();

    expect(JSON.parse(preparedContent.content).blocks).toHaveLength(3);
    expect(directTotal).toBe(2);
    expect(preparedTotal).toBe(2);
  });

  it('publishes the whole index the source guide computes, not a corrected denominator', async () => {
    const guide = refPlusSibling();
    const canonical = canonicalIndexOf(guide);

    await renderGuide(rawContent(guide));
    const direct = getGuideIndex(GUIDE_URL)?.index;

    closeAndReset();
    await renderGuide(await prepared(guide));
    const fromLaunch = getGuideIndex(GUIDE_URL)?.index;

    expect(direct).toEqual(canonical);
    expect(fromLaunch).toEqual(canonical);
  });

  it('reports the indexed tree truthfully on both paths', async () => {
    const guide = refPlusSibling();

    await renderGuide(rawContent(guide));
    expect(getGuideIndex(GUIDE_URL)?.denominatorSource).toBe('live-pre-inlining');

    closeAndReset();
    await renderGuide(await prepared(guide));
    expect(getGuideIndex(GUIDE_URL)?.denominatorSource).toBe('live-pre-inlining');
  });

  it('resolves the same position and percentage from the same evidence', async () => {
    const guide = refPlusSibling();
    const evidence = [{ kind: 'do-it' as const, blockId: 'after-ref' }];

    await renderGuide(rawContent(guide));
    const direct = guideProgress(getGuideIndex(GUIDE_URL)!.index, evidence);

    closeAndReset();
    await renderGuide(await prepared(guide));
    const fromLaunch = guideProgress(getGuideIndex(GUIDE_URL)!.index, evidence);

    expect(direct).toEqual({ position: 2, totalBlockCount: 2, fraction: 1, percent: 100, complete: true });
    expect(fromLaunch).toEqual(direct);
  });

  // The splice moves a later anonymous sibling's runtime step id, so the
  // counter registers no position for it rather than one the runtime will
  // never dispatch. Preserved here: an honest miss, never credit for a
  // different block.
  it('still withholds a position from an anonymous step a splice shifted', async () => {
    const guide: JsonGuide = {
      id: 'shifted',
      title: 'Shifted',
      blocks: [
        { type: 'snippet-ref', snippetId: SNIPPET_ID },
        { type: 'interactive', action: 'button', reftarget: 'button[data-testid="save"]', content: 'Do it' },
      ],
    };

    await renderGuide(rawContent(guide));
    const direct = getGuideIndex(GUIDE_URL)!.index;

    closeAndReset();
    await renderGuide(await prepared(guide));
    const fromLaunch = getGuideIndex(GUIDE_URL)!.index;

    expect(direct.totalBlockCount).toBe(2);
    expect(direct.positionsByStepId.size).toBe(0);
    expect(fromLaunch.positionsByStepId.size).toBe(0);
  });

  it('agrees on repeated references to the same snippet', async () => {
    const guide: JsonGuide = {
      id: 'repeated',
      title: 'Repeated',
      blocks: [
        { type: 'snippet-ref', snippetId: SNIPPET_ID },
        { type: 'snippet-ref', snippetId: SNIPPET_ID },
        { type: 'markdown', content: 'Ordinary sibling' },
      ],
    };

    await renderGuide(rawContent(guide));
    expect(totalAt()).toBe(3);

    closeAndReset();
    const preparedContent = await prepared(guide);
    await renderGuide(preparedContent);

    expect(JSON.parse(preparedContent.content).blocks).toHaveLength(5);
    expect(totalAt()).toBe(3);
  });

  it('agrees on a reference nested in a transparent container', async () => {
    const guide: JsonGuide = {
      id: 'nested',
      title: 'Nested',
      blocks: [
        {
          type: 'section',
          id: 'setup',
          title: 'Setup',
          blocks: [
            { type: 'snippet-ref', snippetId: SNIPPET_ID },
            { type: 'markdown', content: 'Inside the section' },
          ],
        },
      ],
    };
    const canonical = canonicalIndexOf(guide);

    await renderGuide(rawContent(guide));
    expect(getGuideIndex(GUIDE_URL)?.index).toEqual(canonical);

    closeAndReset();
    await renderGuide(await prepared(guide));

    expect(totalAt()).toBe(2);
    expect(getGuideIndex(GUIDE_URL)?.index).toEqual(canonical);
  });

  it('agrees on a reference inside a conditional, which stays opaque', async () => {
    const guide: JsonGuide = {
      id: 'conditional',
      title: 'Conditional',
      blocks: [
        {
          type: 'conditional',
          conditions: ['is-admin'],
          whenTrue: [{ type: 'snippet-ref', snippetId: SNIPPET_ID }],
          whenFalse: [{ type: 'markdown', content: 'Not for you' }],
        },
        { type: 'markdown', content: 'Ordinary sibling' },
      ],
    };

    await renderGuide(rawContent(guide));
    expect(totalAt()).toBe(2);

    closeAndReset();
    await renderGuide(await prepared(guide));

    expect(totalAt()).toBe(2);
  });

  it('agrees when the snippet could not be resolved', async () => {
    mockGetSnippetResolver.mockReturnValue(failingResolver);
    const guide = refPlusSibling();

    await renderGuide(rawContent(guide));
    expect(totalAt()).toBe(2);

    closeAndReset();
    (loadDocsTabContentResult as jest.Mock).mockResolvedValue({ content: rawContent(guide) });
    const result = await prepareGuideLaunch(GUIDE_URL, { title: guide.title, source: 'home_page' });
    if (!result.ok) {
      throw new Error(result.error);
    }
    await renderGuide(result.launch.preparedContent);

    // Fail-safe classification is unchanged by the counting fix.
    expect(result.launch.requiresGrafanaUi).toBe(true);
    expect(totalAt()).toBe(2);
  });

  // The first publication for a content key wins for the life of that key, so
  // an order that let the expanded tree in first would have frozen 3. Each path
  // gets a fresh store: without the reset the second assertion would only
  // re-prove `publishGuideIndex` idempotency and would hold even if the direct
  // path counted 3.
  it('cannot establish a different total by opening the launch path first', async () => {
    const guide = refPlusSibling();

    await renderGuide(await prepared(guide));
    expect(totalAt()).toBe(2);

    closeAndReset();
    await renderGuide(rawContent(guide));
    expect(totalAt()).toBe(2);
  });

  it('leaves the frozen index untouched when the asynchronous snippet overlay lands', async () => {
    const guide = refPlusSibling();

    render(<PanelLike content={rawContent(guide)} />);
    const beforeOverlay = getGuideIndex(GUIDE_URL);
    expect(beforeOverlay?.index.totalBlockCount).toBe(2);

    await act(async () => {
      await Promise.resolve();
    });

    expect(getGuideIndex(GUIDE_URL)).toBe(beforeOverlay);
    expect(totalAt()).toBe(2);
  });

  // A payload that says it is expanded but did not keep the tree it was
  // expanded from has nothing canonical to count. Rendering must survive;
  // a purported canonical index must not be published from the expanded tree.
  it('declines to publish an index for an expanded payload that lost its counting source', async () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const expanded: JsonGuide = {
      id: 'snippet-guide',
      title: 'Snippet guide',
      blocks: [...SNIPPET_BLOCKS, { type: 'markdown', id: 'after-ref', content: 'Ordinary sibling' }],
    };

    const { container } = await renderGuide({
      ...rawContent(expanded),
      countingSource: { kind: 'unavailable' },
    });

    expect(getGuideIndex(GUIDE_URL)).toBeUndefined();
    expect(container.textContent).toContain('Ordinary sibling');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no usable pre-inlining tree'), expect.anything());
  });

  // `docs-panel.tsx` injects a journey milestone's extras AFTER the launch
  // handoff, and that injection appends a counted block. A loader that
  // rewrote only the render tree would leave the prepared path counting a
  // pre-injection denominator and reopen the cross-path split — exactly what
  // `rewriteGuideTrees` exists to prevent, here through the real journey
  // rewrite rather than a synthetic one.
  it('agrees after a structural loader rewrite lands on both trees', async () => {
    const guide = refPlusSibling();

    await renderGuide(withJourneyExtras(rawContent(guide)));
    const directTotal = totalAt();

    closeAndReset();
    const preparedContent = await prepared(guide);
    await renderGuide(withJourneyExtras(preparedContent));

    // Two counted positions plus the appended extras block.
    expect(directTotal).toBe(3);
    expect(totalAt()).toBe(3);
  });

  // `spliceBlocks` pushes a resolved snippet's blocks in without re-splicing
  // them, so a reference inside a snippet body survives into the render tree.
  // It is still one position in the counting tree, and the renderer's own
  // overlay resolves the survivor without touching the frozen index.
  it('agrees on a reference nested inside a snippet body, which expands once', async () => {
    mockGetSnippetResolver.mockReturnValue(nestedRefResolver);
    const guide = refPlusSibling();

    await renderGuide(rawContent(guide));
    expect(totalAt()).toBe(2);

    closeAndReset();
    const preparedContent = await prepared(guide);
    await renderGuide(preparedContent);

    const renderBlocks = JSON.parse(preparedContent.content).blocks as JsonBlock[];
    expect(renderBlocks).toHaveLength(3);
    expect(renderBlocks.some((block) => block.type === 'snippet-ref')).toBe(true);
    expect(totalAt()).toBe(2);
  });
});
