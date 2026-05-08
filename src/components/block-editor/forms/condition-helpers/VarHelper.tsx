/**
 * `VarHelper` — argument input for `var-NAME:VALUE` requirements.
 *
 * The `var-` prefix is unique because the *full* argument is `NAME:VALUE`
 * — there's a colon embedded in the argument itself. A single text box
 * makes that easy to typo, so this helper splits it into separate
 * "Variable name" and "Expected value" inputs and joins them with `:`.
 */

import React, { useEffect, useMemo } from 'react';
import { Field, Input, Stack } from '@grafana/ui';
import type { ConditionHelperProps } from './types';

function splitArg(arg: string): { name: string; value: string } {
  const colonIdx = arg.indexOf(':');
  if (colonIdx < 0) {
    return { name: arg, value: '' };
  }
  return { name: arg.slice(0, colonIdx), value: arg.slice(colonIdx + 1) };
}

export function VarHelper({ value, onChange, onSubmit, onValidityChange, testId }: ConditionHelperProps) {
  const { name, value: argValue } = useMemo(() => splitArg(value), [value]);
  const isValid = name.trim().length > 0 && argValue.trim().length > 0;

  useEffect(() => {
    onValidityChange?.(isValid);
  }, [isValid, onValidityChange]);

  const handleNameChange = (next: string) => {
    onChange(`${next}:${argValue}`);
  };
  const handleValueChange = (next: string) => {
    onChange(`${name}:${next}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && isValid) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <Stack direction="column" gap={1}>
      <Field label="Variable name" description="The variable defined by an earlier input or quiz block">
        <Input
          value={name}
          onChange={(e) => handleNameChange(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder="e.g., policyAccepted"
          autoFocus
          data-testid={testId ? `${testId}-name` : undefined}
        />
      </Field>
      <Field label="Expected value" description="The value the variable must equal for this condition to pass">
        <Input
          value={argValue}
          onChange={(e) => handleValueChange(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder="e.g., true"
          data-testid={testId ? `${testId}-value` : undefined}
        />
      </Field>
    </Stack>
  );
}
