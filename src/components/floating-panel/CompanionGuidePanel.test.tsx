import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { testIds } from '../../constants/testIds';
import type { LearningJourneyTab } from '../../types/content-panel.types';
import { CompanionGuidePanel } from './CompanionGuidePanel';

const guide: LearningJourneyTab = {
  id: 'instructions',
  type: 'docs',
  title: 'Instructions',
  baseUrl: 'bundled:instructions',
  currentUrl: 'bundled:instructions',
  isLoading: false,
  error: null,
  content: {
    content: '{}',
    type: 'single-doc',
    url: 'bundled:instructions',
    metadata: { title: 'Instructions' },
    lastFetched: '2026-11-24T00:00:00Z',
  },
};
const mockPanel = { setState: jest.fn(), useState: () => ({ tabs: [guide], activeTabId: guide.id }) };

jest.mock('../docs-panel/docs-panel', () => ({ CombinedLearningJourneyPanel: jest.fn(() => mockPanel) }));
jest.mock('../../hooks', () => ({
  useGuideProgressState: () => ({ hasInteractiveProgress: false, progressKey: null }),
}));
jest.mock('../docs-panel/hooks', () => ({ useContentReset: () => jest.fn() }));
jest.mock('./FloatingPanel', () => ({
  FloatingPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('./FloatingPanelContent', () => ({ FloatingPanelContent: () => <div>Ready to teach authoring</div> }));
jest.mock('@grafana/i18n', () => ({ t: (_key: string, fallback: string) => fallback }));

it('waits for editor controls before evaluating instructional steps', async () => {
  render(<CompanionGuidePanel guide={guide} />);
  expect(screen.queryByText('Ready to teach authoring')).not.toBeInTheDocument();
  const editor = document.createElement('div');
  editor.dataset.testid = testIds.blockEditor.container;
  try {
    await act(async () => {
      document.body.appendChild(editor);
    });
    expect(await screen.findByText('Ready to teach authoring')).toBeInTheDocument();
  } finally {
    editor.remove();
  }
});
