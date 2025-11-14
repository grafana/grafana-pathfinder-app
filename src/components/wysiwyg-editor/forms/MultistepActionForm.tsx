import React, { useState, useCallback } from 'react';
import { Field, Input, Button, Stack, Badge, Icon, Card, HorizontalGroup, Alert, useStyles2 } from '@grafana/ui';
import { type InteractiveFormProps } from '../types';
import { DATA_ATTRIBUTES, DEFAULT_VALUES } from '../../../constants/interactive-config';
import { useActionRecorder } from '../../../utils/devtools/action-recorder.hook';
import { getActionConfig } from './actionConfig';
import { ACTION_TYPES } from '../../../constants/interactive-config';
import { InteractiveFormShell, CommonRequirementsButtons } from './InteractiveFormShell';
import { getMultistepFormStyles } from '../editor.styles';

/**
 * Custom form component for multistep actions with integrated recorder
 * Replaces the generic BaseInteractiveForm wrapper with a purpose-built UI
 */
const MultistepActionForm = ({ onApply, onCancel, initialValues, onSwitchType }: InteractiveFormProps) => {
  const styles = useStyles2(getMultistepFormStyles);
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
          <h5 className={styles.cardTitle}>Record Actions</h5>
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
                  <Icon name="info-circle" size="sm" className={styles.alertIcon} />
                  Click elements and fill forms to record a sequence
                </Alert>
              )}

              {isEditMode && recordedSteps.length === 0 && (
                <div className={styles.emptyState}>
                  Editing existing multistep. Record new actions to replace existing internal spans.
                </div>
              )}

              {recordedSteps.length > 0 ? (
                <>
                  <label className={styles.stepsLabel}>Recorded Steps</label>
                  <div className={styles.stepsContainer}>
                    {recordedSteps.map((step, index) => (
                      <div key={index} className={styles.stepItem}>
                        <Badge
                          text={String(index + 1)}
                          color="blue"
                          className={styles.stepBadge}
                        />
                        <div className={styles.stepContent}>
                          <div className={styles.stepDescription}>
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
                            <HorizontalGroup spacing="xs" wrap className={styles.stepBadges}>
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

                  <HorizontalGroup spacing="sm" className={styles.clearButtonContainer}>
                    <Button variant="secondary" size="sm" onClick={handleClearRecording}>
                      <Icon name="trash-alt" />
                      Clear All
                    </Button>
                  </HorizontalGroup>
                </>
              ) : (
                <div className={styles.emptyState}>
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
            <div className={styles.requirementsButtonContainer}>
              <CommonRequirementsButtons onSelect={setRequirements} />
            </div>
          </>
        </Field>
      </Stack>
    </InteractiveFormShell>
  );
};

export default MultistepActionForm;
