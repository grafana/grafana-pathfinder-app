/**
 * Unit tests for section-analytics.ts
 *
 * Lifecycle: **permanent** — These tests provide long-term coverage for the
 * extracted section analytics utility.
 */

import { reportSectionExecution } from './section-analytics';
import { reportAppInteraction, getSourceDocument, calculateStepCompletion } from '../../../lib/analytics';
import { registerSectionSteps, resetStepRegistry } from './step-registry';

// Mock analytics
jest.mock('../../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { DoSectionButtonClick: 'DoSectionButtonClick' },
  getSourceDocument: jest.fn().mockReturnValue({ source_document: 'test-doc', step_id: 'test-step' }),
  calculateStepCompletion: jest.fn(),
}));

// Mock step-registry child deps
jest.mock('./interactive-step', () => ({ resetStepCounter: jest.fn() }));
jest.mock('./interactive-multi-step', () => ({ resetMultiStepCounter: jest.fn() }));
jest.mock('./interactive-guided', () => ({ resetGuidedCounter: jest.fn() }));
jest.mock('./interactive-quiz', () => ({ resetQuizCounter: jest.fn() }));

const mockReportAppInteraction = reportAppInteraction as jest.MockedFunction<typeof reportAppInteraction>;
const mockGetSourceDocument = getSourceDocument as jest.MockedFunction<typeof getSourceDocument>;
const mockCalculateStepCompletion = calculateStepCompletion as jest.MockedFunction<typeof calculateStepCompletion>;

beforeEach(() => {
  jest.clearAllMocks();
  resetStepRegistry();
});

describe('reportSectionExecution', () => {
  it('calls reportAppInteraction with correct event type', () => {
    registerSectionSteps('section-a', 3, 0);

    reportSectionExecution({
      sectionId: 'section-a',
      title: 'Test section',
      totalSectionSteps: 3,
      completedStepsCount: 2,
      startIndex: 0,
      wasCanceled: false,
    });

    expect(mockReportAppInteraction).toHaveBeenCalledTimes(1);
    expect(mockReportAppInteraction).toHaveBeenCalledWith(
      'DoSectionButtonClick',
      expect.objectContaining({
        content_type: 'interactive_guide',
        section_title: 'Test section',
        interaction_location: 'interactive_section',
      })
    );
  });

  it('computes section-scoped metrics correctly', () => {
    registerSectionSteps('section-a', 5, 0);

    reportSectionExecution({
      sectionId: 'section-a',
      title: 'Test section',
      totalSectionSteps: 5,
      completedStepsCount: 3,
      startIndex: 0,
      wasCanceled: false,
    });

    expect(mockReportAppInteraction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        total_steps: 5,
        current_section_step: 3,
        current_section_percentage: 60, // 3/5 * 100 = 60
      })
    );
  });

  it('reports canceled status correctly', () => {
    registerSectionSteps('section-a', 3, 0);

    reportSectionExecution({
      sectionId: 'section-a',
      title: 'Section',
      totalSectionSteps: 3,
      completedStepsCount: 1,
      startIndex: 0,
      wasCanceled: true,
    });

    expect(mockReportAppInteraction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        canceled: true,
      })
    );
  });

  it('reports resumed status when startIndex > 0', () => {
    registerSectionSteps('section-a', 3, 0);

    reportSectionExecution({
      sectionId: 'section-a',
      title: 'Section',
      totalSectionSteps: 3,
      completedStepsCount: 3,
      startIndex: 1,
      wasCanceled: false,
    });

    expect(mockReportAppInteraction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        resumed: true,
      })
    );
  });

  it('reports non-resumed status when startIndex is 0', () => {
    registerSectionSteps('section-a', 3, 0);

    reportSectionExecution({
      sectionId: 'section-a',
      title: 'Section',
      totalSectionSteps: 3,
      completedStepsCount: 3,
      startIndex: 0,
      wasCanceled: false,
    });

    expect(mockReportAppInteraction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        resumed: false,
      })
    );
  });

  it('includes document source info from getSourceDocument', () => {
    registerSectionSteps('section-a', 3, 0);

    reportSectionExecution({
      sectionId: 'section-a',
      title: 'Section',
      totalSectionSteps: 3,
      completedStepsCount: 1,
      startIndex: 0,
      wasCanceled: false,
    });

    expect(mockGetSourceDocument).toHaveBeenCalledWith('section-a');
    expect(mockReportAppInteraction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source_document: 'test-doc',
        step_id: 'test-step',
      })
    );
  });

  it('includes document completion percentage when available', () => {
    registerSectionSteps('section-a', 3, 0);
    mockCalculateStepCompletion.mockReturnValue(66);

    reportSectionExecution({
      sectionId: 'section-a',
      title: 'Section',
      totalSectionSteps: 3,
      completedStepsCount: 2,
      startIndex: 0,
      wasCanceled: false,
    });

    expect(mockReportAppInteraction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        completion_percentage: 66,
      })
    );
  });

  it('reports current_section_percentage as 0 (not NaN) when totalSectionSteps is 0', () => {
    registerSectionSteps('section-a', 0, 0);

    reportSectionExecution({
      sectionId: 'section-a',
      title: 'Empty section',
      totalSectionSteps: 0,
      completedStepsCount: 0,
      startIndex: 0,
      wasCanceled: false,
    });

    expect(mockReportAppInteraction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        current_section_percentage: 0,
      })
    );
    // Verify it's actually 0, not NaN
    const callArgs = mockReportAppInteraction.mock.calls[0]?.[1];
    expect(callArgs).toBeDefined();
    expect(Number.isNaN(callArgs!.current_section_percentage)).toBe(false);
  });

  it('omits completion_percentage when calculateStepCompletion returns undefined', () => {
    registerSectionSteps('section-a', 3, 0);
    mockCalculateStepCompletion.mockReturnValue(undefined);

    reportSectionExecution({
      sectionId: 'section-a',
      title: 'Section',
      totalSectionSteps: 3,
      completedStepsCount: 2,
      startIndex: 0,
      wasCanceled: false,
    });

    const callArgs = mockReportAppInteraction.mock.calls[0][1];
    expect(callArgs).not.toHaveProperty('completion_percentage');
  });
});
