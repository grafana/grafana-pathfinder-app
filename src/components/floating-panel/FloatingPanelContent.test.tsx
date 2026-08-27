/**
 * Surface-level completion-emission test for FloatingPanelContent, the content
 * owner shared by BOTH the floating and full-screen surfaces (FloatingPanelManager
 * and FullScreenPanel each render through it without wiring emission themselves).
 * Completing a guide in either surface must route through the shared, surface-neutral
 * emitter — see `surface-emission-owner`.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FloatingPanelContent } from './FloatingPanelContent';

jest.mock('../content-renderer/content-renderer', () => ({
  ContentRenderer: ({ onGuideComplete }: { onGuideComplete?: () => void }) => (
    <button onClick={onGuideComplete}>Complete rendered guide</button>
  ),
}));

jest.mock('../../docs-retrieval', () => ({
  recordGuideCompletionForSurface: jest.fn(),
}));

jest.mock('../docs-panel/link-handler.hook', () => ({
  useLinkClickHandler: () => undefined,
}));

jest.mock('../docs-panel/components', () => ({
  AlignmentPrompt: () => null,
  GuideVersionNotice: () => null,
  LearningJourneyMilestoneToolbar: () => null,
}));

jest.mock('../InteractiveLearningBanner', () => ({
  InteractiveLearningBanner: () => null,
}));

jest.mock('@grafana/ui', () => ({
  useStyles2: () => ({}),
  useTheme2: () => ({}),
}));

const { recordGuideCompletionForSurface } = jest.requireMock('../../docs-retrieval');

function content(overrides: Record<string, unknown> = {}): any {
  return {
    url: 'https://example.com/remote-guide/content.json',
    type: 'docs',
    content: '',
    metadata: { title: 'Remote guide', packageManifest: { id: 'remote-guide', repository: 'app-platform' } },
    lastFetched: '',
    ...overrides,
  };
}

function activeTab(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'tab-1',
    title: 'My guide',
    type: 'docs',
    baseUrl: 'https://example.com/remote-guide',
    currentUrl: 'https://example.com/remote-guide/content.json',
    ...overrides,
  };
}

beforeEach(() => {
  recordGuideCompletionForSurface.mockClear();
});

describe('FloatingPanelContent completion emission', () => {
  it('routes a completed guide through the shared surface-neutral emitter', () => {
    render(<FloatingPanelContent content={content()} activeTab={activeTab()} model={{} as any} />);

    fireEvent.click(screen.getByRole('button', { name: 'Complete rendered guide' }));

    expect(recordGuideCompletionForSurface).toHaveBeenCalledWith({
      baseUrl: 'https://example.com/remote-guide',
      contentUrl: 'https://example.com/remote-guide/content.json',
      currentUrl: 'https://example.com/remote-guide/content.json',
      contentType: 'docs',
      metadata: content().metadata,
      guideTitle: 'My guide',
    });
  });
});
