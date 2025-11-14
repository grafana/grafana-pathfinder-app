import React, { useState, useCallback } from 'react';
import { Field, Input, Button, Stack, Badge, Icon, Card, HorizontalGroup, Alert, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { type InteractiveFormProps } from '../types';
import { DATA_ATTRIBUTES, DEFAULT_VALUES } from '../../../constants/interactive-config';
import { useActionRecorder } from '../../../utils/devtools/action-recorder.hook';
import { getActionConfig } from './actionConfig';
import { ACTION_TYPES } from '../../../constants/interactive-config';
import { InteractiveFormShell, CommonRequirementsButtons } from './InteractiveFormShell';

// Only custom animations that Grafana UI cannot express
const getStyles = (theme: GrafanaTheme2) => ({
  recordModeActive: css({
    animation: 'pulse 2s ease-in-out infinite',
    '@keyframes pulse': {
      '0%, 100%': { opacity: 1 },
      '50%': { opacity: 0.8 },
    },
  }),
  recordingDot: css({
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: theme.colors.error.main,
    display: 'inline-block',
    marginRight: theme.spacing(0.5),
    animation: 'blink 1.5s ease-in-out infinite',
    '@keyframes blink': {
      '0%, 100%': { opacity: 1 },
      '50%': { opacity: 0.3 },
    },
  }),
  stepCode: css({
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: '11px',
    color: theme.colors.text.secondary,
    backgroundColor: theme.colors.background.secondary,
    padding: `${theme.spacing(0.25)} ${theme.spacing(0.5)}`,
    borderRadius: theme.shape.radius.default,
    display: 'block',
    wordBreak: 'break-all',
    overflowWrap: 'break-word',
  }),
});

/**
 * Custom form component for multistep actions with integrated recorder
 * Replaces the generic BaseInteractiveForm wrapper with a purpose-built UI
 */
const MultistepActionForm = ({ onApply, onCancel, initialValues, onSwitchType }: InteractiveFormProps) => {
  const styles = useStyles2(getStyles);
  const config = getActionConfig(ACTION_TYPES.MULTISTEP);
  
  if (!config) {
    throw new Error(`Action config not found for ${ACTION_TYPES.MULTISTEP}`);
  }

  // Requirements state
  const [requirements, setRequirements] = useState<string>(
    (initialValues?.[DATA_ATTRIBUTES.REQUIREMENTS] as string) || DEFAULT_VALUES.REQUIREMENT || ''
  );

  // Action recorder hook - exclude the form panel itself
  const {
    isRecording: recordMode,
    recordedSteps,
    startRecording,
    stopRecording,
    clearRecording,
    deleteStep,
  } = useActionRecorder({
    excludeSelectors: ['[data-pathfinder-content]', '[data-wysiwyg-form]'],
  });

  const handleRecordModeToggle = useCallback(() => {
    if (recordMode) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [recordMode, startRecording, stopRecording]);

  const handleClearRecording = useCallback(() => {
    clearRecording();
  }, [clearRecording]);

  const handleDeleteStep = useCallback(
    (index: number) => {
      deleteStep(index);
    },
    [deleteStep]
  );

  // Check if we're in edit mode (has initialValues)
  const isEditMode = !!initialValues;

  const isValid = () => {
    // In edit mode, allow applying without recorded steps (preserving existing structure)
    // In create mode, require at least one recorded step
    if (isEditMode) {
      return true;
    }
    return recordedSteps.length > 0;
  };

  const handleApply = () => {
    if (!isValid()) {
      return;
    }

    // Build attributes with recorded steps attached as internal property (only if we have steps)
    const attributes: any = {
      [DATA_ATTRIBUTES.TARGET_ACTION]: ACTION_TYPES.MULTISTEP,
      [DATA_ATTRIBUTES.REQUIREMENTS]: requirements || undefined,
      class: DEFAULT_VALUES.CLASS,
    };

    // Only include internal actions if we have recorded steps (create mode with recording)
    // In edit mode without new recordings, we preserve the existing structure
    if (recordedSteps.length > 0) {
      attributes.__internalActions = recordedSteps.map((step) => ({
        targetAction: step.action,
        refTarget: step.selector,
        targetValue: step.value,
        requirements: undefined, // Requirements are typically on child spans
      }));
    }

    onApply(attributes);
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
      <Stack direction="column" gap={2}>
        {/* Recorder section */}
        <Card>
          <h5 style={{ margin: 0, marginBottom: '12px', fontSize: '16px', fontWeight: 500 }}>
            Record Actions
          </h5>
          <Stack direction="column" gap={2}>
              <HorizontalGroup justify="space-between" align="center" wrap>
                <Button
                  variant={recordMode ? 'destructive' : 'primary'}
                  size="md"
                  onClick={handleRecordModeToggle}
                  className={recordMode ? styles.recordModeActive : ''}
                >
                  {recordMode && <span className={styles.recordingDot} />}
                  <Icon name={recordMode ? 'pause' : 'circle'} />
                  {recordMode ? 'Stop Recording' : 'Start Recording'}
                </Button>
                {recordedSteps.length > 0 && <Badge text={`${recordedSteps.length} steps`} color="blue" />}
              </HorizontalGroup>

              {recordMode && (
                <Alert severity="error" title="">
                  <Icon name="info-circle" size="sm" style={{ marginRight: '8px' }} />
                  Click elements and fill forms to record a sequence
                </Alert>
              )}

              {isEditMode && recordedSteps.length === 0 && (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--grafana-colors-text-secondary)', fontSize: '12px', fontStyle: 'italic' }}>
                  Editing existing multistep. Record new actions to replace existing internal spans.
                </div>
              )}

              {recordedSteps.length > 0 ? (
                <>
                  <label style={{ fontSize: '12px', fontWeight: 500, color: 'var(--grafana-colors-text-secondary)', marginBottom: '4px', display: 'block' }}>
                    Recorded Steps
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto', padding: '8px', backgroundColor: 'var(--grafana-colors-background-primary)', borderRadius: '4px', border: '1px solid var(--grafana-colors-border-weak)' }}>
                    {recordedSteps.map((step, index) => (
                      <div key={index} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px', backgroundColor: 'var(--grafana-colors-background-secondary)', borderRadius: '4px', border: '1px solid var(--grafana-colors-border-weak)' }}>
                        <Badge
                          text={String(index + 1)}
                          color="blue"
                          style={{ flexShrink: 0, width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                        />
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' }}>
                          <div style={{ fontSize: '12px', color: 'var(--grafana-colors-text-primary)', fontWeight: 500, wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                            {step.description}
                            {step.isUnique === false && (
                              <Icon
                                name="exclamation-triangle"
                                size="sm"
                                style={{ marginLeft: '4px', color: 'var(--grafana-colors-warning-text)', verticalAlign: 'middle' }}
                                title={`Non-unique selector (${step.matchCount} matches)`}
                              />
                            )}
                          </div>
                          <code className={styles.stepCode}>
                            {step.action}|{step.selector}|{step.value || ''}
                          </code>
                          {(step.contextStrategy || step.isUnique === false) && (
                            <HorizontalGroup spacing="xs" wrap style={{ marginTop: '4px' }}>
                              {step.contextStrategy && <Badge text={step.contextStrategy} color="purple" />}
                              {step.isUnique === false && <Badge text={`${step.matchCount} matches`} color="orange" />}
                            </HorizontalGroup>
                          )}
                        </div>
                        <Button
                          variant="secondary"
                          size="xs"
                          onClick={() => handleDeleteStep(index)}
                          icon="trash-alt"
                          aria-label="Delete step"
                        />
                      </div>
                    ))}
                  </div>

                  <HorizontalGroup spacing="sm" style={{ marginTop: '12px' }}>
                    <Button variant="secondary" size="sm" onClick={handleClearRecording}>
                      <Icon name="trash-alt" />
                      Clear All
                    </Button>
                  </HorizontalGroup>
                </>
              ) : (
                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--grafana-colors-text-secondary)', fontSize: '12px', fontStyle: 'italic' }}>
                  {recordMode
                    ? 'Click elements in Grafana to record actions...'
                    : 'Click "Start Recording" to capture a sequence of actions'}
                </div>
              )}
            </Stack>
        </Card>

        {/* Requirements field */}
        <Field
          label="Requirements:"
          description="Requirements are usually set on child interactive spans"
        >
          <>
            <Input
              value={requirements}
              onChange={(e) => setRequirements(e.currentTarget.value)}
              placeholder={`e.g., ${DEFAULT_VALUES.REQUIREMENT} (optional)`}
              autoFocus
            />
            <div style={{ marginTop: '8px' }}>
              <CommonRequirementsButtons onSelect={setRequirements} />
            </div>
          </>
        </Field>
      </Stack>
    </InteractiveFormShell>
  );
};

export default MultistepActionForm;
