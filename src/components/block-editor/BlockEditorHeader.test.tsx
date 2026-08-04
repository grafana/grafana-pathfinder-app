import React from 'react';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { BlockEditorHeader } from './BlockEditorHeader';
import { panelModeManager, type PanelMode } from '../../global-state/panel-mode';
import { testIds } from '../../constants/testIds';

// Surface Grafana's Badge `color`/`icon` props as data-attributes so a color
// regression (e.g. Draft reverting to purple) fails loudly. `text` passes through
// unchanged, so the presence/location assertions below still exercise real markup.
jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  const react = require('react');
  return {
    ...actual,
    Badge: ({ text, color, icon }: { text: React.ReactNode; color: string; icon: string }) =>
      react.createElement('span', { 'data-testid': 'be-badge', 'data-color': color, 'data-icon': icon }, text),
  };
});

const baseProps = {
  guideTitle: 'Test guide',
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

describe('BlockEditorHeader: toolbar row + undo/redo', () => {
  it('renders the view-mode rocker as radios', () => {
    render(<BlockEditorHeader {...baseProps} viewMode="edit" />);
    expect(screen.getByRole('radio', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'JSON' })).toBeInTheDocument();
  });

  it('shows undo/redo in edit mode, disabled when there is no history', () => {
    render(<BlockEditorHeader {...baseProps} viewMode="edit" canUndo={false} canRedo={false} />);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });

  it('does not render undo/redo outside edit mode', () => {
    render(<BlockEditorHeader {...baseProps} viewMode="preview" />);
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Redo' })).not.toBeInTheDocument();
  });
});

describe('BlockEditorHeader: preview mode', () => {
  it('hides the editable title input in preview (title row is not rendered)', () => {
    render(<BlockEditorHeader {...baseProps} viewMode="preview" />);
    expect(screen.queryByLabelText('Guide title')).not.toBeInTheDocument();
    // The whole row is gone in preview, not just the input (regression guard for
    // the old aria-hidden spacer, which left the row present).
    expect(screen.queryByTestId(testIds.blockEditor.titleRow)).not.toBeInTheDocument();
  });

  it('keeps the local-save indicator visible in preview when the backend is unavailable', () => {
    render(<BlockEditorHeader {...baseProps} viewMode="preview" isBackendAvailable={false} isDirty={false} />);
    // The title row is hidden in preview, so the Saved-to-local-storage
    // indicator relocates to the toolbar row — no-backend users keep save-state
    // feedback.
    expect(screen.getByLabelText('Saved')).toBeInTheDocument();
  });

  it('relocates the publish-status badge into the toolbar row in preview', () => {
    render(<BlockEditorHeader {...baseProps} viewMode="preview" isBackendAvailable={true} publishedStatus="draft" />);
    // Assert LOCATION, not just presence: the badge must be inside the toolbar
    // row (the title row is gone in preview).
    const toolbar = screen.getByTestId(testIds.blockEditor.toolbarRow);
    expect(within(toolbar).getByText('Draft')).toBeInTheDocument();
  });
});

describe('BlockEditorHeader: publish-status badge', () => {
  it('shows the Draft badge in the title row in edit mode when the backend is available', () => {
    render(<BlockEditorHeader {...baseProps} viewMode="edit" isBackendAvailable={true} publishedStatus="draft" />);
    const titleRow = screen.getByTestId(testIds.blockEditor.titleRow);
    expect(within(titleRow).getByText('Draft')).toBeInTheDocument();
  });

  it('shows the Published badge for a published guide with no unsynced changes', () => {
    render(
      <BlockEditorHeader
        {...baseProps}
        viewMode="edit"
        isBackendAvailable={true}
        publishedStatus="published"
        hasUnsyncedChanges={false}
      />
    );
    expect(screen.getByText('Published')).toBeInTheDocument();
  });

  it('shows the "Draft (modified)" variant for a draft with unsynced changes', () => {
    render(
      <BlockEditorHeader
        {...baseProps}
        viewMode="edit"
        isBackendAvailable={true}
        publishedStatus="draft"
        hasUnsyncedChanges={true}
      />
    );
    expect(screen.getByText('Draft (modified)')).toBeInTheDocument();
  });

  it('shows the "Published (modified)" variant for a published guide with unsynced changes', () => {
    render(
      <BlockEditorHeader
        {...baseProps}
        viewMode="edit"
        isBackendAvailable={true}
        publishedStatus="published"
        hasUnsyncedChanges={true}
      />
    );
    expect(screen.getByText('Published (modified)')).toBeInTheDocument();
  });

  it('hides the badge entirely when the backend is unavailable', () => {
    render(<BlockEditorHeader {...baseProps} viewMode="edit" isBackendAvailable={false} publishedStatus="draft" />);
    expect(screen.queryByText('Draft')).not.toBeInTheDocument();
  });
});

describe('BlockEditorHeader: badge colors, compaction, and title size', () => {
  it('colors the Draft badge blue', () => {
    render(<BlockEditorHeader {...baseProps} viewMode="edit" isBackendAvailable publishedStatus="draft" />);
    expect(screen.getByTestId('be-badge')).toHaveAttribute('data-color', 'blue');
  });

  it('colors the Published badge green', () => {
    render(
      <BlockEditorHeader
        {...baseProps}
        viewMode="edit"
        isBackendAvailable
        publishedStatus="published"
        hasUnsyncedChanges={false}
      />
    );
    expect(screen.getByTestId('be-badge')).toHaveAttribute('data-color', 'green');
  });

  it('colors the modified badge orange', () => {
    render(
      <BlockEditorHeader
        {...baseProps}
        viewMode="edit"
        isBackendAvailable
        publishedStatus="published"
        hasUnsyncedChanges
      />
    );
    expect(screen.getByTestId('be-badge')).toHaveAttribute('data-color', 'orange');
  });

  it('wraps the badge label so the narrow preview toolbar can collapse it to an icon', () => {
    const { container } = render(
      <BlockEditorHeader {...baseProps} viewMode="preview" isBackendAvailable publishedStatus="published" />
    );
    expect(container.querySelector('[data-badge-label]')).toHaveTextContent('Published');
  });

  it('does not wrap the local-save indicator (it must stay visible at every width)', () => {
    const { container } = render(
      <BlockEditorHeader {...baseProps} viewMode="preview" isBackendAvailable={false} isDirty={false} />
    );
    expect(screen.getByLabelText('Saved')).toBeInTheDocument();
    expect(container.querySelector('[data-badge-label]')).toBeNull();
  });

  it.each([
    ['a', 8], // below MIN_TITLE_CHARS → clamped up to 8
    ['Test guide', 11], // length 10 + 1
    ['x'.repeat(80), 60], // above MAX_TITLE_CHARS → clamped down to 60
  ])('sizes the title input within the 8–60 char bounds (%s → %i)', (title, expectedSize) => {
    render(<BlockEditorHeader {...baseProps} viewMode="edit" guideTitle={title} />);
    expect(screen.getByLabelText('Guide title')).toHaveAttribute('size', String(expectedSize));
  });
});
