import { renderHook, cleanup, fireEvent } from '@testing-library/react';
import { useKeyboardShortcuts } from './keyboard-shortcuts.hook';
import type { LearningJourneyTab } from '../../types/content-panel.types';

describe('useKeyboardShortcuts', () => {
  const mockModel = {
    closeTab: jest.fn(),
    setActiveTab: jest.fn(),
    navigateToNextMilestone: jest.fn(),
    navigateToPreviousMilestone: jest.fn(),
  };

  const mockTabs = [
    { id: 'tab1', title: 'Tab 1', baseUrl: '', content: null, isLoading: false, error: null },
    { id: 'tab2', title: 'Tab 2', baseUrl: '', content: null, isLoading: false, error: null },
    { id: 'recommendations', title: 'Recommendations', baseUrl: '', content: null, isLoading: false, error: null },
  ] as LearningJourneyTab[];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup(); // Clean up React components
    jest.clearAllMocks();
  });

  it('should close active tab on Ctrl+W except recommendations', () => {
    // Test regular tab
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts({
        tabs: mockTabs,
        activeTabId: 'tab1',
        activeTab: mockTabs[0]!,
        isRecommendationsTab: false,
        model: mockModel,
      })
    );

    fireEvent.keyDown(document, { key: 'w', ctrlKey: true });
    expect(mockModel.closeTab).toHaveBeenCalledWith('tab1');

    // Clean up first render
    unmount();

    // Test recommendations tab
    renderHook(() =>
      useKeyboardShortcuts({
        tabs: mockTabs,
        activeTabId: 'recommendations',
        activeTab: mockTabs[2]!,
        isRecommendationsTab: true,
        model: mockModel,
      })
    );

    mockModel.closeTab.mockClear();
    fireEvent.keyDown(document, { key: 'w', ctrlKey: true });
    expect(mockModel.closeTab).not.toHaveBeenCalled();
  });

  it('should switch tabs with Ctrl+Tab', () => {
    renderHook(() =>
      useKeyboardShortcuts({
        tabs: mockTabs,
        activeTabId: 'tab1',
        activeTab: mockTabs[0]!,
        isRecommendationsTab: false,
        model: mockModel,
      })
    );

    // Forward tab
    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true });
    expect(mockModel.setActiveTab).toHaveBeenCalledWith('tab2');

    // Backward tab
    mockModel.setActiveTab.mockClear();
    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true, shiftKey: true });
    expect(mockModel.setActiveTab).toHaveBeenCalledWith('recommendations');
  });

  it('should navigate milestones with Alt+Arrow keys when not in recommendations', () => {
    renderHook(() =>
      useKeyboardShortcuts({
        tabs: mockTabs,
        activeTabId: 'tab1',
        activeTab: mockTabs[0]!,
        isRecommendationsTab: false,
        model: mockModel,
      })
    );

    // Next milestone
    fireEvent.keyDown(document, { key: 'ArrowRight', altKey: true });
    expect(mockModel.navigateToNextMilestone).toHaveBeenCalled();

    // Previous milestone
    fireEvent.keyDown(document, { key: 'ArrowLeft', altKey: true });
    expect(mockModel.navigateToPreviousMilestone).toHaveBeenCalled();
  });

  it('should not navigate milestones when in recommendations tab', () => {
    renderHook(() =>
      useKeyboardShortcuts({
        tabs: mockTabs,
        activeTabId: 'recommendations',
        activeTab: mockTabs[2]!,
        isRecommendationsTab: true,
        model: mockModel,
      })
    );

    fireEvent.keyDown(document, { key: 'ArrowRight', altKey: true });
    expect(mockModel.navigateToNextMilestone).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'ArrowLeft', altKey: true });
    expect(mockModel.navigateToPreviousMilestone).not.toHaveBeenCalled();
  });

  it.each([
    { element: 'input', factory: () => document.createElement('input') },
    { element: 'textarea', factory: () => document.createElement('textarea') },
    {
      element: 'contentEditable div',
      factory: () => {
        const div = document.createElement('div');
        div.contentEditable = 'true';
        return div;
      },
    },
  ])('should not intercept Alt+Arrow when focus is in a $element', ({ factory }) => {
    renderHook(() =>
      useKeyboardShortcuts({
        tabs: mockTabs,
        activeTabId: 'tab1',
        activeTab: mockTabs[0]!,
        isRecommendationsTab: false,
        model: mockModel,
      })
    );

    const target = factory();
    document.body.appendChild(target);

    fireEvent.keyDown(target, { key: 'ArrowRight', altKey: true });
    fireEvent.keyDown(target, { key: 'ArrowLeft', altKey: true });
    fireEvent.keyDown(target, { key: 'ArrowRight', altKey: true, shiftKey: true });
    fireEvent.keyDown(target, { key: 'ArrowLeft', altKey: true, shiftKey: true });

    expect(mockModel.navigateToNextMilestone).not.toHaveBeenCalled();
    expect(mockModel.navigateToPreviousMilestone).not.toHaveBeenCalled();

    document.body.removeChild(target);
  });
});
