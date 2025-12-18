/**
 * Input Block Renderer
 *
 * Renders input blocks that collect user responses for use as variables.
 * Supports text input and boolean (checkbox) types with validation.
 */

import React, { useState, useCallback, useMemo, useEffect, ReactNode } from 'react';
import { css } from '@emotion/css';
import { Button, Input, Checkbox, Field, useStyles2, Alert, Icon } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { useGuideResponsesOptional } from '../../../lib/GuideResponseContext';

/** Props for the InputBlock component */
export interface InputBlockProps {
  /** The prompt text (markdown supported) */
  prompt: string;
  /** Input type: text or boolean */
  inputType: 'text' | 'boolean';
  /** Variable name for storing the response */
  variableName: string;
  /** Placeholder for text input */
  placeholder?: string;
  /** Label for checkbox input */
  checkboxLabel?: string;
  /** Default value */
  defaultValue?: string | boolean;
  /** Whether input is required */
  required?: boolean;
  /** Regex pattern for text validation */
  pattern?: string;
  /** Message shown when validation fails */
  validationMessage?: string;
  /** Requirements for this input */
  requirements?: string;
  /** Whether input can be skipped */
  skippable?: boolean;
  /** Children elements (rendered prompt content) */
  children?: ReactNode;
}

/** Get styles for the input block */
const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    padding: theme.spacing(2),
    marginBottom: theme.spacing(2),
    border: `1px solid ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.secondary,
  }),
  promptContainer: css({
    marginBottom: theme.spacing(2),
    '& p': {
      marginBottom: theme.spacing(1),
    },
  }),
  inputContainer: css({
    marginBottom: theme.spacing(2),
  }),
  buttonContainer: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
    justifyContent: 'flex-end',
  }),
  savedIndicator: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: theme.colors.success.text,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  checkboxContainer: css({
    marginBottom: theme.spacing(2),
    '& label': {
      cursor: 'pointer',
    },
  }),
});

/**
 * Input Block component for collecting user responses.
 */
export function InputBlock({
  prompt,
  inputType,
  variableName,
  placeholder,
  checkboxLabel,
  defaultValue,
  required = false,
  pattern,
  validationMessage,
  skippable = false,
  children,
}: InputBlockProps) {
  const styles = useStyles2(getStyles);
  const responseContext = useGuideResponsesOptional();

  // Local state for the input value
  const [textValue, setTextValue] = useState<string>(() => {
    // Try to get existing response first
    const existing = responseContext?.getResponse(variableName);
    if (existing !== undefined && typeof existing === 'string') {
      return existing;
    }
    // Fall back to default value
    return typeof defaultValue === 'string' ? defaultValue : '';
  });

  const [boolValue, setBoolValue] = useState<boolean>(() => {
    // Try to get existing response first
    const existing = responseContext?.getResponse(variableName);
    if (existing !== undefined && typeof existing === 'boolean') {
      return existing;
    }
    // Fall back to default value
    return typeof defaultValue === 'boolean' ? defaultValue : false;
  });

  const [isSaved, setIsSaved] = useState(() => {
    return responseContext?.hasResponse(variableName) ?? false;
  });

  const [validationError, setValidationError] = useState<string | null>(null);

  // Compile pattern regex if provided
  const patternRegex = useMemo(() => {
    if (!pattern) {
      return null;
    }
    try {
      return new RegExp(pattern);
    } catch {
      console.warn(`[InputBlock] Invalid pattern regex: ${pattern}`);
      return null;
    }
  }, [pattern]);

  // Validate text input
  const validateTextInput = useCallback(
    (value: string): boolean => {
      if (required && !value.trim()) {
        setValidationError('This field is required');
        return false;
      }
      if (patternRegex && value.trim() && !patternRegex.test(value)) {
        setValidationError(validationMessage || 'Invalid format');
        return false;
      }
      setValidationError(null);
      return true;
    },
    [required, patternRegex, validationMessage]
  );

  // Handle text input change
  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTextValue(e.target.value);
    setIsSaved(false);
    setValidationError(null);
  }, []);

  // Handle checkbox change - just update local state, save on button click
  const handleBoolChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.checked;
    setBoolValue(newValue);
    setIsSaved(false); // Mark as unsaved when changed
  }, []);

  // Handle reset/clear
  const handleReset = useCallback(() => {
    if (responseContext) {
      responseContext.deleteResponse(variableName);
    }
    // Reset to defaults
    if (inputType === 'text') {
      setTextValue(typeof defaultValue === 'string' ? defaultValue : '');
    } else {
      setBoolValue(typeof defaultValue === 'boolean' ? defaultValue : false);
    }
    setIsSaved(false);
    setValidationError(null);
  }, [responseContext, variableName, inputType, defaultValue]);

  // Handle save
  const handleSave = useCallback(() => {
    if (inputType === 'text') {
      if (!validateTextInput(textValue)) {
        return;
      }
      if (responseContext) {
        responseContext.setResponse(variableName, textValue.trim());
        setIsSaved(true);
      }
    } else {
      if (responseContext) {
        responseContext.setResponse(variableName, boolValue);
        setIsSaved(true);
      }
    }
  }, [inputType, textValue, boolValue, validateTextInput, responseContext, variableName]);

  // Handle skip
  const handleSkip = useCallback(() => {
    setIsSaved(true);
  }, []);

  // Sync with external changes to the response (e.g., reset from another component)
  // Uses event subscription pattern to avoid lint warning about setState in effects
  useEffect(() => {
    const handleResponseChange = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      // Only react to changes for this variable or wildcard (clear all)
      if (detail.variableName !== variableName && detail.variableName !== '*') {
        return;
      }

      const savedValue = responseContext?.getResponse(variableName);
      if (savedValue === undefined) {
        // Response was cleared - reset to defaults
        if (inputType === 'text') {
          setTextValue(typeof defaultValue === 'string' ? defaultValue : '');
        } else {
          setBoolValue(typeof defaultValue === 'boolean' ? defaultValue : false);
        }
        setIsSaved(false);
      } else if (inputType === 'text' && typeof savedValue === 'string') {
        setTextValue(savedValue);
        setIsSaved(true);
      } else if (inputType === 'boolean' && typeof savedValue === 'boolean') {
        setBoolValue(savedValue);
        setIsSaved(true);
      }
    };

    window.addEventListener('guide-response-changed', handleResponseChange);
    return () => window.removeEventListener('guide-response-changed', handleResponseChange);
  }, [responseContext, variableName, inputType, defaultValue]);

  // If no context provider, show error
  if (!responseContext) {
    return (
      <Alert title="Configuration error" severity="warning">
        Input blocks require a GuideResponseProvider. This input will not be able to store responses.
      </Alert>
    );
  }

  return (
    <div className={styles.container}>
      {/* Prompt/Question */}
      <div className={styles.promptContainer}>{children}</div>

      {/* Input field based on type */}
      {inputType === 'text' ? (
        <div className={styles.inputContainer}>
          <Field label="" invalid={!!validationError} error={validationError}>
            <Input value={textValue} onChange={handleTextChange} placeholder={placeholder} />
          </Field>
        </div>
      ) : (
        <div className={styles.checkboxContainer}>
          <Checkbox label={checkboxLabel || 'Yes'} checked={boolValue} onChange={handleBoolChange} />
        </div>
      )}

      {/* Actions - same for both input types */}
      <div className={styles.buttonContainer}>
        {skippable && !required && !isSaved && (
          <Button variant="secondary" size="sm" onClick={handleSkip}>
            Skip
          </Button>
        )}

        {isSaved && (
          <span className={styles.savedIndicator}>
            <Icon name="check" />
            Saved
          </span>
        )}

        {isSaved && (
          <Button variant="secondary" size="sm" onClick={handleReset}>
            Reset
          </Button>
        )}

        <Button variant="primary" size="sm" onClick={handleSave}>
          {isSaved ? 'Update' : 'Save'}
        </Button>
      </div>
    </div>
  );
}

// Add display name for debugging
InputBlock.displayName = 'InputBlock';
