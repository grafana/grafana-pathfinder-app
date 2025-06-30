import { useEffect } from 'react';

interface LearningJourneyTab {
  id: string;
  title: string;
  baseUrl: string;
  content: any;
  isLoading: boolean;
  error: string | null;
  type?: 'learning-journey' | 'docs';
  docsContent?: any;
}

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
        event.preventDefault();
        if (activeTab && activeTab.id !== 'recommendations') {
          model.closeTab(activeTab.id);
        }
      }
      
      // Ctrl/Cmd + Tab to switch between tabs
      if ((event.ctrlKey || event.metaKey) && event.key === 'Tab') {
        event.preventDefault();
        const currentIndex = tabs.findIndex(tab => tab.id === activeTabId);
        const nextIndex = event.shiftKey 
          ? (currentIndex - 1 + tabs.length) % tabs.length
          : (currentIndex + 1) % tabs.length;
        model.setActiveTab(tabs[nextIndex].id);
      }

      // Arrow keys for milestone navigation (only for learning journey tabs)
      if (!isRecommendationsTab) {
        if (event.altKey && event.key === 'ArrowRight') {
          event.preventDefault();
          model.navigateToNextMilestone();
        }
        
        if (event.altKey && event.key === 'ArrowLeft') {
          event.preventDefault();
          model.navigateToPreviousMilestone();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [model, tabs, activeTabId, activeTab, isRecommendationsTab]);
} 
