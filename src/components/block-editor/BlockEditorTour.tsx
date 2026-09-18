import React from 'react';

import { BubbleTour, type BubbleTourStep } from '../BubbleTour';
import { testIds } from '../../constants/testIds';

const TOUR_STEPS: BubbleTourStep[] = [
  {
    target: `[data-testid="${testIds.blockEditor.container}"]`,
    title: 'Welcome to the guide editor',
    content:
      'This is where you create interactive guides for Grafana. Guides combine markdown, interactive elements, and quizzes to help users learn.',
  },
  {
    target: `[data-testid="${testIds.blockEditor.viewModeToggle}"]`,
    title: 'Edit and preview modes',
    content: 'Toggle between Edit mode (to modify blocks) and Preview mode (to see how your guide will look to users).',
  },
  {
    target: `[data-testid="${testIds.blockEditor.moreActionsButton}"]`,
    title: 'More actions',
    content:
      "This menu holds the editor's secondary actions — create or load a guide, pop out or go full screen, toggle block selection, and import, export, or share the guide JSON.",
  },
  {
    target: `[data-testid="${testIds.blockEditor.content}"]`,
    title: 'Your blocks appear here',
    content:
      'As you add blocks, they appear in this area. You can drag to reorder, click to edit, and use action buttons to duplicate or delete.',
  },
  {
    target: `[data-testid="${testIds.blockEditor.palette}"]`,
    title: 'Add blocks from here',
    content:
      'Click "Add Block" to see all available block types: Markdown for text, Interactive for UI actions, Quiz for knowledge checks, and more.',
  },
  {
    target: `[data-testid="${testIds.blockEditor.container}"]`,
    title: "You're ready to create!",
    content:
      "That's the basics! Start by loading the example guide to see how blocks work, or jump straight in and add your first block.",
  },
];

export interface BlockEditorTourProps {
  onClose: () => void;
}

export function BlockEditorTour({ onClose }: BlockEditorTourProps) {
  return <BubbleTour steps={TOUR_STEPS} onClose={onClose} finalStepLabel="Start creating" />;
}

BlockEditorTour.displayName = 'BlockEditorTour';
