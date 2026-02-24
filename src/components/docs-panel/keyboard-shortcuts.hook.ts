import { useEffect } from 'react';
import { safeEventHandler } from '../../utils/safe-event-handler.util';
import type { LearningJourneyTab } from '../../types/content-panel.types';

interface UseKeyboardShortcutsProps {
  tabs: LearningJourneyTab[];
  activeTabId: string;
  activeTab: LearningJourneyTab | null;
  isRecommendationsTab: boolean;
  model: {
    closeTab: (tabId: string) => void;
    setActiveTab: (tabId: string) => void;
    navigateToNextMilestone: () => void;
    navigateToPreviousMilestone: () => void;
  };
}

export function useKeyboardShortcuts({
  tabs,
  activeTabId,
  activeTab,
  isRecommendationsTab,
  model,
}: UseKeyboardShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd + W to close current tab (except recommendations)
      if ((event.ctrlKey || event.metaKey) && event.key === 'w') {
        safeEventHandler(event, { preventDefault: true });
        if (activeTab && activeTab.id !== 'recommendations') {
          model.closeTab(activeTab.id);
        }
      }

      // Ctrl/Cmd + Tab to switch between tabs
      if ((event.ctrlKey || event.metaKey) && event.key === 'Tab') {
        safeEventHandler(event, { preventDefault: true });
        const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId);
        const nextIndex = event.shiftKey
          ? (currentIndex - 1 + tabs.length) % tabs.length
          : (currentIndex + 1) % tabs.length;
        model.setActiveTab(tabs[nextIndex]!.id);
      }

      // Alt+Arrow keys for milestone navigation.
      // Skip when focus is in a text-editable element so native word-jump
      // (Option+Arrow) and word-select (Option+Shift+Arrow) shortcuts work.
      if (!isRecommendationsTab && event.altKey) {
        const target = event.target as HTMLElement;
        const isTextEditable =
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.contentEditable === 'true';

        if (!isTextEditable) {
          if (event.key === 'ArrowRight') {
            safeEventHandler(event, { preventDefault: true });
            model.navigateToNextMilestone();
          }

          if (event.key === 'ArrowLeft') {
            safeEventHandler(event, { preventDefault: true });
            model.navigateToPreviousMilestone();
          }
        }
      }

      // Note: Ctrl+C cancellation is now handled globally by GlobalInteractionBlocker
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [model, tabs, activeTabId, activeTab, isRecommendationsTab]);
}
