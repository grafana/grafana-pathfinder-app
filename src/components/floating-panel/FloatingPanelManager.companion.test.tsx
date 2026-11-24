import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { panelModeManager } from '../../global-state/panel-mode';
import { closeCompanionGuide, getCompanionGuide, openCompanionGuide } from '../../global-state/companion-guide';
import { PANEL_MODE_CHANGE_EVENT } from '../../lib/event-names';
import type { LearningJourneyTab } from '../../types/content-panel.types';
import { FloatingPanelManager } from './FloatingPanelManager';

jest.mock('../docs-panel/docs-panel', () => ({ CombinedLearningJourneyPanel: jest.fn() }));
jest.mock('./FloatingPanelContent', () => ({ FloatingPanelContent: () => null }));
jest.mock('../OpenFeatureProvider', () => ({
  PathfinderFeatureProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('./CompanionGuidePanel', () => ({
  CompanionGuidePanel: ({ guide }: { guide: LearningJourneyTab }) => (
    <button onClick={() => jest.requireActual('../../global-state/companion-guide').closeCompanionGuide()}>
      {guide.title}
    </button>
  ),
}));

const guide: LearningJourneyTab = {
  id: 'instructional-guide',
  type: 'docs',
  title: 'Authoring instructions',
  baseUrl: 'bundled:instructions',
  currentUrl: 'bundled:instructions',
  isLoading: false,
  error: null,
  content: {
    content: '{"id":"instructions","title":"Instructions","blocks":[]}',
    type: 'single-doc',
    url: 'bundled:instructions',
    metadata: { title: 'Instructions' },
    lastFetched: '2026-11-24T00:00:00Z',
  },
};

beforeEach(() => {
  closeCompanionGuide();
  jest.spyOn(panelModeManager, 'getMode').mockReturnValue('sidebar');
  jest.spyOn(panelModeManager, 'setMode');
  jest.spyOn(panelModeManager, 'setModePersisted');
});
afterEach(() => jest.restoreAllMocks());

it('renders and closes the companion without changing sidebar mode', () => {
  render(<FloatingPanelManager />);
  act(() => openCompanionGuide(guide));
  fireEvent.click(screen.getByRole('button', { name: 'Authoring instructions' }));
  expect(screen.queryByRole('button', { name: 'Authoring instructions' })).not.toBeInTheDocument();
  expect(getCompanionGuide()).toBeNull();
  expect(panelModeManager.setMode).not.toHaveBeenCalled();
  expect(panelModeManager.setModePersisted).not.toHaveBeenCalled();
});

it('ends the companion session on a normal surface switch', () => {
  render(<FloatingPanelManager />);
  act(() => openCompanionGuide(guide));
  expect(screen.getByRole('button', { name: 'Authoring instructions' })).toBeInTheDocument();
  act(() => document.dispatchEvent(new CustomEvent(PANEL_MODE_CHANGE_EVENT, { detail: { mode: 'fullscreen' } })));
  expect(getCompanionGuide()).toBeNull();
  expect(screen.queryByRole('button', { name: 'Authoring instructions' })).not.toBeInTheDocument();
});
