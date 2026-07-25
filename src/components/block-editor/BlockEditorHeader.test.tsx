import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { BlockEditorHeader } from './BlockEditorHeader';
import { panelModeManager, type PanelMode } from '../../global-state/panel-mode';
import { testIds } from '../../constants/testIds';

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
  hasBackendGuides: true,
  hasBlocks: false,
  isSelectionMode: false,
  onToggleSelectionMode: jest.fn(),
  onUndo: jest.fn(),
  onRedo: jest.fn(),
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
};

describe('BlockEditorHeader: pop out / dock (in the more-actions kebab)', () => {
  let getModeSpy: jest.SpyInstance<PanelMode, []>;

  beforeEach(() => {
    getModeSpy = jest.spyOn(panelModeManager, 'getMode');
  });

  afterEach(() => {
    getModeSpy.mockRestore();
  });

  const openKebab = () => fireEvent.click(screen.getByTestId(testIds.blockEditor.moreActionsButton));
  const popOutItem = () => screen.getByTestId('pathfinder-block-editor-toggle-popout');

  it('shows "Pop out" in the kebab when the panel is in sidebar mode', () => {
    getModeSpy.mockReturnValue('sidebar');
    render(<BlockEditorHeader {...baseProps} />);
    openKebab();
    expect(popOutItem()).toHaveTextContent('Pop out');
  });

  it("dispatches 'pathfinder-request-pop-out' when the kebab item is clicked from sidebar mode", () => {
    getModeSpy.mockReturnValue('sidebar');
    const dispatchSpy = jest.spyOn(document, 'dispatchEvent');
    try {
      render(<BlockEditorHeader {...baseProps} />);
      openKebab();
      fireEvent.click(popOutItem());
      const popOutCall = dispatchSpy.mock.calls.find(
        (call) => (call[0] as Event).type === 'pathfinder-request-pop-out'
      );
      expect(popOutCall).toBeDefined();
    } finally {
      dispatchSpy.mockRestore();
    }
  });

  it('shows "Dock" in the kebab when the panel is in floating mode', () => {
    getModeSpy.mockReturnValue('floating');
    render(<BlockEditorHeader {...baseProps} />);
    openKebab();
    expect(popOutItem()).toHaveTextContent('Dock');
  });

  it("dispatches 'pathfinder-request-dock' when the kebab item is clicked from floating mode", () => {
    getModeSpy.mockReturnValue('floating');
    const dispatchSpy = jest.spyOn(document, 'dispatchEvent');
    try {
      render(<BlockEditorHeader {...baseProps} />);
      openKebab();
      fireEvent.click(popOutItem());
      const dockCall = dispatchSpy.mock.calls.find((call) => (call[0] as Event).type === 'pathfinder-request-dock');
      expect(dockCall).toBeDefined();
    } finally {
      dispatchSpy.mockRestore();
    }
  });

  it("reacts to 'pathfinder-panel-mode-change' events at runtime", () => {
    getModeSpy.mockReturnValue('sidebar');
    render(<BlockEditorHeader {...baseProps} />);
    openKebab();

    expect(popOutItem()).toHaveTextContent('Pop out');

    act(() => {
      document.dispatchEvent(new CustomEvent('pathfinder-panel-mode-change', { detail: { mode: 'floating' } }));
    });

    expect(popOutItem()).toHaveTextContent('Dock');
  });
});

describe('BlockEditorHeader: Library menu item visibility', () => {
  const openMoreActions = () => {
    fireEvent.click(screen.getByTestId(testIds.blockEditor.moreActionsButton));
  };

  it('shows the Library item when the backend is available and there are guides to manage', () => {
    render(<BlockEditorHeader {...baseProps} isBackendAvailable={true} hasBackendGuides={true} />);
    openMoreActions();
    expect(screen.getByText('Library')).toBeInTheDocument();
  });

  it('hides the Library item once the backend has confirmed no guides', () => {
    render(<BlockEditorHeader {...baseProps} isBackendAvailable={true} hasBackendGuides={false} />);
    openMoreActions();
    // The menu is open (Import is always present), but Library is gated out.
    expect(screen.getByText('Import')).toBeInTheDocument();
    expect(screen.queryByText('Library')).not.toBeInTheDocument();
  });
});
