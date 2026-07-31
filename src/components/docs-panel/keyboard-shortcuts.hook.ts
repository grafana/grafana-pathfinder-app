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

/**
 * Tabs Ctrl/Cmd+Tab may focus. Dev Tools is overflow-only with no strip/rail
 * active marker — cycling onto it leaves no visible tab marked active.
 * Recommendations stays (left-rail icon) alongside guide-strip tabs.
 */
function getKeyboardCycleTabs(tabs: LearningJourneyTab[]): LearningJourneyTab[] {
  return tabs.filter((tab) => tab.type !== 'devtools');
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
      // Ctrl/Cmd + W to close current tab (except recommendations).
      // closeTab itself gates editor discard confirmation.
      if ((event.ctrlKey || event.metaKey) && event.key === 'w') {
        safeEventHandler(event, { preventDefault: true });
        if (activeTab && activeTab.type !== 'recommendations') {
          model.closeTab(activeTab.id);
        }
      }

      // Ctrl/Cmd + Tab to switch between tabs
      if ((event.ctrlKey || event.metaKey) && event.key === 'Tab') {
        safeEventHandler(event, { preventDefault: true });
        const cycleTabs = getKeyboardCycleTabs(tabs);
        if (cycleTabs.length === 0) {
          return;
        }
        const currentIndex = cycleTabs.findIndex((tab) => tab.id === activeTabId);
        // Active Dev Tools is outside the cycle (−1): forward → first, back → last.
        const nextIndex = event.shiftKey
          ? ((currentIndex === -1 ? 0 : currentIndex) - 1 + cycleTabs.length) % cycleTabs.length
          : (currentIndex + 1) % cycleTabs.length;
        model.setActiveTab(cycleTabs[nextIndex]!.id);
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
