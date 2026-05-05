/**
 * `MinVersionHelper` — argument input for `min-version:` requirements.
 *
 * Just a plain text input, but we run the canonical semver regex on
 * blur and propagate validity so the "Add" button stays disabled until
 * the value is well-formed.
 */

import React, { useEffect } from 'react';
import { Input } from '@grafana/ui';
import { SEMVER_PATTERN } from '../../../../validation/condition-validator';
import type { ConditionHelperProps } from './types';

export function MinVersionHelper({ value, onChange, onSubmit, onValidityChange, testId }: ConditionHelperProps) {
  const isValid = SEMVER_PATTERN.test(value.trim());

  useEffect(() => {
    onValidityChange?.(isValid);
  }, [isValid, onValidityChange]);

  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onSubmit();
        }
      }}
      placeholder="11.0.0"
      autoFocus
      invalid={value.length > 0 && !isValid}
      data-testid={testId}
    />
  );
}
