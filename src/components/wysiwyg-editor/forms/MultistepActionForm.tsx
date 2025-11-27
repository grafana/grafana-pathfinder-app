import React, { useState, useCallback } from 'react';
import { Field, Input, Button, Stack, Badge, Icon, HorizontalGroup, useStyles2 } from '@grafana/ui';
import { type InteractiveFormProps } from '../types';
import {
  DATA_ATTRIBUTES,
  ACTION_TYPES,
  COMMON_REQUIREMENTS,
  DEFAULT_VALUES,
} from '../../../constants/interactive-config';
import { useActionRecorder } from '../devtools/action-recorder.hook';
import { getActionConfig } from './actionConfig';
import { InteractiveFormShell } from './InteractiveFormShell';
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
  // NOTE: Multistep containers do NOT support 'exists-reftarget' because they have no data-reftarget.
  // The multistep wrapper is a container for internal actions, not a targetable element itself.
  // Requirements should be set on individual internal action spans, not on the wrapper.
  const [requirements, setRequirements] = useState<string>(
    (initialValues?.[DATA_ATTRIBUTES.REQUIREMENTS] as string) || ''
  );

  // Action recorder hook - exclude the form panel itself
  const {
    recordingState,
    isPaused,
    recordedSteps,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    clearRecording,
    deleteStep,
  } = useActionRecorder({
    excludeSelectors: ['[data-pathfinder-content]', '[data-wysiwyg-form]'],
  });

  const handleStartRecording = useCallback(() => {
    if (isPaused) {
      resumeRecording();
    } else {
      startRecording();
    }
  }, [isPaused, startRecording, resumeRecording]);

  const handlePauseRecording = useCallback(() => {
    pauseRecording();
  }, [pauseRecording]);

  const handleStopRecording = useCallback(() => {
    stopRecording();
  }, [stopRecording]);

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
    // Always stop recording when form is submitted
    if (recordingState !== 'idle') {
      stopRecording();
    }

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
        {/* Prominent recording status banner */}
        {(recordingState === 'recording' || isPaused) && (
          <div className={`${styles.recordingBanner} ${isPaused ? styles.recordingBannerPaused : ''}`}>
            <span className={`${styles.recordingBannerDot} ${isPaused ? styles.recordingBannerDotPaused : ''}`} />
            <span className={styles.recordingBannerText}>
              {isPaused
                ? 'Recording paused - Click "Resume" to continue'
                : 'Recording active - Click elements in Grafana to capture actions'}
            </span>
            <Badge text={`${recordedSteps.length} steps`} color={isPaused ? 'orange' : 'red'} />
          </div>
        )}

        {/* Recorder section */}
        <h5 className={styles.cardTitle}>Record Actions</h5>

        <div className={styles.controlsContainer}>
          <div className={styles.controlsRow}>
            <div className={styles.controlButtons}>
              <Button
                variant={recordingState === 'idle' ? 'primary' : 'secondary'}
                size="sm"
                onClick={handleStartRecording}
                disabled={recordingState === 'recording'}
                icon={isPaused ? 'play' : 'circle'}
              >
                {isPaused ? 'Resume' : 'Start Recording'}
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={handlePauseRecording}
                disabled={recordingState !== 'recording'}
                icon="pause"
              >
                Pause
              </Button>

              <Button
                variant="destructive"
                size="sm"
                onClick={handleStopRecording}
                disabled={recordingState === 'idle'}
                icon="square-shape"
              >
                Stop
              </Button>
            </div>
            {recordedSteps.length > 0 && recordingState === 'idle' && (
              <Badge text={`${recordedSteps.length} steps recorded`} color="blue" />
            )}
          </div>

          {recordingState === 'idle' && recordedSteps.length === 0 && (
            <div className={styles.emptyState}>Click &quot;Start Recording&quot; to begin capturing actions</div>
          )}

          {isEditMode && recordedSteps.length === 0 && recordingState === 'idle' && (
            <div className={styles.emptyState}>
              Editing existing multistep. Record new actions to replace existing internal spans.
            </div>
          )}
        </div>

        {/* Recorded steps list */}
        {recordedSteps.length > 0 && (
          <>
            <label className={styles.stepsLabel}>Recorded Steps</label>
            <div className={styles.stepsContainer}>
              {recordedSteps.map((step, index) => (
                <div key={`${step.selector}-${step.action}-${index}`} className={styles.stepItem}>
                  <Badge text={String(index + 1)} color="blue" className={styles.stepBadge} />
                  <div className={styles.stepContent}>
                    <div className={styles.stepDescription}>
                      {step.description}
                      {step.isUnique === false && (
                        <Icon
                          name="exclamation-triangle"
                          size="sm"
                          style={{
                            marginLeft: '4px',
                            color: 'var(--grafana-colors-warning-text)',
                            verticalAlign: 'middle',
                          }}
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
              <Button variant="secondary" size="sm" onClick={handleClearRecording} icon="trash-alt">
                Clear All
              </Button>
            </HorizontalGroup>
          </>
        )}

        {/* Requirements field */}
        <Field
          label="Requirements:"
          description="Requirements are usually set on child interactive spans. Note: 'exists-reftarget' is not supported for multistep containers."
        >
          <>
            <Input
              value={requirements}
              onChange={(e) => setRequirements(e.currentTarget.value)}
              placeholder="e.g., navmenu-open, is-admin (optional)"
              autoFocus
            />
            <div className={styles.requirementsButtonContainer}>
              {/* Custom requirements buttons that exclude exists-reftarget for multistep */}
              <HorizontalGroup spacing="sm" wrap>
                {COMMON_REQUIREMENTS.filter((req) => req !== 'exists-reftarget')
                  .slice(0, 3)
                  .map((req) => (
                    <Button key={req} size="sm" variant="secondary" onClick={() => setRequirements(req)}>
                      {req}
                    </Button>
                  ))}
              </HorizontalGroup>
            </div>
          </>
        </Field>
      </Stack>
    </InteractiveFormShell>
  );
};

export default MultistepActionForm;
