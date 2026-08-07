import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { GuideReaderOverlay } from './GuideReaderOverlay';
import { testIds } from '../../constants/testIds';
import { fetchUnifiedContent } from '../../docs-retrieval';

jest.mock('../../docs-retrieval', () => ({
  fetchUnifiedContent: jest.fn(),
  recordGuideCompletionForSurface: jest.fn(),
}));

// Feature provider needs no real OpenFeature client for this test.
jest.mock('../OpenFeatureProvider', () => ({
  PathfinderFeatureProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Stand in for the real renderer so the test asserts the overlay's own
// responsibilities (fetch → render, close, error) rather than ContentRenderer
// internals (covered by its own suite).
jest.mock('../content-renderer/content-renderer', () => ({
  ContentRenderer: ({ onGuideComplete }: { onGuideComplete?: () => void }) => {
    const { useInteractiveMode } = require('../../global-state/interactive-mode-context');
    return (
      <div data-testid="mock-content">
        mode:{useInteractiveMode()}
        <button onClick={onGuideComplete}>Complete rendered guide</button>
      </div>
    );
  },
}));

const mockFetchContent = fetchUnifiedContent as jest.MockedFunction<typeof fetchUnifiedContent>;
const { recordGuideCompletionForSurface } = jest.requireMock('../../docs-retrieval');

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

  it('provides controller mode to the rendered content', async () => {
    mockFetchContent.mockResolvedValue({ content: { url: 'backend-guide:x', type: 'interactive' } } as any);

    render(<GuideReaderOverlay doc="backend-guide:x" mode="controller" />);

    const content = await screen.findByTestId('mock-content');
    expect(content).toHaveTextContent('mode:controller');
  });

  it('shows the pairing code in controller mode', async () => {
    mockFetchContent.mockResolvedValue({ content: { url: 'backend-guide:x', type: 'interactive' } } as any);

    render(
      <GuideReaderOverlay
        doc="backend-guide:x"
        mode="controller"
        controllerPairing={{ pairingId: 'pairing-1', pairingSecret: 'secret-1', pairingCode: '123456' }}
      />
    );

    expect(await screen.findByTestId(testIds.guideReader.controllerStatus)).toHaveTextContent('Code: 123456');
  });

  it('defaults to interactive mode (not the privileged controller) when none is passed', async () => {
    mockFetchContent.mockResolvedValue({ content: { url: 'backend-guide:x', type: 'interactive' } } as any);

    render(<GuideReaderOverlay doc="backend-guide:x" />);

    const content = await screen.findByTestId('mock-content');
    expect(content).toHaveTextContent('mode:interactive');
  });

  it('closes the tab when the close button is clicked', async () => {
    mockFetchContent.mockResolvedValue({ content: { url: 'backend-guide:x', type: 'interactive' } } as any);

    render(<GuideReaderOverlay doc="backend-guide:x" />);

    fireEvent.click(screen.getByTestId(testIds.guideReader.closeButton));
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('closes the tab when Escape is pressed', async () => {
    mockFetchContent.mockResolvedValue({ content: { url: 'backend-guide:x', type: 'interactive' } } as any);

    render(<GuideReaderOverlay doc="backend-guide:x" />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('shows a close hint when window.close() is a no-op (bookmarked tab)', async () => {
    jest.useFakeTimers();
    try {
      mockFetchContent.mockResolvedValue({ content: { url: 'backend-guide:x', type: 'interactive' } } as any);

      render(<GuideReaderOverlay doc="backend-guide:x" />);

      fireEvent.click(screen.getByTestId(testIds.guideReader.closeButton));
      expect(screen.queryByTestId(testIds.guideReader.closeHint)).not.toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(100);
      });
      expect(screen.getByTestId(testIds.guideReader.closeHint)).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });

  it('routes a completed guide through the shared surface-neutral emitter', async () => {
    mockFetchContent.mockResolvedValue({
      content: {
        url: 'https://example.com/remote-guide/content.json',
        type: 'interactive',
        metadata: { title: 'Remote guide', packageManifest: { id: 'remote-guide', repository: 'app-platform' } },
      },
    } as any);

    render(<GuideReaderOverlay doc="https://example.com/remote-guide/content.json" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Complete rendered guide' }));

    expect(recordGuideCompletionForSurface).toHaveBeenCalledWith(
      expect.objectContaining({
        contentUrl: 'https://example.com/remote-guide/content.json',
        contentType: 'interactive',
        metadata: { title: 'Remote guide', packageManifest: { id: 'remote-guide', repository: 'app-platform' } },
        guideTitle: 'Remote guide',
      })
    );
  });

  it('surfaces an error when the guide cannot be loaded', async () => {
    mockFetchContent.mockResolvedValue({ content: null, error: 'boom', errorType: 'other' } as any);

    render(<GuideReaderOverlay doc="backend-guide:x" />);

    expect(await screen.findByTestId(testIds.guideReader.error)).toHaveTextContent('boom');
  });
});
