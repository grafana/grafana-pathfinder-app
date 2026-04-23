/**
 * Generate Guide Modal
 *
 * Prompts the user for a natural-language description of a guide, asks the
 * Grafana Assistant to generate a JSON guide matching the Pathfinder schema,
 * validates the output, and (on confirm) replaces the current editor state.
 *
 * The assistant response is treated as untrusted: every response flows through
 * parseAndValidateGuide (Zod-backed) before it can reach the editor.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Button, Modal, TextArea, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { useInlineAssistant } from '@grafana/assistant';
import {
  buildGuideSystemPrompt,
  extractJsonFromResponse,
  useAssistantAvailability,
  useMockInlineAssistant,
} from '../../integrations/assistant-integration';
import { isAssistantDevModeEnabledGlobal } from '../../utils/dev-mode';
import { parseAndValidateGuide, type ImportValidationResult } from './utils/block-import';
import type { JsonGuide } from './types';
import { testIds } from '../../constants/testIds';

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),
  description: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  promptArea: css({
    fontFamily: theme.typography.fontFamily,
    minHeight: '160px',
    resize: 'vertical',
  }),
  hint: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  preview: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: '12px',
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(1),
    maxHeight: '160px',
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  }),
  errorList: css({
    margin: 0,
    paddingLeft: theme.spacing(2),
    fontSize: theme.typography.bodySmall.fontSize,
    '& li': {
      marginBottom: theme.spacing(0.5),
    },
  }),
  footer: css({
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
    paddingTop: theme.spacing(2),
    borderTop: `1px solid ${theme.colors.border.weak}`,
    marginTop: theme.spacing(1),
  }),
  spacer: css({
    flex: 1,
  }),
});

export interface GenerateGuideModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Called when a valid guide has been generated and confirmed */
  onGenerated: (guide: JsonGuide) => void;
  /** Called to close the modal */
  onClose: () => void;
  /** Whether there is current content that would be lost on replace */
  hasUnsavedChanges?: boolean;
}

interface GenerationState {
  prompt: string;
  rawResponse: string | null;
  validation: ImportValidationResult | null;
  confirmingReplace: boolean;
}

const INITIAL_STATE: GenerationState = {
  prompt: '',
  rawResponse: null,
  validation: null,
  confirmingReplace: false,
};

