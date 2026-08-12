/**
 * The Redo affordance a completed step offers, shared by every step type that
 * has one so they stay one control rather than five look-alikes.
 *
 * Pair with `useStepRedo` for the handler.
 */

import React from 'react';
import { Button } from '@grafana/ui';

import { testIds } from '../../constants/testIds';

interface StepRedoButtonProps {
  stepId: string;
  onClick: () => void;
  disabled?: boolean;
  /** Shown as the tooltip; say what re-doing this step means. */
  title?: string;
}

export function StepRedoButton({ stepId, onClick, disabled = false, title }: StepRedoButtonProps) {
  return (
    <Button
      size="sm"
      variant="secondary"
      fill="text"
      onClick={onClick}
      disabled={disabled}
      data-testid={testIds.interactive.redoButton(stepId)}
      title={title ?? 'Redo this step'}
    >
      ↻ Redo
    </Button>
  );
}
