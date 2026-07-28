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

describe('BlockEditorHeader: full screen (in the more-actions kebab)', () => {
  let getModeSpy: jest.SpyInstance<PanelMode, []>;

  beforeEach(() => {
    getModeSpy = jest.spyOn(panelModeManager, 'getMode');
  });

  afterEach(() => {
    getModeSpy.mockRestore();
  });

  const openKebab = () => fireEvent.click(screen.getByTestId(testIds.blockEditor.moreActionsButton));
  const fullScreenItem = () => screen.queryByTestId('pathfinder-block-editor-go-fullscreen');

  it('shows the Full screen item when not already in fullscreen', () => {
    getModeSpy.mockReturnValue('sidebar');
    render(<BlockEditorHeader {...baseProps} />);
    openKebab();
    expect(fullScreenItem()).toBeInTheDocument();
  });

  it('hides the Full screen item when already in fullscreen mode', () => {
    getModeSpy.mockReturnValue('fullscreen');
    render(<BlockEditorHeader {...baseProps} />);
    openKebab();
    expect(fullScreenItem()).not.toBeInTheDocument();
  });

  it("dispatches 'pathfinder-request-full-screen' when the Full screen item is clicked", () => {
    getModeSpy.mockReturnValue('sidebar');
    const dispatchSpy = jest.spyOn(document, 'dispatchEvent');
    try {
      render(<BlockEditorHeader {...baseProps} />);
      openKebab();
      fireEvent.click(fullScreenItem()!);
      const call = dispatchSpy.mock.calls.find((c) => (c[0] as Event).type === 'pathfinder-request-full-screen');
      expect(call).toBeDefined();
    } finally {
      dispatchSpy.mockRestore();
    }
  });
});

describe('BlockEditorHeader: selection mode (in the more-actions kebab)', () => {
  const openKebab = () => fireEvent.click(screen.getByTestId(testIds.blockEditor.moreActionsButton));
  const selectionItem = () => screen.queryByTestId(testIds.blockEditor.toggleSelectionButton);

  it('shows the selection item only in edit mode with blocks', () => {
    render(<BlockEditorHeader {...baseProps} viewMode="edit" hasBlocks={true} />);
    openKebab();
    expect(selectionItem()).toHaveTextContent('Select blocks for merging');
  });

  it('hides the selection item when the guide has no blocks', () => {
    render(<BlockEditorHeader {...baseProps} viewMode="edit" hasBlocks={false} />);
    openKebab();
    expect(selectionItem()).not.toBeInTheDocument();
  });

  it('hides the selection item outside edit mode', () => {
    render(<BlockEditorHeader {...baseProps} viewMode="preview" hasBlocks={true} />);
    openKebab();
    expect(selectionItem()).not.toBeInTheDocument();
  });

  it('labels the item "Exit selection mode" while selection mode is active', () => {
    render(<BlockEditorHeader {...baseProps} viewMode="edit" hasBlocks={true} isSelectionMode={true} />);
    openKebab();
    expect(selectionItem()).toHaveTextContent('Exit selection mode');
  });

  it('calls onToggleSelectionMode when the item is clicked', () => {
    const onToggleSelectionMode = jest.fn();
    render(
      <BlockEditorHeader
        {...baseProps}
        viewMode="edit"
        hasBlocks={true}
        onToggleSelectionMode={onToggleSelectionMode}
      />
    );
    openKebab();
    fireEvent.click(selectionItem()!);
    expect(onToggleSelectionMode).toHaveBeenCalledTimes(1);
  });
});
