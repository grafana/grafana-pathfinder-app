import React from 'react';
import { render } from '@testing-library/react';

import { StepEditor, stepActionOptions } from './StepEditor';
import { GUIDED_ACTION_TYPES } from '../../../types/interactive-actions.types';
import { INTERACTIVE_ACTIONS } from '../constants';

type RecordedStep = { action: string; selector: string; value?: string };

let recordStep: ((step: RecordedStep) => void) | undefined;

jest.mock('../../../utils/devtools', () => ({
  ...jest.requireActual('../../../utils/devtools'),
  useActionRecorder: (options: { onStepRecorded?: (step: RecordedStep) => void }) => {
    recordStep = options.onStepRecorded;
    return {
      isRecording: false,
      startRecording: jest.fn(),
      stopRecording: jest.fn(),
      clearRecording: jest.fn(),
      activeModal: null,
      pendingGroupSteps: [],
    };
  },
}));

describe('StepEditor action picker', () => {
  it('offers exactly GUIDED_ACTION_TYPES in a guided block', () => {
    const values = stepActionOptions(true).map((option) => option.value);
    expect([...values].sort()).toEqual([...GUIDED_ACTION_TYPES].sort());
  });

  it('offers every action in a multistep block', () => {
    const values = stepActionOptions(false).map((option) => option.value);
    expect(values).toEqual(INTERACTIVE_ACTIONS.map((action) => action.value));
    expect(values).toEqual(expect.arrayContaining(['navigate', 'popout']));
  });
});

describe('StepEditor record mode', () => {
  beforeEach(() => {
    recordStep = undefined;
  });

  it('drops a recorded step a guided block cannot drive', () => {
    const onChange = jest.fn();
    render(<StepEditor steps={[]} onChange={onChange} isGuided />);

    recordStep?.({ action: 'navigate', selector: '/explore' });
    expect(onChange).not.toHaveBeenCalled();

    recordStep?.({ action: 'highlight', selector: '[data-testid="x"]' });
    expect(onChange).toHaveBeenCalledWith([{ action: 'highlight', reftarget: '[data-testid="x"]' }]);
  });

  it('keeps a recorded navigate step in a multistep block', () => {
    const onChange = jest.fn();
    render(<StepEditor steps={[]} onChange={onChange} />);

    recordStep?.({ action: 'navigate', selector: '/explore' });
    expect(onChange).toHaveBeenCalledWith([{ action: 'navigate', reftarget: '/explore' }]);
  });
});