export function GenerateGuideModal({
  isOpen,
  onGenerated,
  onClose,
  hasUnsavedChanges = false,
}: GenerateGuideModalProps) {
  const styles = useStyles2(getStyles);
  const isAssistantAvailable = useAssistantAvailability();
  const devModeEnabled = isAssistantDevModeEnabledGlobal();
  const realAssistant = useInlineAssistant();
  const mockAssistant = useMockInlineAssistant();
  const assistant = devModeEnabled ? mockAssistant : realAssistant;
  const [state, setState] = useState<GenerationState>(INITIAL_STATE);

  const previousErrors = useMemo(() => {
    if (!state.validation || state.validation.isValid) {
      return undefined;
    }
    return state.validation.errors.map((e) => e.message);
  }, [state.validation]);

  const resetState = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const handleGenerate = useCallback(
    (retry = false) => {
      const prompt = state.prompt.trim();
      if (!prompt || assistant.isGenerating) {
        return;
      }

      if (!retry) {
        setState((prev) => ({ ...prev, rawResponse: null, validation: null, confirmingReplace: false }));
      }

      const systemPrompt = buildGuideSystemPrompt({ previousErrors: retry ? previousErrors : undefined });

      assistant.generate({
        prompt,
        origin: 'grafana-pathfinder-app/generate-guide',
        systemPrompt,
        onComplete: (text) => {
          const jsonString = extractJsonFromResponse(text);
          if (!jsonString) {
            setState((prev) => ({
              ...prev,
              rawResponse: text,
              validation: {
                isValid: false,
                errors: [{ message: 'Assistant response did not contain a JSON object.', path: [] }],
                warnings: [],
                guide: null,
              },
            }));
            return;
          }
          const validation = parseAndValidateGuide(jsonString);
          setState((prev) => ({
            ...prev,
            rawResponse: jsonString,
            validation,
          }));
        },
        onError: (err) => {
          setState((prev) => ({
            ...prev,
            rawResponse: null,
            validation: {
              isValid: false,
              errors: [{ message: err.message || 'Assistant request failed.', path: [] }],
              warnings: [],
              guide: null,
            },
          }));
        },
      });
    },
    [assistant, previousErrors, state.prompt]
  );

  const handleUseGenerated = useCallback(() => {
    if (!state.validation?.guide) {
      return;
    }
    if (hasUnsavedChanges && !state.confirmingReplace) {
      setState((prev) => ({ ...prev, confirmingReplace: true }));
      return;
    }
    onGenerated(state.validation.guide);
    resetState();
  }, [hasUnsavedChanges, onGenerated, resetState, state.confirmingReplace, state.validation]);

  const validation = state.validation;
  const canGenerate = state.prompt.trim().length > 0 && isAssistantAvailable && !assistant.isGenerating;

  return (
    <Modal title="Generate guide with AI" isOpen={isOpen} onDismiss={handleClose}>
      <div className={styles.container} data-testid={testIds.blockEditor.generateGuideModal}>
        {!isAssistantAvailable && (
          <Alert title="Assistant unavailable" severity="info">
            Grafana Assistant is not enabled in this environment. Enable the assistant app or toggle dev mode to try
            this feature locally.
          </Alert>
        )}

        <p className={styles.description}>
          Describe the guide you want to create. The assistant will draft a JSON guide you can refine. Unknown selectors
          will be left as placeholders so you can pick them afterwards.
        </p>

        <TextArea
          value={state.prompt}
          onChange={(e) => {
            const value = (e.target as HTMLTextAreaElement).value;
            setState((prev) => ({ ...prev, prompt: value }));
          }}
          placeholder="e.g. Walk a new user through creating a Prometheus data source and viewing CPU metrics in Explore."
          className={styles.promptArea}
          rows={6}
          disabled={assistant.isGenerating}
          data-testid={testIds.blockEditor.generateGuidePromptInput}
        />

        {assistant.isGenerating && (
          <div className={styles.hint} role="status" aria-live="polite">
            Generating guide... this usually takes a few seconds.
          </div>
        )}

        {validation?.isValid && validation.guide && (
          <>
            <Alert title="Guide generated" severity="success">
              {validation.guide.title} — {validation.guide.blocks.length} block
              {validation.guide.blocks.length === 1 ? '' : 's'}. Review the JSON below, then replace your current guide.
            </Alert>
            {validation.warnings.length > 0 && (
              <Alert title="Warnings" severity="warning">
                <ul className={styles.errorList}>
                  {validation.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </Alert>
            )}
          </>
        )}

        {validation && !validation.isValid && (
          <Alert title="The generated guide did not validate" severity="error">
            <ul className={styles.errorList}>
              {validation.errors.slice(0, 10).map((error, index) => (
                <li key={index}>{error.line ? `Line ${error.line}: ${error.message}` : error.message}</li>
              ))}
            </ul>
          </Alert>
        )}

        {state.rawResponse && (
          <details>
            <summary className={styles.hint}>Show raw assistant response</summary>
            <pre className={styles.preview}>{state.rawResponse}</pre>
          </details>
        )}

        {state.confirmingReplace && (
          <Alert title="Replace current guide?" severity="warning">
            You have unsaved changes. Using the generated guide will replace your current work. Click &quot;Replace
            guide&quot; again to confirm.
          </Alert>
        )}

        <div className={styles.footer}>
          <div className={styles.spacer} />
          <Button variant="secondary" onClick={handleClose} data-testid={testIds.blockEditor.generateGuideCancel}>
            Cancel
          </Button>
          {validation && !validation.isValid && (
            <Button
              variant="secondary"
              onClick={() => handleGenerate(true)}
              disabled={!canGenerate}
              data-testid={testIds.blockEditor.generateGuideRetry}
            >
              Retry with errors
            </Button>
          )}
          {validation?.isValid ? (
            <Button variant="primary" onClick={handleUseGenerated}>
              {state.confirmingReplace ? 'Replace guide' : 'Use generated guide'}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => handleGenerate(false)}
              disabled={!canGenerate}
              data-testid={testIds.blockEditor.generateGuideSubmit}
            >
              {assistant.isGenerating ? 'Generating...' : 'Generate'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

GenerateGuideModal.displayName = 'GenerateGuideModal';
