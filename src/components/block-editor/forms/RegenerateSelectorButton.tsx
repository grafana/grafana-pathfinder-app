/**
 * RegenerateSelectorButton
 *
 * Per-form button that asks Grafana Assistant to refine a picked selector.
 * Grounded workflow:
 *   1. Resolve the current selector to a DOM element via querySelectorAllEnhanced.
 *   2. Build a structured element context (tag, attrs, ancestry, generator candidates).
 *   3. Ask useInlineAssistant for a single selector string.
 *   4. Validate + confirm the returned selector still matches the same element,
 *      otherwise fall back to the top candidate.
 */

import React, { useCallback } from 'react';
import { Button } from '@grafana/ui';
import { AppEvents } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import { useInlineAssistant } from '@grafana/assistant';
import {
  buildElementContext,
  buildSelectorSystemPrompt,
  selectorStillMatches,
  useAssistantAvailability,
  useMockInlineAssistant,
} from '../../../integrations/assistant-integration';
import { isAssistantDevModeEnabledGlobal } from '../../../utils/dev-mode';
import { querySelectorAllEnhanced, validateAndCleanSelector } from '../../../lib/dom';
import { testIds } from '../../../constants/testIds';

export interface RegenerateSelectorButtonProps {
  /** The current selector string from the form field */
  currentSelector: string;
  /** The action the selector will drive (e.g. highlight, button, formfill) */
  action: string;
  /** Called with the new selector when regeneration succeeds */
  onRegenerated: (selector: string) => void;
  /** Optional className for layout */
  className?: string;
}

function notifyWarning(title: string, message?: string): void {
  getAppEvents().publish({
    type: AppEvents.alertWarning.name,
    payload: message ? [title, message] : [title],
  });
}

function notifyError(title: string, message?: string): void {
  getAppEvents().publish({
    type: AppEvents.alertError.name,
    payload: message ? [title, message] : [title],
  });
}

function notifySuccess(title: string, message?: string): void {
  getAppEvents().publish({
    type: AppEvents.alertSuccess.name,
    payload: message ? [title, message] : [title],
  });
}

export function RegenerateSelectorButton({
  currentSelector,
  action,
  onRegenerated,
  className,
}: RegenerateSelectorButtonProps) {
  const isAssistantAvailable = useAssistantAvailability();
  const devModeEnabled = isAssistantDevModeEnabledGlobal();
  const realAssistant = useInlineAssistant();
  const mockAssistant = useMockInlineAssistant();
  const assistant = devModeEnabled ? mockAssistant : realAssistant;

  const handleClick = useCallback(() => {
    const trimmed = currentSelector.trim();
    if (!trimmed) {
      notifyWarning('No selector to refine', 'Pick an element first, then try again.');
      return;
    }

    const resolution = querySelectorAllEnhanced(trimmed);
    if (resolution.elements.length === 0) {
      notifyWarning(
        'Selector does not match any element',
        'Navigate to the page where this selector applies, then try again.'
      );
      return;
    }
    if (resolution.elements.length > 1) {
      notifyWarning(
        'Selector matches multiple elements',
        `Found ${resolution.elements.length} matches. Narrow the selector or re-pick the element first.`
      );
      return;
    }

    const element = resolution.elements[0]!;
    const context = buildElementContext(element, trimmed);
    const systemPrompt = buildSelectorSystemPrompt({ action, context });

    assistant.generate({
      prompt: 'Return the best selector for the target element described in the system prompt.',
      origin: 'grafana-pathfinder-app/regenerate-selector',
      systemPrompt,
      onComplete: (text) => {
        const raw = (text || '').trim().replace(/^["'`]+|["'`]+$/g, '');
        if (!raw) {
          notifyError('Assistant returned an empty selector');
          return;
        }

        const actionForValidator = ['highlight', 'button', 'formfill', 'navigate', 'hover'].includes(action)
          ? (action as 'highlight' | 'button' | 'formfill' | 'navigate' | 'hover')
          : 'highlight';
        const validated = validateAndCleanSelector(raw, actionForValidator);
        const nextSelector = validated.selector;

        if (!nextSelector) {
          const fallback = context.candidates.find((c) => c !== trimmed) ?? context.candidates[0];
          if (fallback) {
            onRegenerated(fallback);
            notifyWarning('Assistant response could not be validated', 'Used the top grounded candidate instead.');
          } else {
            notifyError('Assistant response could not be validated and no fallback was available.');
          }
          return;
        }

        if (selectorStillMatches(nextSelector, element)) {
          if (nextSelector === trimmed) {
            notifySuccess('Current selector already looks best', 'The assistant did not find a more stable option.');
            return;
          }
          onRegenerated(nextSelector);
          notifySuccess('Selector updated', `Method: ${context.selectorInfo.method}`);
          return;
        }

        const fallback = context.candidates.find((c) => c !== trimmed) ?? context.candidates[0];
        if (fallback && fallback !== trimmed) {
          onRegenerated(fallback);
          notifyWarning(
            'Assistant selector did not match the same element',
            'Used the top grounded candidate instead.'
          );
        } else {
          notifyError('Assistant selector did not match the same element and no fallback is available.');
        }
      },
      onError: (err) => {
        notifyError('Regenerate failed', err.message);
      },
    });
  }, [action, assistant, currentSelector, onRegenerated]);

  if (!isAssistantAvailable) {
    return null;
  }

  const disabled = !currentSelector.trim() || assistant.isGenerating;

  return (
    <Button
      variant="secondary"
      size="md"
      icon={assistant.isGenerating ? 'fa fa-spinner' : 'ai'}
      onClick={handleClick}
      type="button"
      disabled={disabled}
      tooltip="Ask Grafana Assistant to refine this selector using best practices"
      className={className}
      data-testid={testIds.blockEditor.regenerateSelectorButton}
    >
      {assistant.isGenerating ? 'Regenerating...' : 'Regenerate with AI'}
    </Button>
  );
}

RegenerateSelectorButton.displayName = 'RegenerateSelectorButton';
