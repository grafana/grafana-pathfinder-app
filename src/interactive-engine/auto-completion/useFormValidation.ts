/**
 * Form Validation Hook
 *
 * Provides debounced form validation with support for regex patterns.
 * Used by interactive steps to validate form input with visual feedback.
 *
 * @module useFormValidation
 */

import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { matchFormValue, isRegexPattern, type FormfillMatchResult } from './action-matcher';

/** Validation state for form input */
export type FormValidationState = 'idle' | 'checking' | 'valid' | 'invalid';

/** Result of form validation */
export interface FormValidationResult {
  /** Current validation state */
  state: FormValidationState;
  /** Whether validation is currently in progress (checking state) */
  isChecking: boolean;
  /** Whether the form value is valid */
  isValid: boolean;
  /** Whether the form value is invalid (checked and failed) */
  isInvalid: boolean;
  /** Whether regex was used for validation */
  usedRegex: boolean;
  /** The expected pattern (for display when invalid) */
  expectedPattern: string;
  /** The form hint to display when invalid */
  hint: string | undefined;
  /** Manually trigger validation (bypasses debounce) */
  validateNow: () => void;
  /** Reset validation state to idle */
  reset: () => void;
}

/** Options for the useFormValidation hook */
export interface UseFormValidationOptions {
  /** The current form value to validate */
  value: string | undefined;
  /** The expected value (may be regex pattern) */
  expectedValue: string | undefined;
  /** Custom hint to show when validation fails */
  formHint?: string;
  /** Whether validation is enabled */
  enabled?: boolean;
  /** Debounce delay in milliseconds (default: 2000) */
  debounceMs?: number;
  /** Callback when validation completes successfully */
  onValid?: () => void;
  /** Callback when validation fails */
  onInvalid?: (hint: string | undefined) => void;
}

/** Default debounce delay for form validation (2 seconds) */
const DEFAULT_DEBOUNCE_MS = 2000;

/**
 * Hook for debounced form validation with regex support.
 *
 * Watches form value changes and validates against expected value after debounce.
 * Supports both exact string matching and regex patterns.
 *
 * @example
 * ```tsx
 * const validation = useFormValidation({
 *   value: inputValue,
 *   expectedValue: '^https://',
 *   formHint: 'URL must start with https://',
 *   enabled: true,
 *   onValid: () => markStepComplete(),
 * });
 *
 * // In render:
 * {validation.isChecking && <span>Checking...</span>}
 * {validation.isInvalid && <Warning>{validation.hint}</Warning>}
 * ```
 */
export function useFormValidation(options: UseFormValidationOptions): FormValidationResult {
  const {
    value,
    expectedValue,
    formHint,
    enabled = true,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    onValid,
    onInvalid,
  } = options;

  // Validation state
  const [state, setState] = useState<FormValidationState>('idle');
  const [matchResult, setMatchResult] = useState<FormfillMatchResult | null>(null);

  // Refs to track latest values without re-triggering effects
  const valueRef = useRef(value);
  const onValidRef = useRef(onValid);
  const onInvalidRef = useRef(onInvalid);

  // Update refs in useLayoutEffect to comply with React rules (refs shouldn't be updated during render)
  useLayoutEffect(() => {
    valueRef.current = value;
  }, [value]);

  useLayoutEffect(() => {
    onValidRef.current = onValid;
    onInvalidRef.current = onInvalid;
  }, [onValid, onInvalid]);

  // Debounce timer ref
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Perform validation
  const performValidation = useCallback(
    (valueToValidate: string | undefined) => {
      if (!enabled || expectedValue === undefined || expectedValue === '') {
        setState('idle');
        setMatchResult(null);
        return;
      }

      const result = matchFormValue(valueToValidate, expectedValue);
      setMatchResult(result);

      if (result.isMatch) {
        setState('valid');
        onValidRef.current?.();
      } else {
        setState('invalid');
        onInvalidRef.current?.(formHint);
      }
    },
    [enabled, expectedValue, formHint]
  );

  // Reset validation state
  const reset = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setState('idle');
    setMatchResult(null);
  }, []);

  // Manually trigger validation (bypasses debounce)
  const validateNow = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    performValidation(valueRef.current);
  }, [performValidation]);

  // Watch value changes and debounce validation
  /* eslint-disable react-hooks/set-state-in-effect -- Intentional: update validation state when dependencies change */
  useEffect(() => {
    // Skip if disabled or no expected value
    if (!enabled || expectedValue === undefined || expectedValue === '') {
      reset();
      return;
    }

    // Skip if value is empty - wait for user to start typing
    if (value === undefined || value === '') {
      setState('idle');
      return;
    }

    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Enter checking state
    setState('checking');

    // Set debounce timer
    debounceTimerRef.current = setTimeout(() => {
      performValidation(value);
    }, debounceMs);

    // REACT: cleanup timer on unmount or value change (R1)
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [value, expectedValue, enabled, debounceMs, performValidation, reset]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Compute hint to display
  const displayHint =
    state === 'invalid' ? formHint || `Expected: ${matchResult?.expectedPattern || expectedValue}` : undefined;

  return {
    state,
    isChecking: state === 'checking',
    isValid: state === 'valid',
    isInvalid: state === 'invalid',
    usedRegex: matchResult?.usedRegex ?? isRegexPattern(expectedValue || ''),
    expectedPattern: matchResult?.expectedPattern || expectedValue || '',
    hint: displayHint,
    validateNow,
    reset,
  };
}

/**
 * Hook for monitoring a DOM form element's value changes.
 *
 * Use this when you need to watch an external form element (not controlled by React).
 *
 * @param element - The form element to monitor
 * @param options - Validation options (excludes value - automatically extracted)
 * @returns Form validation result
 */
export function useFormElementValidation(
  element: HTMLElement | null,
  options: Omit<UseFormValidationOptions, 'value'>
): FormValidationResult {
  // Track element value via ref to avoid sync state updates
  const elementValueRef = useRef<string | undefined>(undefined);

  // Helper to get element value
  const getElementValue = useCallback((el: HTMLElement | null): string | undefined => {
    if (!el) {
      return undefined;
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return el.value;
    }
    if (el instanceof HTMLSelectElement) {
      return el.value;
    }
    return el.textContent || '';
  }, []);

  // Initialize value state with lazy initializer
  const [value, setValue] = useState<string | undefined>(() => getElementValue(element));

  // Track previous element to detect changes
  const prevElementRef = useRef(element);

  // Sync value when element changes - use useLayoutEffect to run before paint
  /* eslint-disable react-hooks/set-state-in-effect -- Intentional: sync React state when external element prop changes */
  useLayoutEffect(() => {
    if (element !== prevElementRef.current) {
      prevElementRef.current = element;
      const newValue = getElementValue(element);
      elementValueRef.current = newValue;
      setValue(newValue);
    }
  }, [element, getElementValue]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Watch element value changes via event listeners
  useEffect(() => {
    if (!element) {
      return;
    }

    // Initialize ref with current value
    elementValueRef.current = getElementValue(element);

    // Listen for input events - only update state from events, not synchronously
    const handleInput = () => {
      const newValue = getElementValue(element);
      if (newValue !== elementValueRef.current) {
        elementValueRef.current = newValue;
        setValue(newValue);
      }
    };

    element.addEventListener('input', handleInput);
    element.addEventListener('change', handleInput);

    // REACT: cleanup event listeners (R1)
    return () => {
      element.removeEventListener('input', handleInput);
      element.removeEventListener('change', handleInput);
    };
  }, [element, getElementValue]);

  return useFormValidation({ ...options, value });
}
