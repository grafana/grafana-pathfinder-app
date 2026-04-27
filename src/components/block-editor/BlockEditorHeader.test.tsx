import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { BlockEditorHeader } from './BlockEditorHeader';
import { panelModeManager, type PanelMode } from '../../global-state/panel-mode';

const baseProps = {
  guideTitle: 'Test guide',
  guideId: 'test-guide',
  isDirty: false,
  publishedStatus: 'not-saved' as const,
  hasUnsyncedChanges: false,
  viewMode: 'edit' as const,
  onSetViewMode: jest.fn(),
  onTitleCommit: jest.fn(),
  onOpenTour: jest.fn(),
  onOpenGuideLibrary: jest.fn(),
  onOpenImport: jest.fn(),
  onCopy: jest.fn(),
  onDownload: jest.fn(),
  onOpenGitHubPR: jest.fn(),
  onSaveDraft: jest.fn(),
  onPostToBackend: jest.fn(),
  onUnpublish: jest.fn(),
  onNewGuide: jest.fn(),
  isBackendAvailable: true,
};

describe('BlockEditorHeader: pop out / dock button', () => {
  let getModeSpy: jest.SpyInstance<PanelMode, []>;

  beforeEach(() => {
    getModeSpy = jest.spyOn(panelModeManager, 'getMode');
  });

  afterEach(() => {
    getModeSpy.mockRestore();
  });

  it('renders "Pop out" when the panel is currently in sidebar mode', () => {
    getModeSpy.mockReturnValue('sidebar');
    render(<BlockEditorHeader {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Pop out editor' })).toBeInTheDocument();
  });

  it("dispatches 'pathfinder-request-pop-out' when clicked from sidebar mode", () => {
    getModeSpy.mockReturnValue('sidebar');
    const dispatchSpy = jest.spyOn(document, 'dispatchEvent');
    try {
      render(<BlockEditorHeader {...baseProps} />);
      const button = screen.getByRole('button', { name: 'Pop out editor' });
      button.click();
      const popOutCall = dispatchSpy.mock.calls.find(
        (call) => (call[0] as Event).type === 'pathfinder-request-pop-out'
      );
      expect(popOutCall).toBeDefined();
    } finally {
      dispatchSpy.mockRestore();
    }
  });

  it('renders "Dock" when the panel is currently in floating mode', () => {
    getModeSpy.mockReturnValue('floating');
    render(<BlockEditorHeader {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Dock editor' })).toBeInTheDocument();
  });

  it("dispatches 'pathfinder-request-dock' when clicked from floating mode", () => {
    getModeSpy.mockReturnValue('floating');
    const dispatchSpy = jest.spyOn(document, 'dispatchEvent');
    try {
      render(<BlockEditorHeader {...baseProps} />);
      const button = screen.getByRole('button', { name: 'Dock editor' });
      button.click();
      const dockCall = dispatchSpy.mock.calls.find((call) => (call[0] as Event).type === 'pathfinder-request-dock');
      expect(dockCall).toBeDefined();
    } finally {
      dispatchSpy.mockRestore();
    }
  });

  it("reacts to 'pathfinder-panel-mode-change' events at runtime", () => {
    getModeSpy.mockReturnValue('sidebar');
    render(<BlockEditorHeader {...baseProps} />);

    expect(screen.getByRole('button', { name: 'Pop out editor' })).toBeInTheDocument();

    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-panel-mode-change', { detail: { mode: 'floating' } }));
    });

    expect(screen.getByRole('button', { name: 'Dock editor' })).toBeInTheDocument();
  });
});
