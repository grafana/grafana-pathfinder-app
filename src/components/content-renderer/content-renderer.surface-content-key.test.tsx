import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RawContent } from '../../types/content.types';
import { testIds } from '../../constants/testIds';
import { dispatchProgress } from '../../global-state/progress-events';
import { resetContentKeyForTests, getContentKey } from '../../global-state/content-key';
import { guideCompletionMarkStorage } from '../../lib/user-storage';
import { usePublishSurfaceContentKey } from '../../hooks';
import { recordGuideCompletionForSurface } from '../../docs-retrieval';
import { trackedCompletion } from '../../test-utils/content-renderer-completion';
import { ContentRenderer } from './content-renderer';

jest.mock('@grafana/i18n', () => ({ t: (_k: string, f: string) => f }));

jest.mock('../../docs-retrieval', () => ({
  ...jest.requireActual('../../docs-retrieval'),
  recordGuideCompletionForSurface: jest.fn(),
}));

const recordCompletion = jest.mocked(recordGuideCompletionForSurface);

const A = 'https://grafana.com/docs/a/';
const B = 'https://grafana.com/docs/b/';
const makeContent = (url: string): RawContent => ({
  content: '<p>words</p>',
  type: 'single-doc',
  url,
  lastFetched: '2026-07-31T00:00:00.000Z',
  metadata: { title: 'x' },
});
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Stands in for a surface (floating, full screen, guide reader) that renders one guide.
function Surface({ contentKey, content }: { contentKey: string; content: RawContent }) {
  usePublishSurfaceContentKey(contentKey);
  return <ContentRenderer content={content} completion={trackedCompletion(content)} />;
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  resetContentKeyForTests();
  delete window.__DocsPluginActiveTabUrl;
  delete window.__DocsPluginContentKey;
});

describe('surface content key ownership', () => {
  it('records guide B under B, not under the stale sidebar key A', async () => {
    window.__DocsPluginActiveTabUrl = A;
    render(<Surface contentKey={B} content={makeContent(B)} />);
    const button = await screen.findByTestId(testIds.markComplete.button);
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(recordCompletion).toHaveBeenCalled());

    expect(getContentKey()).toBe(B);
    expect(recordCompletion.mock.calls[0]?.[0].contentKey).toBe(B);
    expect(await guideCompletionMarkStorage.get(B)).toBe(true);
    expect(await guideCompletionMarkStorage.get(A)).not.toBe(true);
  });

  it('completes on a 100% guide event when no sidebar tab global is set', async () => {
    render(<Surface contentKey={B} content={makeContent(B)} />);
    await settle(1500);
    act(() => {
      dispatchProgress({
        kind: 'guide',
        contentKey: getContentKey(),
        percentage: 100,
        hasProgress: true,
        origin: 'change',
      });
    });
    await settle(300);

    expect(recordCompletion).toHaveBeenCalledTimes(1);
  });

  it('completes on a 100% event for B while the global still names A', async () => {
    window.__DocsPluginActiveTabUrl = A;
    render(<Surface contentKey={B} content={makeContent(B)} />);
    await settle(1500);
    act(() => {
      dispatchProgress({ kind: 'guide', contentKey: B, percentage: 100, hasProgress: true, origin: 'change' });
    });
    await settle(300);

    expect(recordCompletion).toHaveBeenCalledTimes(1);
    expect(recordCompletion.mock.calls[0]?.[0].contentKey).toBe(B);
  });

  it('ignores a 100% event for a different guide', async () => {
    render(<Surface contentKey={B} content={makeContent(B)} />);
    await settle(1500);
    act(() => {
      dispatchProgress({ kind: 'guide', contentKey: A, percentage: 100, hasProgress: true, origin: 'change' });
    });
    await settle(300);

    expect(recordCompletion).not.toHaveBeenCalled();
  });

  it('releases its typed key on unmount so the sidebar global takes over', () => {
    const { unmount } = render(<Surface contentKey={B} content={makeContent(B)} />);
    expect(window.__DocsPluginActiveTabUrl).toBe(B);
    window.__DocsPluginActiveTabUrl = A;
    expect(getContentKey()).toBe(B);
    unmount();
    expect(window.__DocsPluginActiveTabUrl).toBe(A);
    expect(getContentKey()).toBe(A);
  });

  it('keeps a sidebar global holding the same key after unmount', () => {
    const { unmount } = render(<Surface contentKey={B} content={makeContent(B)} />);
    window.__DocsPluginActiveTabUrl = B;
    unmount();
    expect(window.__DocsPluginActiveTabUrl).toBe(B);
    expect(getContentKey()).toBe(B);
  });
});
