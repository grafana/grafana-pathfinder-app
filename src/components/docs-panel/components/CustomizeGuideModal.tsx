import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Field, Modal, TextArea } from '@grafana/ui';
import { t } from '@grafana/i18n';
import type { JsonGuide } from '../../../types/json-guide.types';
import { useAssistantGeneration } from '../../../integrations/assistant-integration';
import {
  buildGuideCustomizationPrompt,
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
  const { generate, cancel, isAssistantAvailable } = useAssistantGeneration({
    contentKey: guide.id,
    assistantId: 'customize-guide',
  });
  const [audience, setAudience] = useState('');
  const [outcome, setOutcome] = useState('');
  const [environment, setEnvironment] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string>();
  const request = useRef({ active: true, busy: false });

  useEffect(() => {
    request.current = { active: true, busy: false };
    return () => {
      request.current.active = false;
      cancel();
    };
  }, [cancel]);

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
    const fail = () => {
      if (current.active && current.busy) {
        current.busy = false;
        setIsGenerating(false);
        setError(t('docsPanel.customizeGuideFailed', 'Assistant could not customize this guide. Try again.'));
      }
    };
    try {
      await generate({
        origin: 'grafana-pathfinder-app/customize-guide',
        systemPrompt: GUIDE_CUSTOMIZATION_SYSTEM_PROMPT,
        prompt: buildGuideCustomizationPrompt(guide, { audience, outcome, environment }),
        onComplete: (response) => {
          if (!current.active || !current.busy) {
            return;
          }
          current.busy = false;
          setIsGenerating(false);
          try {
            onReview(parseCustomizedGuide(response, guide, sourceUrl));
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not open the customized guide. Try again.');
          }
        },
        onError: fail,
      });
    } catch {
      fail();
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
