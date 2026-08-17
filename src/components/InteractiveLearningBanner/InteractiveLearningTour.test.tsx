import React from 'react';
import { render, act } from '@testing-library/react';

import { InteractiveLearningTour } from './InteractiveLearningTour';
import { isInteractiveLearningTourOpen, startInteractiveLearningTour, stopInteractiveLearningTour } from './tour-store';
import { testIds } from '../../constants/testIds';
import { AnalyticsContentType, UserInteraction } from '../../lib/analytics';
import type { BubbleTourProps, BubbleTourStep } from '../BubbleTour';

const mockBubbleTour = jest.fn();
jest.mock('../BubbleTour', () => ({
  BubbleTour: (props: BubbleTourProps) => {
    mockBubbleTour(props);
    return null;
  },
}));

const mockReportAppInteraction = jest.fn();
jest.mock('../../lib/analytics', () => ({
  ...jest.requireActual('../../lib/analytics'),
  reportAppInteraction: (...args: unknown[]) => mockReportAppInteraction(...args),
}));

const mockIsGrafanaCloud = jest.fn();
jest.mock('../../utils/grafana-platform', () => ({
  isGrafanaCloud: () => mockIsGrafanaCloud(),
}));

const OSS_GUIDE_URL = 'bundled:welcome-to-grafana';
const CLOUD_GUIDE_URL = 'bundled:welcome-to-grafana-cloud';

function lastTourProps(): BubbleTourProps {
  return mockBubbleTour.mock.calls.at(-1)![0];
}

function steps(): BubbleTourStep[] {
  return lastTourProps().steps;
}

function handoffStep(): BubbleTourStep {
  return steps().find((step) => step.nextLabel === 'Open the guide')!;
}

function renderOpen(onOpenGuide = jest.fn(), onReturnToContext = jest.fn()) {
  const view = render(<InteractiveLearningTour onOpenGuide={onOpenGuide} onReturnToContext={onReturnToContext} />);
  act(() => startInteractiveLearningTour());
  return { ...view, onOpenGuide, onReturnToContext };
}

describe('InteractiveLearningTour', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stopInteractiveLearningTour();
    mockIsGrafanaCloud.mockReturnValue(false);
  });

  it('renders nothing until the tour is started', () => {
    render(<InteractiveLearningTour onOpenGuide={jest.fn()} onReturnToContext={jest.fn()} />);

    expect(mockBubbleTour).not.toHaveBeenCalled();
  });

  it('returns to the context tab on the second-to-last step, ending where it began', () => {
    const { onReturnToContext } = renderOpen();

    const all = steps();
    const last = all[all.length - 1]!;
    const beforeLast = all[all.length - 2]!;

    beforeLast.onAdvance!();
    expect(onReturnToContext).toHaveBeenCalledTimes(1);

    expect(last.target).toContain(testIds.contextPanel.container);
    expect(last.disableBack).toBe(true);
  });

  it('renders the tour once the store opens it', () => {
    renderOpen();

    expect(mockBubbleTour).toHaveBeenCalled();
    expect(steps()).toHaveLength(10);
  });

  it('points at My learning, the one surface that always shows private paths', () => {
    renderOpen();

    const myLearning = steps().find((step) => step.target.includes(testIds.docsPanel.myLearningTab));
    expect(myLearning).toBeDefined();
    // Not optional: unlike the context-tab section, this anchor is always rendered,
    // so it is what guarantees the tour covers private content on every stack.
    expect(myLearning!.optional).toBeUndefined();
    expect(myLearning!.content).toMatch(/privately/i);
  });

  describe('hand-off', () => {
    it('opens the OSS guide on a non-Cloud stack', () => {
      const { onOpenGuide } = renderOpen();

      handoffStep().onAdvance!();

      expect(onOpenGuide).toHaveBeenCalledWith(OSS_GUIDE_URL, 'Welcome to Grafana');
    });

    it('opens the Cloud guide on a Cloud stack', () => {
      mockIsGrafanaCloud.mockReturnValue(true);
      const { onOpenGuide } = renderOpen();

      handoffStep().onAdvance!();

      expect(onOpenGuide).toHaveBeenCalledWith(CLOUD_GUIDE_URL, 'Welcome to Grafana');
    });

    it('reports the open as a normal guide open so it lands in the existing funnel', () => {
      renderOpen();

      handoffStep().onAdvance!();

      expect(mockReportAppInteraction).toHaveBeenCalledWith(UserInteraction.OpenResourceClick, {
        content_title: 'Welcome to Grafana',
        content_url: OSS_GUIDE_URL,
        content_type: AnalyticsContentType.InteractiveGuide,
        interaction_location: 'interactive_learning_banner',
      });
    });

    it('is one-way, so Back cannot land on the unmounted context tab', () => {
      renderOpen();

      const all = steps();
      const handoffIndex = all.indexOf(handoffStep());
      expect(all[handoffIndex + 1]!.disableBack).toBe(true);
    });
  });

  it('marks the organization-guides step optional, since that section is often absent', () => {
    renderOpen();

    const optional = steps().filter((step) => step.optional);
    expect(optional).toHaveLength(1);
    expect(optional[0]!.target).toContain(testIds.contextPanel.customGuidesSection);
  });

  it('anchors the in-guide steps on button classes rather than hashed step ids', () => {
    renderOpen();

    const targets = steps().map((step) => step.target);
    expect(targets).toContain('[data-testid="interactive-section-section-grafana-tour"] .interactive-step-show-btn');
    expect(targets).toContain('[data-testid="interactive-section-section-grafana-tour"] .interactive-step-do-btn');
    expect(targets.some((target) => /interactive-show-me-/.test(target))).toBe(false);
  });

  describe('close', () => {
    it.each([
      ['completed', UserInteraction.InteractiveLearningTourCompleted],
      ['dismissed', UserInteraction.InteractiveLearningTourDismissed],
    ] as const)('closes the store and reports a %s tour', (reason, expectedEvent) => {
      renderOpen();

      act(() => lastTourProps().onClose({ reason, stepIndex: 3, stepTotal: 8 }));

      expect(isInteractiveLearningTourOpen()).toBe(false);
      expect(mockReportAppInteraction).toHaveBeenCalledWith(expectedEvent, {
        interaction_location: 'interactive_learning_banner',
        step_index: 3,
        step_total: 8,
      });
    });
  });
});
