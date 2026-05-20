import { renderHook } from '@testing-library/react';
import * as React from 'react';
import { useLastMilestoneAutoComplete } from './useLastMilestoneAutoComplete';

jest.mock('../../../docs-retrieval', () => ({
  isLastMilestone: jest.fn(),
  getMilestoneSlug: jest.fn(),
  markMilestoneDone: jest.fn(),
}));

import { isLastMilestone, getMilestoneSlug, markMilestoneDone } from '../../../docs-retrieval';

const isLastMilestoneMock = isLastMilestone as jest.Mock;
const getMilestoneSlugMock = getMilestoneSlug as jest.Mock;
const markMilestoneDoneMock = markMilestoneDone as jest.Mock;

function makeContainerRef(html: string): React.RefObject<HTMLDivElement | null> {
  const div = document.createElement('div');
  div.innerHTML = html;
  return { current: div };
}

function makeContent(overrides: Record<string, unknown> = {}): any {
  return {
    type: 'learning-journey',
    url: 'https://example.com/journey/final',
    metadata: { learningJourney: { totalMilestones: 5 } },
    ...overrides,
  };
}

function makeTab(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'tab-1',
    title: 'Journey',
    baseUrl: 'https://example.com/journey/',
    currentUrl: 'https://example.com/journey/final',
    content: null,
    isLoading: false,
    error: null,
    type: 'learning-journey',
    ...overrides,
  };
}

describe('useLastMilestoneAutoComplete', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    isLastMilestoneMock.mockReset();
    getMilestoneSlugMock.mockReset();
    markMilestoneDoneMock.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does nothing when stableContent is null', () => {
    renderHook(() =>
      useLastMilestoneAutoComplete({
        stableContent: null,
        activeTab: makeTab(),
        contentRef: makeContainerRef(''),
      })
    );
    jest.runAllTimers();
    expect(isLastMilestoneMock).not.toHaveBeenCalled();
    expect(markMilestoneDoneMock).not.toHaveBeenCalled();
  });

  it('does nothing when content type is not learning-journey', () => {
    renderHook(() =>
      useLastMilestoneAutoComplete({
        stableContent: makeContent({ type: 'docs' }),
        activeTab: makeTab(),
        contentRef: makeContainerRef(''),
      })
    );
    jest.runAllTimers();
    expect(isLastMilestoneMock).not.toHaveBeenCalled();
  });

  it('does nothing when not on last milestone', () => {
    isLastMilestoneMock.mockReturnValue(false);
    renderHook(() =>
      useLastMilestoneAutoComplete({
        stableContent: makeContent(),
        activeTab: makeTab(),
        contentRef: makeContainerRef(''),
      })
    );
    jest.runAllTimers();
    expect(markMilestoneDoneMock).not.toHaveBeenCalled();
  });

  it('does NOT mark done if interactive steps are present in the DOM', () => {
    isLastMilestoneMock.mockReturnValue(true);
    getMilestoneSlugMock.mockReturnValue('final-slug');
    renderHook(() =>
      useLastMilestoneAutoComplete({
        stableContent: makeContent(),
        activeTab: makeTab(),
        contentRef: makeContainerRef('<div data-step-id="step-1"></div>'),
      })
    );
    jest.runAllTimers();
    expect(markMilestoneDoneMock).not.toHaveBeenCalled();
  });

  it('marks milestone done when last milestone has no interactive steps', () => {
    isLastMilestoneMock.mockReturnValue(true);
    getMilestoneSlugMock.mockReturnValue('final-slug');
    renderHook(() =>
      useLastMilestoneAutoComplete({
        stableContent: makeContent(),
        activeTab: makeTab(),
        contentRef: makeContainerRef('<p>no steps here</p>'),
      })
    );
    jest.runAllTimers();
    expect(markMilestoneDoneMock).toHaveBeenCalledWith('https://example.com/journey/', 'final-slug', 5);
  });

  it('clears the timeout on unmount', () => {
    isLastMilestoneMock.mockReturnValue(true);
    getMilestoneSlugMock.mockReturnValue('final-slug');
    const { unmount } = renderHook(() =>
      useLastMilestoneAutoComplete({
        stableContent: makeContent(),
        activeTab: makeTab(),
        contentRef: makeContainerRef('<p>no steps here</p>'),
      })
    );
    unmount();
    jest.runAllTimers();
    expect(markMilestoneDoneMock).not.toHaveBeenCalled();
  });
});
