import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Field, Modal, TextArea } from '@grafana/ui';
import { t } from '@grafana/i18n';
import type { JsonGuide } from '../../../types/json-guide.types';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import {
  useAssistantGeneration,
  getGuideCustomizationContext,
  createGuideMetadataTool,
  createGuideUiTool,
  type InlineToolRunnable,
} from '../../../integrations/assistant-integration';
import {
  buildGuideCustomizationPrompt,
  buildGuideRepairPrompt,
  GuideCustomizationError,
  GUIDE_CUSTOMIZATION_SYSTEM_PROMPT,
  parseCustomizedGuide,
} from '../utils/customize-guide';

interface Props {
  guide: JsonGuide;
  isOpen?: boolean;
  sourceUrl: string;
  onReview: (guide: JsonGuide) => void;
  onDismiss: () => void;
}

export function CustomizeGuideModal({ guide, isOpen = true, sourceUrl, onReview, onDismiss }: Props) {
  const { generate, cancel, isAssistantAvailable, isCheckingAssistantAvailability, getDatasourceContext } =
    useAssistantGeneration({
      contentKey: guide.id,
      assistantId: 'customize-guide',
    });
  const [audience, setAudience] = useState('');
  const [outcome, setOutcome] = useState('');
  const [environment, setEnvironment] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [phase, setPhase] = useState(t('docsPanel.customizeGuideWaiting', 'Waiting for Assistant…'));
  const [generatedGuide, setGeneratedGuide] = useState<JsonGuide>();
  const [received, setReceived] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string>();
  const request = useRef({ active: true, busy: false });

  const cancelRef = useRef(cancel);
  useEffect(() => {
    cancelRef.current = cancel;
  }, [cancel]);

  useEffect(() => {
    request.current = { active: true, busy: false };
    return () => {
      request.current.active = false;
      cancelRef.current();
    };
  }, []);

  useEffect(() => {
    if (!isGenerating) {
      return;
    }
    const started = Date.now();
    const interval = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(interval);
  }, [isGenerating]);

  const dismiss = () => {
    request.current.active = false;
    cancel();
    onDismiss();
  };

  const customize = async () => {
    if (!request.current.active || request.current.busy || !isAssistantAvailable || !outcome.trim()) {
      return;
    }
    request.current.active = false;
    const current = { active: true, busy: true };
    request.current = current;
    reportAppInteraction(UserInteraction.AssistantCustomizeClick, { source: 'private-guide' });
    setGeneratedGuide(undefined);
    setIsGenerating(true);
    setError(undefined);
    setElapsed(0);
    setReceived(0);
    setPhase(t('docsPanel.customizeGuideReadingDataSources', 'Reading available data sources…'));
    const answers = { audience, outcome, environment };
    const isCurrent = () => current.active && current.busy;
    let metadataTools: InlineToolRunnable[] = [];
    const generateResponse = async (prompt: string, repairing: boolean): Promise<string> => {
      let resolveResponse!: (value: string) => void;
      let rejectResponse!: (error: Error) => void;
      const response = new Promise<string>((resolve, reject) => {
        resolveResponse = resolve;
        rejectResponse = reject;
      });
      let characters = 0;
      const [, text] = await Promise.all([
        generate({
          origin: 'grafana-pathfinder-app/customize-guide',
          systemPrompt: GUIDE_CUSTOMIZATION_SYSTEM_PROMPT,
          prompt,
          tools: metadataTools,
          onDelta: (delta) => {
            if (isCurrent()) {
              characters += delta.length;
              setReceived(characters);
              setPhase(
                repairing
                  ? t('docsPanel.customizeGuideRepairing', 'Repairing the generated guide…')
                  : t('docsPanel.customizeGuideReceiving', 'Receiving the customized guide…')
              );
            }
          },
          onComplete: resolveResponse,
          onError: rejectResponse,
        }),
        response,
      ]);
      return text;
    };
    try {
      const { dataSources } = await getDatasourceContext();
      if (!isCurrent()) {
        return;
      }
      const grafanaContext = getGuideCustomizationContext();
      metadataTools = [
        createGuideUiTool(() => {
          if (isCurrent()) {
            setPhase(t('docsPanel.customizeGuideCheckingControls', 'Checking current page controls…'));
          }
        }, isCurrent),
        createGuideMetadataTool(
          dataSources,
          () => {
            if (isCurrent()) {
              setPhase(t('docsPanel.customizeGuideReadingMetadata', 'Reading data source metadata…'));
            }
          },
          isCurrent
        ),
      ];
      setPhase(t('docsPanel.customizeGuideWaiting', 'Waiting for Assistant…'));
      let response = await generateResponse(
        buildGuideCustomizationPrompt(guide, answers, dataSources, grafanaContext),
        false
      );
      if (!isCurrent()) {
        return;
      }
      setPhase(t('docsPanel.customizeGuideCheckingResult', 'Checking the generated guide…'));
      let customized: JsonGuide;
      try {
        customized = parseCustomizedGuide(response, guide, sourceUrl);
      } catch (e) {
        if (!(e instanceof GuideCustomizationError)) {
          throw e;
        }
        setPhase(t('docsPanel.customizeGuideRepairing', 'Repairing the generated guide…'));
        setReceived(0);
        response = await generateResponse(
          buildGuideRepairPrompt(guide, answers, response, e.details, dataSources, grafanaContext),
          true
        );
        if (!isCurrent()) {
          return;
        }
        setPhase(t('docsPanel.customizeGuideCheckingResult', 'Checking the generated guide…'));
        customized = parseCustomizedGuide(response, guide, sourceUrl);
      }
      reportAppInteraction(UserInteraction.AssistantCustomizeSuccess, { source: 'private-guide' });
      setGeneratedGuide(customized);
      onReview(customized);
    } catch (e) {
      if (isCurrent()) {
        reportAppInteraction(UserInteraction.AssistantCustomizeError, { source: 'private-guide' });
        setError(
          e instanceof GuideCustomizationError
            ? t('docsPanel.customizeGuideInvalid', '{{message}} Your draft is unchanged. Try again.', {
                message: e.message,
              })
            : t(
                'docsPanel.customizeGuideFailed',
                'Assistant could not customize this guide. Your draft is unchanged. Try again.'
              )
        );
      }
    } finally {
      if (current.active) {
        current.busy = false;
        setIsGenerating(false);
      }
    }
  };

  return (
    <Modal title={t('docsPanel.customizeGuideTitle', 'Customize with Assistant')} isOpen={isOpen} onDismiss={dismiss}>
      <p>
        {t(
          'docsPanel.customizeGuideDescription',
          'Assistant will use the guide, your answers, Grafana UI context, and relevant data source metadata to create a private copy. Review it in the block editor before saving or publishing.'
        )}
      </p>
      <Field label={t('docsPanel.customizeGuideAudience', 'Who is this guide for?')} htmlFor="customize-guide-audience">
        <TextArea
          id="customize-guide-audience"
          value={audience}
          onChange={(event) => {
            setAudience(event.currentTarget.value);
            setGeneratedGuide(undefined);
          }}
          placeholder={t(
            'docsPanel.customizeGuideAudiencePlaceholder',
            'For example, application developers new to Grafana'
          )}
          disabled={isGenerating}
          rows={2}
        />
      </Field>
      <Field
        label={t('docsPanel.customizeGuideOutcome', 'What should they learn or do?')}
        htmlFor="customize-guide-outcome"
        required
      >
        <TextArea
          id="customize-guide-outcome"
          value={outcome}
          onChange={(event) => {
            setOutcome(event.currentTarget.value);
            setGeneratedGuide(undefined);
          }}
          placeholder={t(
            'docsPanel.customizeGuideOutcomePlaceholder',
            'Describe the changes you want, or the outcome readers should reach'
          )}
          disabled={isGenerating}
          rows={3}
        />
      </Field>
      <Field
        label={t('docsPanel.customizeGuideEnvironment', 'What should reflect your environment?')}
        htmlFor="customize-guide-environment"
      >
        <TextArea
          id="customize-guide-environment"
          value={environment}
          onChange={(event) => {
            setEnvironment(event.currentTarget.value);
            setGeneratedGuide(undefined);
          }}
          placeholder={t(
            'docsPanel.customizeGuideEnvironmentPlaceholder',
            'For example, data sources, team conventions, steps to skip, or details to keep'
          )}
          disabled={isGenerating}
          rows={3}
        />
      </Field>
      {isGenerating && (
        <div>
          <div role="status" aria-live="polite">
            {phase}
          </div>
          <progress
            aria-label={t('docsPanel.customizeGuideProgress', 'Assistant progress')}
            style={{ width: '100%' }}
          />
          <p>
            {t('docsPanel.customizeGuideElapsed', '{{seconds}}s elapsed', { seconds: elapsed })}
            {received > 0 &&
              t('docsPanel.customizeGuideReceived', ' · {{characters}} characters received', {
                characters: received.toLocaleString(),
              })}
          </p>
        </div>
      )}
      {error && <Alert title={error} severity="error" />}
      {!generatedGuide && isCheckingAssistantAvailability && (
        <div role="status">{t('docsPanel.checkingAssistantAvailability', 'Checking Assistant availability…')}</div>
      )}
      {!generatedGuide && !isCheckingAssistantAvailability && !isAssistantAvailable && (
        <Alert
          title={t('docsPanel.customizeGuideUnavailable', 'Assistant is unavailable. Try again later.')}
          severity="info"
        />
      )}
      <Modal.ButtonRow>
        <Button variant="secondary" onClick={dismiss}>
          {t('docsPanel.cancelCopy', 'Cancel')}
        </Button>
        <Button
          disabled={isGenerating || (!generatedGuide && (!isAssistantAvailable || !outcome.trim()))}
          onClick={() => (generatedGuide ? onReview(generatedGuide) : void customize())}
        >
          {isGenerating
            ? t('docsPanel.customizingGuide', 'Customizing…')
            : generatedGuide
              ? t('docsPanel.customizeGuideReview', 'Review customized guide')
              : t('docsPanel.customizeGuideSubmit', 'Customize and open editor')}
        </Button>
      </Modal.ButtonRow>
    </Modal>
  );
}
