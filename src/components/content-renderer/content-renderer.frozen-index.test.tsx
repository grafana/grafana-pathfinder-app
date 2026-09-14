/**
 * The content-load seam publishes the frozen block index (decision 1) under
 * the content key the reader is actually on.
 *
 * The panel that owns the active tab URL publishes it from a LAYOUT effect,
 * which runs after its children have rendered. A seam that resolved the key
 * during render would therefore key milestone 2's index under milestone 1 —
 * and because `publishGuideIndex` is idempotent, milestone 2 would then have
 * no index at all, so no evidence on it could ever move its percentage.
 * The wrapper below reproduces exactly that ordering.
 */
import React, { useLayoutEffect } from 'react';
import { act, render } from '@testing-library/react';

import type { RawContent } from '../../types/content.types';
import { resetContentKeyForTests } from '../../global-state/content-key';
import { evictAllGuideIndexes, getGuideIndex } from '../../global-state/active-guide-index';
import { evictAllContentCaches, evictContentCache } from '../../global-state/completion-store';
import { ContentRenderer } from './content-renderer';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

const baseUrl = 'https://grafana.com/docs/learning-journeys/demo';
const MILESTONE_ONE = `${baseUrl}/milestone-1/`;
const MILESTONE_TWO = `${baseUrl}/milestone-2/`;

function guideJson(id: string, blockCount: number): string {
  return JSON.stringify({
    id,
    title: id,
    blocks: Array.from({ length: blockCount }, (_, i) => ({ type: 'markdown', content: `Block ${i + 1}` })),
  });
}

function makeContent(url: string, blockCount: number): RawContent {
  return {
    content: guideJson(url, blockCount),
    type: 'learning-journey',
    url,
    lastFetched: '2026-07-31T00:00:00.000Z',
    metadata: { title: 'Demo' },
  };
}

/**
 * Stands in for `docs-panel.tsx`: publishes the active tab URL from a layout
 * effect, and remounts the renderer per content key the way the panel's
 * `currentUrl`-keyed content area does.
 */
function PanelLike({ content }: { content: RawContent }) {
  useLayoutEffect(() => {
    window.__DocsPluginActiveTabUrl = content.url;
  }, [content.url]);

  return <ContentRenderer key={content.url} content={content} />;
}

beforeEach(() => {
  localStorage.clear();
  resetContentKeyForTests();
  evictAllGuideIndexes();
  delete window.__DocsPluginActiveTabUrl;
  delete window.__DocsPluginContentKey;
});

afterEach(() => {
  localStorage.clear();
  delete window.__DocsPluginActiveTabUrl;
  delete window.__DocsPluginContentKey;
});

describe('ContentRenderer — the frozen block index', () => {
  it('publishes under the key of the guide it just rendered', () => {
    render(<PanelLike content={makeContent(MILESTONE_ONE, 3)} />);

    expect(getGuideIndex(MILESTONE_ONE)?.index.totalBlockCount).toBe(3);
  });

  // A reset evicts the index, and this seam is its only producer: without a
  // republish the still-mounted guide would report no percentage at all for
  // the rest of the session, however much the reader then completed.
  it('republishes after a per-guide reset evicts the index while the guide stays mounted', () => {
    render(<PanelLike content={makeContent(MILESTONE_ONE, 3)} />);

    act(() => {
      evictContentCache(MILESTONE_ONE);
    });

    expect(getGuideIndex(MILESTONE_ONE)?.index.totalBlockCount).toBe(3);
  });

  it('republishes after "reset all learning progress" evicts every index', () => {
    render(<PanelLike content={makeContent(MILESTONE_ONE, 3)} />);

    act(() => {
      evictAllContentCaches();
    });

    expect(getGuideIndex(MILESTONE_ONE)?.index.totalBlockCount).toBe(3);
  });

  it('publishes for a milestone reached by in-tab navigation, not under the previous one', () => {
    const { rerender } = render(<PanelLike content={makeContent(MILESTONE_ONE, 3)} />);
    rerender(<PanelLike content={makeContent(MILESTONE_TWO, 5)} />);

    expect(getGuideIndex(MILESTONE_TWO)?.index.totalBlockCount).toBe(5);
    expect(getGuideIndex(MILESTONE_ONE)?.index.totalBlockCount).toBe(3);
  });

  describe('block-editor preview', () => {
    const previewUrl = 'block-editor://preview/my-guide';

    // A real guide's content key really is immutable, which is what the
    // freeze (and publishGuideIndex's idempotency) correctly depends on. The
    // preview breaks that premise: its key is constant for the whole editing
    // session while the content underneath changes on every edit. Without a
    // republish here, the index would stay frozen at whatever it was on the
    // first edit, and the previewed percentage would never track further
    // edits — pf-cutover-preview-index-stale-on-edit.
    it('republishes when the previewed content changes, without remounting', () => {
      const { rerender } = render(<ContentRenderer content={makeContent(previewUrl, 3)} />);
      expect(getGuideIndex(previewUrl)?.index.totalBlockCount).toBe(3);

      rerender(<ContentRenderer content={makeContent(previewUrl, 5)} />);

      expect(getGuideIndex(previewUrl)?.index.totalBlockCount).toBe(5);
    });

    // The narrowing must not spill onto a real guide's content key, where a
    // second publish for the same key genuinely should be a no-op.
    it('still leaves a real guide frozen after its content "changes" under the same key', () => {
      const { rerender } = render(<PanelLike content={makeContent(MILESTONE_ONE, 3)} />);
      expect(getGuideIndex(MILESTONE_ONE)?.index.totalBlockCount).toBe(3);

      rerender(<PanelLike content={makeContent(MILESTONE_ONE, 7)} />);

      expect(getGuideIndex(MILESTONE_ONE)?.index.totalBlockCount).toBe(3);
    });
  });
});
