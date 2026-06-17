import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { GuideReaderOverlay } from './GuideReaderOverlay';
import { testIds } from '../../constants/testIds';
import { fetchUnifiedContent } from '../../docs-retrieval';

jest.mock('../../docs-retrieval', () => ({
  fetchUnifiedContent: jest.fn(),
}));

// Feature provider needs no real OpenFeature client for this test.
jest.mock('../OpenFeatureProvider', () => ({
  PathfinderFeatureProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Stand in for the real renderer so the test asserts the overlay's own
// responsibilities (fetch → render, close, error) rather than ContentRenderer
// internals (covered by its own suite).
jest.mock('../content-renderer/content-renderer', () => ({
  ContentRenderer: () => <div data-testid="mock-content">content</div>,
}));

const mockFetchContent = fetchUnifiedContent as jest.MockedFunction<typeof fetchUnifiedContent>;

describe('GuideReaderOverlay', () => {
  let closeSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    closeSpy = jest.spyOn(window, 'close').mockImplementation(() => {});
  });

  afterEach(() => {
    closeSpy.mockRestore();
  });

  it('fetches the guide and renders it inside the overlay portal', async () => {
    mockFetchContent.mockResolvedValue({ content: { url: 'backend-guide:x', type: 'interactive' } } as any);

    render(<GuideReaderOverlay doc="backend-guide:x" />);

    expect(mockFetchContent).toHaveBeenCalledWith('backend-guide:x');
    expect(screen.getByTestId(testIds.guideReader.overlay)).toBeInTheDocument();
    expect(await screen.findByTestId('mock-content')).toBeInTheDocument();
  });

  it('closes the tab when the close button is clicked', async () => {
    mockFetchContent.mockResolvedValue({ content: { url: 'backend-guide:x', type: 'interactive' } } as any);

    render(<GuideReaderOverlay doc="backend-guide:x" />);

    fireEvent.click(screen.getByTestId(testIds.guideReader.closeButton));
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('surfaces an error when the guide cannot be loaded', async () => {
    mockFetchContent.mockResolvedValue({ content: null, error: 'boom', errorType: 'other' } as any);

    render(<GuideReaderOverlay doc="backend-guide:x" />);

    expect(await screen.findByTestId(testIds.guideReader.error)).toHaveTextContent('boom');
  });
});
