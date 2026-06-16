import React from 'react';

import { Icon } from '@grafana/ui';

import { AI_FIX_REQUEST_EVENT, type AiFixRequestDetail } from '../../integrations/assistant-integration/ai-fix-event';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';

export function dispatchAiFixRequest(detail: AiFixRequestDetail): void {
  const base = { step_id: detail.stepId ?? '', rendered_step_id: detail.renderedStepId ?? '' };
  const analytics = detail.containerInfo
    ? { ...base, container_kind: detail.containerInfo.containerKind, sub_step_index: detail.containerInfo.subStepIndex }
    : { ...base, reftarget: detail.refTarget ?? '', target_action: detail.action ?? '' };
  reportAppInteraction(UserInteraction.AiFixAccepted, analytics);
  window.dispatchEvent(new CustomEvent(AI_FIX_REQUEST_EVENT, { detail }));
}

interface AiFixButtonProps {
  detail: AiFixRequestDetail;
  testId: string;
  className: string;
  disabled?: boolean;
}

export function AiFixButton({ detail, testId, className, disabled }: AiFixButtonProps) {
  return (
    <button className={className} data-testid={testId} disabled={disabled} onClick={() => dispatchAiFixRequest(detail)}>
      Fix this <Icon name="ai-sparkle" size="sm" />
    </button>
  );
}
