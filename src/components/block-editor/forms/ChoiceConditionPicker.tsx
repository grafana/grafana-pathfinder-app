import React, { useEffect } from 'react';
import { Combobox, Field } from '@grafana/ui';
import { useChoiceInputs } from './ChoiceInputsContext';
import type { ConditionHelperProps } from './condition-helpers/types';

export function ChoiceConditionPicker({ value, onChange, onValidityChange, testId }: ConditionHelperProps) {
  const inputs = useChoiceInputs();
  const [variableName = '', optionId = ''] = value.split(':includes:');
  const input = inputs.find((item) => item.variableName === variableName);
  const isValid = Boolean(input?.choices?.some((choice) => choice.id === optionId));

  useEffect(() => {
    onValidityChange?.(isValid);
  }, [isValid, onValidityChange]);

  return (
    <div role="group" aria-label="Checkbox option selected">
      <Field label="Question" description="The checkbox group that defines the option">
        <Combobox
          options={inputs.map((item) => ({ value: item.variableName, label: item.prompt }))}
          value={variableName}
          onChange={(option) => onChange(`${option?.value ?? ''}:includes:`)}
          placeholder="Select a question"
          data-testid={testId ? `${testId}-question` : undefined}
        />
      </Field>
      {input && (
        <Field label="Includes option">
          <Combobox
            options={input.choices?.map((choice) => ({ value: choice.id, label: choice.text })) ?? []}
            value={optionId}
            onChange={(option) => onChange(`${variableName}:includes:${option?.value ?? ''}`)}
            placeholder="Select an option"
            data-testid={testId ? `${testId}-option` : undefined}
          />
        </Field>
      )}
    </div>
  );
}
