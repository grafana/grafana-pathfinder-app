import React, { useState } from 'react';
import { Field, Input, Checkbox, Button, Stack, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { type InteractiveFormProps } from '../types';
import { COMMON_REQUIREMENTS, DATA_ATTRIBUTES } from '../../../constants/interactive-config';
import { validateFormField } from '../services/validation';
import { useSelectorCapture } from '../../../utils/devtools/selector-capture.hook';

export interface FormField {
  id: string;
  label: string;
  type: 'text' | 'checkbox';
  placeholder?: string;
  hint?: string;
  defaultValue?: string | boolean;
  required?: boolean;
  autoFocus?: boolean;
  showCommonOptions?: boolean;
}

export interface BaseInteractiveFormConfig {
  title: string;
  description: string;
  actionType: string;
  fields: FormField[];
  infoBox?: string;
  buildAttributes: (values: Record<string, any>) => any;
}

interface BaseInteractiveFormProps extends InteractiveFormProps {
  config: BaseInteractiveFormConfig;
}

const getStyles = (theme: GrafanaTheme2) => ({
  form: css({
    padding: theme.spacing(2),
  }),
  title: css({
    marginBottom: theme.spacing(1),
  }),
  description: css({
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(2),
  }),
  infoBox: css({
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.secondary,
    borderLeft: `3px solid ${theme.colors.info.border}`,
    marginTop: theme.spacing(2),
    marginBottom: theme.spacing(2),
  }),
  commonOptions: css({
    display: 'flex',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
    flexWrap: 'wrap',
  }),
  actions: css({
    display: 'flex',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
    marginTop: theme.spacing(2),
  }),
  selectorInputContainer: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'flex-start',
  }),
  selectorInput: css({
    flex: 1,
  }),
  captureButton: css({
    flexShrink: 0,
    minWidth: 'auto',
    padding: theme.spacing(0.5, 1),
  }),
});

/**
 * Base form component for all interactive action types
 * Eliminates duplication across form components by providing a common structure
 */
const BaseInteractiveForm = ({ config, onApply, onCancel, initialValues }: BaseInteractiveFormProps) => {
  const styles = useStyles2(getStyles);

  // Initialize state based on field configuration
  const [values, setValues] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {};
    config.fields.forEach((field) => {
      if (initialValues && (initialValues as any)[field.id] !== undefined) {
        initial[field.id] = (initialValues as any)[field.id];
      } else if (field.defaultValue !== undefined) {
        initial[field.id] = field.defaultValue;
      } else {
        initial[field.id] = field.type === 'checkbox' ? false : '';
      }
    });
    return initial;
  });

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const handleChange = (fieldId: string, value: any) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    // Clear validation error for this field when user starts typing
    if (validationErrors[fieldId]) {
      setValidationErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[fieldId];
        return newErrors;
      });
    }
  };

  // Selector capture hook - exclude pathfinder content sidebar and form panel
  const { isActive, startCapture, stopCapture } = useSelectorCapture({
    excludeSelectors: ['[data-pathfinder-content]', '[data-wysiwyg-form]'],
    autoDisable: true,
    onCapture: (selector: string) => {
      // Populate the selector field
      setValues((prev) => ({ ...prev, [DATA_ATTRIBUTES.REF_TARGET]: selector }));
      // Clear validation error if present
      setValidationErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[DATA_ATTRIBUTES.REF_TARGET];
        return newErrors;
      });
    },
  });

  const validateField = (field: FormField, value: any): string | null => {
    // Use centralized validation function from validation service
    return validateFormField(field, value, config.actionType);
  };

  const handleApply = () => {
    // Validate all fields before applying
    const errors: Record<string, string> = {};

    config.fields.forEach((field) => {
      const error = validateField(field, values[field.id]);
      if (error) {
        errors[field.id] = error;
      }
    });

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return; // Don't apply if there are validation errors
    }

    const attributes = config.buildAttributes(values);
    onApply(attributes);
  };

  const isValid = () => {
    return config.fields
      .filter((f) => f.required)
      .every((f) => {
        const value = values[f.id];
        return f.type === 'checkbox' ? true : value && value.trim() !== '';
      });
  };

  const renderField = (field: FormField) => {
    if (field.type === 'checkbox') {
      return (
        <Field key={field.id} label="" description={field.hint}>
          <Checkbox
            label={field.label}
            value={values[field.id] || false}
            onChange={(e) => handleChange(field.id, e.currentTarget.checked)}
          />
        </Field>
      );
    }

    const isSelectorField = field.id === DATA_ATTRIBUTES.REF_TARGET;

    return (
      <Field
        key={field.id}
        label={field.label}
        description={field.hint}
        invalid={!!validationErrors[field.id]}
        error={validationErrors[field.id]}
        required={field.required}
      >
        <>
          <div className={isSelectorField ? styles.selectorInputContainer : undefined}>
            <Input
              className={isSelectorField ? styles.selectorInput : undefined}
              value={values[field.id] || ''}
              onChange={(e) => handleChange(field.id, e.currentTarget.value)}
              placeholder={field.placeholder}
              autoFocus={field.autoFocus}
            />
            {isSelectorField && (
              <Button
                className={styles.captureButton}
                size="sm"
                variant={isActive ? 'primary' : 'secondary'}
                onClick={() => {
                  if (isActive) {
                    stopCapture();
                  } else {
                    startCapture();
                  }
                }}
                title={isActive ? 'Click an element to capture its selector' : 'Capture selector from page'}
              >
                🎯
              </Button>
            )}
          </div>
          {field.showCommonOptions && (
            <div className={styles.commonOptions}>
              {COMMON_REQUIREMENTS.slice(0, 3).map((req) => (
                <Button key={req} size="sm" variant="secondary" onClick={() => handleChange(field.id, req)}>
                  {req}
                </Button>
              ))}
            </div>
          )}
        </>
      </Field>
    );
  };

  return (
    <div className={styles.form} data-wysiwyg-form="true">
      <h4 className={styles.title}>{config.title}</h4>
      <p className={styles.description}>{config.description}</p>

      <Stack direction="column" gap={2}>
        {config.fields.map(renderField)}
      </Stack>

      {config.infoBox && (
        <div className={styles.infoBox}>
          <strong>Note:</strong> {config.infoBox}
        </div>
      )}

      <div className={styles.actions}>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleApply} disabled={!isValid()}>
          Apply
        </Button>
      </div>
    </div>
  );
};

export default BaseInteractiveForm;
