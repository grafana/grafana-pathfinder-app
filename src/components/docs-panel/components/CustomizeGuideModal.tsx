import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Field, Modal, TextArea } from '@grafana/ui';
import { t } from '@grafana/i18n';
import type { JsonGuide } from '../../../types/json-guide.types';
import { useAssistantGeneration } from '../../../integrations/assistant-integration';
import {
  buildGuideCustomizationPrompt,
  buildGuideRepairPrompt,
  GuideCustomizationError,
  GUIDE_CUSTOMIZATION_SYSTEM_PROMPT,
  parseCustomizedGuide,
} from '../utils/customize-guide';

interface Props {
  guide: JsonGuide;
  sourceUrl: string;
  onReview: (guide: JsonGuide) => void;
  onDismiss: () => void;
}

export function CustomizeGuideModal({ guide, sourceUrl, onReview, onDismiss }: Props) {
  const { generate, cancel, isAssistantAvailable, getDatasourceContext } = useAssistantGeneration({
    contentKey: guide.id,
    assistantId: 'customize-guide',
  });
  const [audience, setAudience] = useState('');
  const [outcome, setOutcome] = useState('');
  const [environment, setEnvironment] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [phase, setPhase] = useState('Waiting for Assistant…');
  const [received, setReceived] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string>();
  const request = useRef({ active: true, busy: false });

  useEffect(() => {
    request.current = { active: true, busy: false };
    return () => {
      request.current.active = false;
      cancel();
    };
  }, [cancel]);

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
    setIsGenerating(true);
    setError(undefined);
    setElapsed(0);
    setReceived(0);
    setPhase('Reading available data sources…');
    const answers = { audience, outcome, environment };
    const isCurrent = () => current.active && current.busy;
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
          onDelta: (delta) => {
            if (isCurrent()) {
              characters += delta.length;
              setReceived(characters);
              setPhase(repairing ? 'Repairing the generated guide…' : 'Receiving the customized guide…');
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
      setPhase('Waiting for Assistant…');
      let response = await generateResponse(buildGuideCustomizationPrompt(guide, answers, dataSources), false);
      if (!isCurrent()) {
        return;
      }
      setPhase('Checking the generated guide…');
      let customized: JsonGuide;
      try {
        customized = parseCustomizedGuide(response, guide, sourceUrl);
      } catch (e) {
        if (!(e instanceof GuideCustomizationError)) {
          throw e;
        }
        setPhase('Repairing the generated guide…');
        setReceived(0);
        response = await generateResponse(
          buildGuideRepairPrompt(guide, answers, response, e.details, dataSources),
          true
        );
        if (!isCurrent()) {
          return;
        }
        setPhase('Checking the generated guide…');
        customized = parseCustomizedGuide(response, guide, sourceUrl);
      }
      onReview(customized);
    } catch (e) {
      if (isCurrent()) {
        setError(
          e instanceof GuideCustomizationError
            ? `${e.message} Your draft is unchanged. Try again.`
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
    <Modal title={t('docsPanel.customizeGuideTitle', 'Customize with Assistant')} isOpen onDismiss={dismiss}>
      <p>
        {t(
          'docsPanel.customizeGuideDescription',
          'Assistant will use the full guide and your answers to create a private copy. Review it in the block editor before saving or publishing.'
        )}
      </p>
      <Field label={t('docsPanel.customizeGuideAudience', 'Who is this guide for?')} htmlFor="customize-guide-audience">
        <TextArea
          id="customize-guide-audience"
          value={audience}
          onChange={(event) => setAudience(event.currentTarget.value)}
          placeholder="For example, application developers new to Grafana"
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
          onChange={(event) => setOutcome(event.currentTarget.value)}
          placeholder="Describe the changes you want, or the outcome readers should reach"
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
          onChange={(event) => setEnvironment(event.currentTarget.value)}
          placeholder="For example, data sources, team conventions, steps to skip, or details to keep"
          disabled={isGenerating}
          rows={3}
        />
      </Field>
      {isGenerating && (
        <div>
          <div role="status" aria-live="polite">
            {phase}
          </div>
          <progress aria-label="Assistant progress" style={{ width: '100%' }} />
          <p>
            {elapsed}s elapsed{received > 0 ? ` · ${received.toLocaleString()} characters received` : ''}
          </p>
        </div>
      )}
      {error && <Alert title={error} severity="error" />}
      {!isAssistantAvailable && (
        <Alert
          title={t('docsPanel.customizeGuideUnavailable', 'Assistant is unavailable. Try again later.')}
          severity="info"
        />
      )}
      <Modal.ButtonRow>
        <Button variant="secondary" onClick={dismiss}>
          {t('docsPanel.cancelCopy', 'Cancel')}
        </Button>
        <Button disabled={!isAssistantAvailable || isGenerating || !outcome.trim()} onClick={() => void customize()}>
          {isGenerating
            ? t('docsPanel.customizingGuide', 'Customizing…')
            : t('docsPanel.customizeGuideSubmit', 'Customize and open editor')}
        </Button>
      </Modal.ButtonRow>
    </Modal>
  );
}
