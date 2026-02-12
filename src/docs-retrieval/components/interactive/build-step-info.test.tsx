/**
 * Unit tests for build-step-info.ts
 *
 * Lifecycle: **permanent** — These tests provide long-term coverage for the
 * extracted step info builder.
 */

import React from 'react';
import { buildStepInfo } from './build-step-info';

// ---------------------------------------------------------------------------
// Mock step components with stable references for .type matching
// ---------------------------------------------------------------------------

// buildStepInfo checks `child.type === InteractiveStep` etc.
// jest.mock is hoisted above variable declarations, so we must define the mock
// components inside the factory. We then import the mocked references to use
// in createElement calls within tests.

jest.mock('./interactive-step', () => {
  const Step = ({ children }: any) => children;
  Step.displayName = 'InteractiveStep';
  return { InteractiveStep: Step };
});
jest.mock('./interactive-multi-step', () => {
  const Multi = ({ children }: any) => children;
  Multi.displayName = 'InteractiveMultiStep';
  return { InteractiveMultiStep: Multi };
});
jest.mock('./interactive-guided', () => {
  const Guided = ({ children }: any) => children;
  Guided.displayName = 'InteractiveGuided';
  return { InteractiveGuided: Guided };
});
jest.mock('./interactive-quiz', () => {
  const Quiz = ({ children }: any) => children;
  Quiz.displayName = 'InteractiveQuiz';
  return { InteractiveQuiz: Quiz };
});

