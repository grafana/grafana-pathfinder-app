import React, { useState, useEffect } from 'react';
import { Field, Input, Checkbox, Button, Icon, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { type InteractiveFormProps } from '../types';
import { DATA_ATTRIBUTES } from '../../../constants/interactive-config';
import { validateFormField } from '../services/validation';
import { useSelectorCapture } from '../devtools/selector-capture.hook';
import { InteractiveFormShell, CommonRequirementsButtons } from './InteractiveFormShell';

const getSelectorCaptureStyles = (theme: GrafanaTheme2) => ({
  selectorRow: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'flex-start',
  }),
  captureButton: css({
    flexShrink: 0,
    minWidth: '40px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(0.5),
  }),
  captureButtonActive: css({
    animation: 'pulse-capture 1.5s ease-in-out infinite',
    '@keyframes pulse-capture': {
      '0%, 100%': { boxShadow: `0 0 0 0 ${theme.colors.primary.main}40` },
      '50%': { boxShadow: `0 0 0 4px ${theme.colors.primary.main}20` },
    },
  }),
  inputWrapper: css({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
  }),
  captureIndicator: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.primary.text,
    marginTop: theme.spacing(0.5),
  }),
  pulsingDot: css({
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: theme.colors.primary.main,
    animation: 'pulse-dot 1s ease-in-out infinite',
    '@keyframes pulse-dot': {
      '0%, 100%': { opacity: 1 },
      '50%': { opacity: 0.4 },
    },
  }),
});

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
  disableSelectorCapture?: boolean;
  selectorCaptureDisabledTooltip?: string;
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

/**
 * Base form component for all interactive action types
 * Eliminates duplication across form components by providing a common structure
 */
const BaseInteractiveForm = ({ config, onApply, onCancel, initialValues, onSwitchType }: BaseInteractiveFormProps) => {
  const captureStyles = useStyles2(getSelectorCaptureStyles);

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

  // Find selector field to determine if we should auto-start capture
  const selectorField = config.fields.find((field) => field.id === DATA_ATTRIBUTES.REF_TARGET);
  const shouldAutoStartCapture = selectorField !== undefined && selectorField.disableSelectorCapture !== true;

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

  // Auto-start selector capture when form mounts (if selector field exists and isn't disabled)
  useEffect(() => {
    if (shouldAutoStartCapture) {
      startCapture();
    }
    // Cleanup: stop capture when component unmounts
    return () => {
      if (shouldAutoStartCapture) {
        stopCapture();
      }
    };
  }, [shouldAutoStartCapture, startCapture, stopCapture]);

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
    const isSelectorCaptureDisabled = field.disableSelectorCapture === true;

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
          {isSelectorField && (
            <div className={captureStyles.selectorRow}>
              <Button
                variant={isActive ? 'primary' : 'secondary'}
                onClick={() => {
                  if (!isSelectorCaptureDisabled) {
                    if (isActive) {
                      stopCapture();
                    } else {
                      startCapture();
                    }
                  }
                }}
                disabled={isSelectorCaptureDisabled}
                tooltip={
                  isSelectorCaptureDisabled
                    ? field.selectorCaptureDisabledTooltip || 'This field expects button text, not a DOM selector'
                    : isActive
                      ? 'Click an element to capture its selector'
                      : 'Capture selector from page'
                }
                className={`${captureStyles.captureButton} ${isActive ? captureStyles.captureButtonActive : ''}`}
                aria-label="Capture selector"
              >
                <Icon name="crosshair" />
              </Button>
              <div className={captureStyles.inputWrapper}>
                <Input
                  value={values[field.id] || ''}
                  onChange={(e) => handleChange(field.id, e.currentTarget.value)}
                  placeholder={field.placeholder}
                  autoFocus={field.autoFocus}
                />
                {isActive && (
                  <div className={captureStyles.captureIndicator}>
                    <span className={captureStyles.pulsingDot} />
                    <span>Capture mode active - click any element</span>
                  </div>
                )}
              </div>
            </div>
          )}
          {!isSelectorField && (
            <Input
              value={values[field.id] || ''}
              onChange={(e) => handleChange(field.id, e.currentTarget.value)}
              placeholder={field.placeholder}
              autoFocus={field.autoFocus}
            />
          )}
          {field.showCommonOptions && (
            <div style={{ marginTop: '8px' }}>
              <CommonRequirementsButtons onSelect={(req) => handleChange(field.id, req)} />
            </div>
          )}
        </>
      </Field>
    );
  };

  return (
    <InteractiveFormShell
      title={config.title}
      description={config.description}
      infoBox={config.infoBox}
      onCancel={onCancel}
      onSwitchType={onSwitchType}
      initialValues={initialValues}
      isValid={isValid()}
      onApply={handleApply}
    >
      {config.fields.map(renderField)}
    </InteractiveFormShell>
  );
};

export default BaseInteractiveForm;
