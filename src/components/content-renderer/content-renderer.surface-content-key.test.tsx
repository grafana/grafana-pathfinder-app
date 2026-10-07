import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RawContent } from '../../types/content.types';
import { testIds } from '../../constants/testIds';
import { dispatchProgress } from '../../global-state/progress-events';
import { resetContentKeyForTests, getContentKey } from '../../global-state/content-key';
import { guideCompletionMarkStorage } from '../../lib/user-storage';
import { usePublishSurfaceContentKey } from '../../hooks';
import { ContentRenderer } from './content-renderer';

jest.mock('@grafana/i18n', () => ({ t: (_k: string, f: string) => f }));

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
function Surface({
  contentKey,
  content,
  onGuideComplete,
}: {
  contentKey: string;
  content: RawContent;
  onGuideComplete: jest.Mock;
}) {
  usePublishSurfaceContentKey(contentKey);
  return <ContentRenderer content={content} onGuideComplete={onGuideComplete} />;
}

beforeEach(() => {
  localStorage.clear();
  resetContentKeyForTests();
  delete window.__DocsPluginActiveTabUrl;
  delete window.__DocsPluginContentKey;
});

describe('surface content key ownership', () => {
  it('records guide B under B, not under the stale sidebar key A', async () => {
    window.__DocsPluginActiveTabUrl = A;
    const onGuideComplete = jest.fn();
    render(<Surface contentKey={B} content={makeContent(B)} onGuideComplete={onGuideComplete} />);
    const button = await screen.findByTestId(testIds.markComplete.button);
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(onGuideComplete).toHaveBeenCalled());

    expect(getContentKey()).toBe(B);
    expect(onGuideComplete.mock.calls[0][1]).toBe(B);
    expect(await guideCompletionMarkStorage.get(B)).toBe(true);
    expect(await guideCompletionMarkStorage.get(A)).not.toBe(true);
  });

  it('completes on a 100% guide event when no sidebar tab global is set', async () => {
    const onGuideComplete = jest.fn();
    render(<Surface contentKey={B} content={makeContent(B)} onGuideComplete={onGuideComplete} />);
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

    expect(onGuideComplete).toHaveBeenCalledTimes(1);
  });

  it('completes on a 100% event for B while the global still names A', async () => {
    window.__DocsPluginActiveTabUrl = A;
    const onGuideComplete = jest.fn();
    render(<Surface contentKey={B} content={makeContent(B)} onGuideComplete={onGuideComplete} />);
    await settle(1500);
    act(() => {
      dispatchProgress({ kind: 'guide', contentKey: B, percentage: 100, hasProgress: true, origin: 'change' });
    });
    await settle(300);

    expect(onGuideComplete).toHaveBeenCalledTimes(1);
    expect(onGuideComplete.mock.calls[0][1]).toBe(B);
  });

  it('ignores a 100% event for a different guide', async () => {
    const onGuideComplete = jest.fn();
    render(<Surface contentKey={B} content={makeContent(B)} onGuideComplete={onGuideComplete} />);
    await settle(1500);
    act(() => {
      dispatchProgress({ kind: 'guide', contentKey: A, percentage: 100, hasProgress: true, origin: 'change' });
    });
    await settle(300);

    expect(onGuideComplete).not.toHaveBeenCalled();
  });

  it('clears the published key on unmount', () => {
    const { unmount } = render(<Surface contentKey={B} content={makeContent(B)} onGuideComplete={jest.fn()} />);
    expect(window.__DocsPluginActiveTabUrl).toBe(B);
    unmount();
    expect(window.__DocsPluginActiveTabUrl).toBe('');
  });
});
