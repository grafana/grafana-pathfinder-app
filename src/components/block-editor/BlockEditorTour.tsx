/**
 * Block Editor Tour
 *
 * A tour controller that guides new users through the block editor interface.
 * Uses the unified NavigationManager highlight system for consistent UX with guided mode.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { NavigationManager } from '../../interactive-engine/navigation-manager';

/**
 * Tour step definition
 */
interface TourStep {
  /** CSS selector or data-testid to target */
  target: string;
  /** Step title */
  title: string;
  /** Explanation text */
  content: string;
  /** Optional action to describe what happens when clicking the target */
  action?: 'highlight' | 'click';
}

/**
 * Tour steps for the block editor
 */
const TOUR_STEPS: TourStep[] = [
  {
    target: '[data-testid="block-editor"]',
    title: 'Welcome to the guide editor',
    content:
      'This is where you create interactive guides for Grafana. Guides combine markdown, interactive elements, and quizzes to help users learn.',
  },
  {
    target: '[data-testid="guide-metadata-button"]',
    title: 'Guide settings',
    content:
      'Click the gear icon to set your guide title and ID. The ID is used to load your guide and should be unique.',
  },
  {
    target: '[data-testid="view-mode-toggle"]',
    title: 'Edit and preview modes',
    content: 'Toggle between Edit mode (to modify blocks) and Preview mode (to see how your guide will look to users).',
  },
  {
    target: '[data-testid="copy-json-button"]',
    title: 'Export your guide',
    content:
      'When ready, copy the JSON to clipboard, download it, or create a GitHub PR. The copy button is the quickest way to share your guide.',
  },
  {
    target: '[data-testid="block-editor-content"]',
    title: 'Your blocks appear here',
    content:
      'As you add blocks, they appear in this area. You can drag to reorder, click to edit, and use action buttons to duplicate or delete.',
  },
  {
    target: '[data-testid="block-palette"]',
    title: 'Add blocks from here',
    content:
      'Click "Add Block" to see all available block types: Markdown for text, Interactive for UI actions, Quiz for knowledge checks, and more.',
  },
  {
    target: '[data-testid="block-editor"]',
    title: "You're ready to create!",
    content:
      "That's the basics! Start by loading the example guide to see how blocks work, or jump straight in and add your first block.",
  },
];

export interface BlockEditorTourProps {
  /** Called when the tour is closed */
  onClose: () => void;
  /** Optional custom tour steps */
  steps?: TourStep[];
}

/**
 * Tour controller for the block editor.
 * Uses NavigationManager's unified highlight system for visual consistency with guided mode.
 */
export function BlockEditorTour({ onClose, steps = TOUR_STEPS }: BlockEditorTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);

  // Navigation manager singleton
  const navigationManager = useMemo(() => new NavigationManager(), []);

  const totalSteps = steps.length;
  const step = steps[currentStep];

  // Navigate to next step
  const goToNext = useCallback(() => {
    // Mark current step as completed
    setCompletedSteps((prev) => (prev.includes(currentStep) ? prev : [...prev, currentStep]));

    if (currentStep < totalSteps - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      // Tour complete
      navigationManager.clearAllHighlights();
      onClose();
    }
  }, [currentStep, totalSteps, onClose, navigationManager]);

  // Navigate to previous step
  const goToPrevious = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  // Close the tour
  const handleClose = useCallback(() => {
    navigationManager.clearAllHighlights();
    onClose();
  }, [navigationManager, onClose]);

  // Highlight the current step's target element using unified system
  const highlightCurrentStep = useCallback(async () => {
    if (!step) {
      return;
    }

    // Find the target element
    const element = document.querySelector(step.target) as HTMLElement | null;

    // Build step info for progress display
    const stepInfo = {
      current: currentStep,
      total: totalSteps,
      completedSteps: [...completedSteps],
    };

    if (element) {
      // Use the unified NavigationManager highlight system
      // Pass navigation callbacks for tour mode, and options for visual enhancements
      // Skip animations after first step for smooth transitions
      await navigationManager.highlightWithComment(
        element,
        step.content,
        false, // Disable auto-cleanup for tour mode
        stepInfo,
        undefined, // No skip callback for tour
        handleClose, // Cancel callback
        goToNext, // Next callback (for tour navigation)
        currentStep > 0 ? goToPrevious : undefined, // Previous callback (disabled on first step)
        {
          showKeyboardHint: true,
          skipAnimations: currentStep > 0, // Instant transitions after first step
          stepTitle: step.title,
        }
      );
    } else {
      // If element not found, show a centered comment
      navigationManager.showNoopComment(
        `<strong>${step.title}</strong><br><br>${step.content}<br><br><em style="opacity: 0.7">Target element not visible - it may appear in a different editor state.</em>`
      );
    }
  }, [step, currentStep, totalSteps, completedSteps, navigationManager, handleClose, goToNext, goToPrevious]);

  // Highlight on step change
  useEffect(() => {
    highlightCurrentStep();
  }, [highlightCurrentStep]);

  // Clean up highlights on unmount
  useEffect(() => {
    return () => {
      navigationManager.clearAllHighlights();
    };
  }, [navigationManager]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        goToNext();
      } else if (e.key === 'ArrowLeft') {
        if (currentStep > 0) {
          goToPrevious();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [currentStep, handleClose, goToNext, goToPrevious]);

  // No JSX needed - the tour renders via NavigationManager's highlight system
  return null;
}

// Display name for debugging
BlockEditorTour.displayName = 'BlockEditorTour';
