import React from 'react';
import { render } from '@testing-library/react';

import { BlockEditorTour } from './BlockEditorTour';
import { testIds } from '../../constants/testIds';
import type { BubbleTourProps } from '../BubbleTour';

const mockBubbleTour = jest.fn();
jest.mock('../BubbleTour', () => ({
  BubbleTour: (props: BubbleTourProps) => {
    mockBubbleTour(props);
    return null;
  },
}));

describe('BlockEditorTour', () => {
  beforeEach(() => jest.clearAllMocks());

  function tourProps(): BubbleTourProps {
    render(<BlockEditorTour onClose={jest.fn()} />);
    return mockBubbleTour.mock.calls.at(-1)![0];
  }

  it('keeps its own final-step label rather than the generic default', () => {
    expect(tourProps().finalStepLabel).toBe('Start creating');
  });

  it('tours the editor surfaces', () => {
    const targets = tourProps().steps.map((step) => step.target);

    expect(targets[0]).toContain(testIds.blockEditor.container);
    expect(targets).toContain(`[data-testid="${testIds.blockEditor.palette}"]`);
    expect(targets).toHaveLength(6);
  });

  it('forwards close through to the caller', () => {
    const onClose = jest.fn();
    render(<BlockEditorTour onClose={onClose} />);

    mockBubbleTour.mock.calls.at(-1)![0].onClose();

    expect(onClose).toHaveBeenCalled();
  });
});
