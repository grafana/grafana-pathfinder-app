import React from 'react';
import { render, fireEvent } from '@testing-library/react';

import { AiFixButton, dispatchAiFixRequest } from './ai-fix-button';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { AI_FIX_REQUEST_EVENT, type AiFixRequestDetail } from '../../integrations/assistant-integration/ai-fix-event';

jest.mock('@grafana/ui', () => ({ Icon: () => null }));
jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { AiFixAccepted: 'ai_fix_accepted' },
}));

function captureDetail(fire: () => void): AiFixRequestDetail | null {
  let captured: AiFixRequestDetail | null = null;
  const listener = (e: Event) => {
    captured = (e as CustomEvent<AiFixRequestDetail>).detail;
  };
  window.addEventListener(AI_FIX_REQUEST_EVENT, listener);
  fire();
  window.removeEventListener(AI_FIX_REQUEST_EVENT, listener);
  return captured;
}

const TOP_LEVEL: AiFixRequestDetail = { stepId: 's1', renderedStepId: 'r1', refTarget: '.gone', action: 'button' };
const SUBSTEP: AiFixRequestDetail = {
  stepId: 'c1',
  renderedStepId: 'r1',
  refTarget: '.gone',
  action: 'button',
  containerInfo: { containerId: 'c1', containerKind: 'multistep', subStepIndex: 2 },
};

describe('dispatchAiFixRequest', () => {
  beforeEach(() => jest.clearAllMocks());

  it('dispatches the event and reports top-level analytics', () => {
    const captured = captureDetail(() => dispatchAiFixRequest(TOP_LEVEL));
    expect(captured).toEqual(TOP_LEVEL);
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.AiFixAccepted, {
      step_id: 's1',
      rendered_step_id: 'r1',
      reftarget: '.gone',
      target_action: 'button',
    });
  });

  it('reports container analytics for a substep patch', () => {
    const captured = captureDetail(() => dispatchAiFixRequest(SUBSTEP));
    expect(captured?.containerInfo).toEqual(SUBSTEP.containerInfo);
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.AiFixAccepted, {
      step_id: 'c1',
      rendered_step_id: 'r1',
      container_kind: 'multistep',
      sub_step_index: 2,
    });
  });
});

describe('AiFixButton', () => {
  beforeEach(() => jest.clearAllMocks());

  it('dispatches the request on click', () => {
    const { getByTestId } = render(<AiFixButton detail={TOP_LEVEL} testId="ai-btn" className="c" />);
    const captured = captureDetail(() => fireEvent.click(getByTestId('ai-btn')));
    expect(captured).toEqual(TOP_LEVEL);
    expect(reportAppInteraction).toHaveBeenCalledWith(
      UserInteraction.AiFixAccepted,
      expect.objectContaining({ step_id: 's1' })
    );
  });

  it('honours the disabled prop', () => {
    const { getByTestId } = render(<AiFixButton detail={TOP_LEVEL} testId="ai-btn" className="c" disabled />);
    expect(getByTestId('ai-btn')).toBeDisabled();
  });
});