// Import the mocked components so we can use them as JSX element types
import { InteractiveStep as MockStep } from './interactive-step';
import { InteractiveMultiStep as MockMultiStep } from './interactive-multi-step';
import { InteractiveGuided as MockGuided } from './interactive-guided';
import { InteractiveQuiz as MockQuiz } from './interactive-quiz';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildStepInfo', () => {
  it('returns empty array for no children', () => {
    const result = buildStepInfo(null, 'section-test');
    expect(result).toEqual([]);
  });

  it('extracts InteractiveStep children with correct stepId format', () => {
    const children = [
      <MockStep key="1" targetAction="button" refTarget="button.save">
        Click save
      </MockStep>,
      <MockStep key="2" targetAction="highlight" refTarget="div.panel">
        Find panel
      </MockStep>,
    ];

    const result = buildStepInfo(children, 'section-a');

    expect(result).toHaveLength(2);
    expect(result[0].stepId).toBe('section-a-step-1');
    expect(result[0].targetAction).toBe('button');
    expect(result[0].refTarget).toBe('button.save');
    expect(result[0].isMultiStep).toBe(false);
    expect(result[0].isGuided).toBe(false);
    expect(result[0].index).toBe(0);

    expect(result[1].stepId).toBe('section-a-step-2');
    expect(result[1].targetAction).toBe('highlight');
    expect(result[1].index).toBe(1);
  });

  it('extracts InteractiveMultiStep children', () => {
    const children = [
      <MockMultiStep key="1" requirements="navmenu-open" skippable internalActions={[]}>
        Multi
      </MockMultiStep>,
    ];

    const result = buildStepInfo(children, 'section-b');

    expect(result).toHaveLength(1);
    expect(result[0].stepId).toBe('section-b-multistep-1');
    expect(result[0].isMultiStep).toBe(true);
    expect(result[0].isGuided).toBe(false);
    expect(result[0].requirements).toBe('navmenu-open');
    expect(result[0].skippable).toBe(true);
    expect(result[0].targetAction).toBeUndefined();
  });

  it('extracts InteractiveGuided children', () => {
    const children = [
      <MockGuided key="1" requirements="some-req" internalActions={[]}>
        Guided step
      </MockGuided>,
    ];

    const result = buildStepInfo(children, 'section-c');

    expect(result).toHaveLength(1);
    expect(result[0].stepId).toBe('section-c-guided-1');
    expect(result[0].isGuided).toBe(true);
    expect(result[0].isMultiStep).toBe(false);
  });

  it('extracts InteractiveQuiz children', () => {
    const children = [
      <MockQuiz key="1" question="What?" choices={[]}>
        Quiz
      </MockQuiz>,
    ];

    const result = buildStepInfo(children, 'section-d');

    expect(result).toHaveLength(1);
    expect(result[0].stepId).toBe('section-d-quiz-1');
    expect(result[0].isQuiz).toBe(true);
    expect(result[0].isMultiStep).toBe(false);
    expect(result[0].isGuided).toBe(false);
  });

  it('ignores non-step children (plain HTML elements)', () => {
    const children = [
      <p key="p">Some text</p>,
      <MockStep key="1" targetAction="button" refTarget="button">
        Step 1
      </MockStep>,
      <div key="div">A div</div>,
    ];

    const result = buildStepInfo(children, 'section-e');

    // Only the InteractiveStep should be extracted
    expect(result).toHaveLength(1);
    expect(result[0].stepId).toBe('section-e-step-1');
  });

  it('handles mixed step types with correct sequential indexing', () => {
    const children = [
      <MockStep key="1" targetAction="button" refTarget="button">
        Step
      </MockStep>,
      <MockMultiStep key="2" internalActions={[]}>
        Multi
      </MockMultiStep>,
      <MockGuided key="3" internalActions={[]}>
        Guided
      </MockGuided>,
      <MockQuiz key="4" question="What?" choices={[]}>
        Quiz
      </MockQuiz>,
    ];

    const result = buildStepInfo(children, 'section-f');

    expect(result).toHaveLength(4);
    expect(result[0].stepId).toBe('section-f-step-1');
    expect(result[0].index).toBe(0);

    expect(result[1].stepId).toBe('section-f-multistep-2');
    expect(result[1].index).toBe(1);

    expect(result[2].stepId).toBe('section-f-guided-3');
    expect(result[2].index).toBe(2);

    expect(result[3].stepId).toBe('section-f-quiz-4');
    expect(result[3].index).toBe(3);
  });

  it('extracts step props: postVerify, skippable, showMe, targetComment', () => {
    const children = [
      <MockStep
        key="1"
        targetAction="formfill"
        refTarget="input[name='email']"
        targetValue="test@example.com"
        targetComment="Fill in your email"
        postVerify="check-email"
        skippable
        showMe={false}
      >
        Step with props
      </MockStep>,
    ];

    const result = buildStepInfo(children, 'section-g');

    expect(result[0].targetValue).toBe('test@example.com');
    expect(result[0].targetComment).toBe('Fill in your email');
    expect(result[0].postVerify).toBe('check-email');
    expect(result[0].skippable).toBe(true);
    expect(result[0].showMe).toBe(false);
  });

  it('does NOT extract InteractiveStep wrapped in Fragment (documents limitation)', () => {
    // React.Children.forEach only iterates top-level children.
    // Steps nested inside Fragment or wrapper elements are invisible to buildStepInfo.
    const children = [
      <React.Fragment key="frag">
        <MockStep targetAction="button" refTarget="button">
          Hidden step
        </MockStep>
      </React.Fragment>,
      <MockStep key="2" targetAction="highlight" refTarget="div">
        Visible step
      </MockStep>,
    ];

    const result = buildStepInfo(children, 'section-frag');

    // Only the top-level MockStep is extracted; the Fragment-wrapped one is not
    expect(result).toHaveLength(1);
    expect(result[0].stepId).toBe('section-frag-step-1');
  });

  it('does NOT extract InteractiveStep wrapped in a div (documents limitation)', () => {
    const children = [
      <div key="wrapper">
        <MockStep targetAction="button" refTarget="button">
          Hidden step
        </MockStep>
      </div>,
      <MockStep key="2" targetAction="button" refTarget="btn">
        Visible step
      </MockStep>,
    ];

    const result = buildStepInfo(children, 'section-wrap');

    expect(result).toHaveLength(1);
    expect(result[0].stepId).toBe('section-wrap-step-1');
  });

  it('assigns sequential indices to two InteractiveGuided children', () => {
    const children = [
      <MockGuided key="1" requirements="req-a" internalActions={[]}>
        Guided one
      </MockGuided>,
      <MockGuided key="2" requirements="req-b" internalActions={[]}>
        Guided two
      </MockGuided>,
    ];

    const result = buildStepInfo(children, 'section-gg');

    expect(result).toHaveLength(2);
    expect(result[0].stepId).toBe('section-gg-guided-1');
    expect(result[0].index).toBe(0);
    expect(result[0].isGuided).toBe(true);

    expect(result[1].stepId).toBe('section-gg-guided-2');
    expect(result[1].index).toBe(1);
    expect(result[1].isGuided).toBe(true);
  });

  it('preserves React element reference in element field', () => {
    const stepElement = (
      <MockStep key="1" targetAction="button" refTarget="btn">
        Content
      </MockStep>
    );
    const children = [stepElement];

    const result = buildStepInfo(children, 'section-h');

    // The element should be a React element (preserved reference)
    expect(React.isValidElement(result[0].element)).toBe(true);
  });
});
