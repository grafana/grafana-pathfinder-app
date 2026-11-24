import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { panelModeManager } from '../../global-state/panel-mode';
import { closeCompanionGuide, getCompanionGuide, openAuthoringGuide } from '../../global-state/companion-guide';
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

beforeEach(() => {
  closeCompanionGuide();
  jest.spyOn(panelModeManager, 'getMode').mockReturnValue('sidebar');
  jest.spyOn(panelModeManager, 'setMode');
  jest.spyOn(panelModeManager, 'setModePersisted');
});
afterEach(() => jest.restoreAllMocks());

it('renders and closes the authoring lesson without changing sidebar mode', () => {
  render(<FloatingPanelManager />);
  act(openAuthoringGuide);
  fireEvent.click(screen.getByRole('button', { name: 'Create your first interactive guide' }));
  expect(screen.queryByRole('button', { name: 'Create your first interactive guide' })).not.toBeInTheDocument();
  expect(getCompanionGuide()).toBeNull();
  expect(panelModeManager.setMode).not.toHaveBeenCalled();
  expect(panelModeManager.setModePersisted).not.toHaveBeenCalled();
});

it('ends the companion session on a normal surface switch', () => {
  render(<FloatingPanelManager />);
  act(openAuthoringGuide);
  expect(screen.getByRole('button', { name: 'Create your first interactive guide' })).toBeInTheDocument();
  act(() => document.dispatchEvent(new CustomEvent(PANEL_MODE_CHANGE_EVENT, { detail: { mode: 'fullscreen' } })));
  expect(getCompanionGuide()).toBeNull();
  expect(screen.queryByRole('button', { name: 'Create your first interactive guide' })).not.toBeInTheDocument();
});
