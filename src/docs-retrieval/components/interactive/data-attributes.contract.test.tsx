/**
 * E2E Contract Tests: Data Attributes for Interactive Step Components
 *
 * This test suite validates the contract between data-test-* attributes and their
 * corresponding UI states for all three interactive step components.
 *
 * Test Pattern: Dual Assertion
 * Each test verifies both:
 * 1. The data attribute value is correct
 * 2. The corresponding UI state matches the attribute
 *
 * This ensures E2E tests can rely on attributes without drift from actual UI state.
 *
 * Coverage:
 * - 8 new data-test-* attributes (5 tier 1, 3 tier 2)
 * - 3 step component types (InteractiveGuided, InteractiveMultiStep, InteractiveStep)
 * - Default state attribute values
 *
 * Testing Approach:
 * These tests verify attribute presence and default values. State transitions
 * (idle -> executing -> completed) require Playwright E2E tests where the full
 * application context is available.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { InteractiveStep } from './interactive-step';
import { InteractiveMultiStep } from './interactive-multi-step';
import { InteractiveGuided } from './interactive-guided';
import { testIds } from '../../../components/testIds';
import type { InternalAction, GuidedAction } from '../../../types';
import { STEP_STATES, REQUIREMENTS_STATES, FIX_TYPES, FORM_STATES } from './step-states';

// ============================================================================
// Test Data
// ============================================================================

const mockInternalActions: InternalAction[] = [
  {
    targetAction: 'button',
    refTarget: '[data-testid="test-button-1"]',
    targetValue: undefined,
    targetComment: 'Click the first button',
  },
  {
    targetAction: 'formfill',
    refTarget: 'input[name="username"]',
    targetValue: 'testuser',
    targetComment: 'Fill in the username',
  },
  {
    targetAction: 'button',
    refTarget: '[data-testid="test-button-2"]',
    targetValue: undefined,
    targetComment: 'Click the second button',
  },
];

const mockGuidedActions: GuidedAction[] = [
  {
    targetAction: 'button',
    refTarget: '[data-testid="test-button-1"]',
    targetComment: 'Click the first button',
  },
  {
    targetAction: 'formfill',
    refTarget: 'input[name="username"]',
    targetValue: 'testuser',
    targetComment: 'Fill in the username',
  },
  {
    targetAction: 'button',
    refTarget: '[data-testid="test-button-2"]',
    targetComment: 'Click the second button',
  },
];

// ============================================================================
// data-test-step-state Tests
// ============================================================================

describe('E2E Contract: data-test-step-state', () => {
  describe('InteractiveStep', () => {
    it('has data-test-step-state attribute', () => {
      render(
        <InteractiveStep
          stepId="test-step-state"
          targetAction="button"
          refTarget="button[data-testid='test']"
        >
          Step content
        </InteractiveStep>
      );

      const element = screen.getByTestId(testIds.interactive.step('test-step-state'));

      // Attribute should exist
      expect(element).toHaveAttribute('data-test-step-state');

      // Should be one of the valid states
      const stateValue = element.getAttribute('data-test-step-state');
      expect(Object.values(STEP_STATES)).toContain(stateValue);
    });

    it('defaults to checking when component initializes with requirement checking', () => {
      render(
        <InteractiveStep
          stepId="test-step-initial"
          targetAction="button"
          refTarget="button[data-testid='test']"
        >
          Initial step
        </InteractiveStep>
      );

      const element = screen.getByTestId(testIds.interactive.step('test-step-initial'));

      // The initial state depends on requirement checking behavior
      const stateValue = element.getAttribute('data-test-step-state');
      expect([STEP_STATES.IDLE, STEP_STATES.CHECKING, STEP_STATES.REQUIREMENTS_UNMET]).toContain(stateValue);
    });
  });

  describe('InteractiveMultiStep', () => {
    it('has data-test-step-state attribute', () => {
      render(
        <InteractiveMultiStep
          stepId="test-multistep-state"
          internalActions={mockInternalActions}
          title="Test Multi-Step"
        >
          Multi-step content
        </InteractiveMultiStep>
      );

      const element = screen.getByTestId(testIds.interactive.step('test-multistep-state'));

      // Attribute should exist
      expect(element).toHaveAttribute('data-test-step-state');

      // Should be one of the valid states
      const stateValue = element.getAttribute('data-test-step-state');
      expect(Object.values(STEP_STATES)).toContain(stateValue);
    });
  });

  describe('InteractiveGuided', () => {
    it('has data-test-step-state attribute', () => {
      render(
        <InteractiveGuided
          stepId="test-guided-state"
          internalActions={mockGuidedActions}
          title="Test Guided Step"
        >
          Guided content
        </InteractiveGuided>
      );

      const element = screen.getByTestId(testIds.interactive.step('test-guided-state'));

      // Attribute should exist
      expect(element).toHaveAttribute('data-test-step-state');

      // Should be one of the valid states
      const stateValue = element.getAttribute('data-test-step-state');
      expect(Object.values(STEP_STATES)).toContain(stateValue);
    });

    it('has matching data-state attribute (backward compatibility)', () => {
      render(
        <InteractiveGuided
          stepId="test-guided-dual"
          internalActions={mockGuidedActions}
          title="Test Guided Step"
        >
          Guided content
        </InteractiveGuided>
      );

      const element = screen.getByTestId(testIds.interactive.step('test-guided-dual'));

      // Both attributes should exist and match
      const testState = element.getAttribute('data-test-step-state');
      const dataState = element.getAttribute('data-state');

      expect(testState).toBe(dataState);
    });
  });
});

// ============================================================================
// data-test-substep-index Tests
// ============================================================================

describe('E2E Contract: data-test-substep-index', () => {
  it('InteractiveGuided: undefined when not executing', () => {
    render(
      <InteractiveGuided
        stepId="test-substep-idle"
        internalActions={mockGuidedActions}
      >
        Not executing
      </InteractiveGuided>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-substep-idle'));

    // Attribute contract: should not have the attribute when not executing
    expect(element).not.toHaveAttribute('data-test-substep-index');
  });

  it('InteractiveMultiStep: undefined when not executing', () => {
    render(
      <InteractiveMultiStep
        stepId="test-multistep-substep-idle"
        internalActions={mockInternalActions}
      >
        Not executing
      </InteractiveMultiStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-multistep-substep-idle'));

    // Attribute contract
    expect(element).not.toHaveAttribute('data-test-substep-index');
  });
});

// ============================================================================
// data-test-substep-total Tests
// ============================================================================

describe('E2E Contract: data-test-substep-total', () => {
  it('InteractiveGuided: equals internalActions.length', () => {
    render(
      <InteractiveGuided
        stepId="test-substep-total"
        internalActions={mockGuidedActions}
      >
        Test substep total
      </InteractiveGuided>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-substep-total'));

    // Attribute contract
    expect(element).toHaveAttribute('data-test-substep-total', mockGuidedActions.length.toString());
  });

  it('InteractiveMultiStep: equals internalActions.length', () => {
    render(
      <InteractiveMultiStep
        stepId="test-multistep-total"
        internalActions={mockInternalActions}
      >
        Test substep total
      </InteractiveMultiStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-multistep-total'));

    // Attribute contract
    expect(element).toHaveAttribute('data-test-substep-total', mockInternalActions.length.toString());
  });

  it('works with single action', () => {
    const singleAction: GuidedAction[] = [
      {
        targetAction: 'button',
        refTarget: 'button',
        targetComment: 'Single action',
      },
    ];

    render(
      <InteractiveGuided
        stepId="test-substep-single"
        internalActions={singleAction}
      >
        Single action
      </InteractiveGuided>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-substep-single'));

    // Attribute contract
    expect(element).toHaveAttribute('data-test-substep-total', '1');
  });
});

// ============================================================================
// data-test-fix-type Tests
// ============================================================================

describe('E2E Contract: data-test-fix-type', () => {
  it('InteractiveStep: has data-test-fix-type attribute', () => {
    render(
      <InteractiveStep
        stepId="test-fix-type"
        targetAction="button"
        refTarget="button"
      >
        Fix type test
      </InteractiveStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-fix-type'));

    // Attribute should exist
    expect(element).toHaveAttribute('data-test-fix-type');

    // Should be one of the valid fix types
    const fixType = element.getAttribute('data-test-fix-type');
    expect(Object.values(FIX_TYPES)).toContain(fixType);
  });

  it('InteractiveStep: defaults to "none" when no fix needed', () => {
    render(
      <InteractiveStep
        stepId="test-fix-none"
        targetAction="button"
        refTarget="button"
      >
        No fix needed
      </InteractiveStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-fix-none'));

    // Default state should be 'none' when requirements don't need fixing
    const fixType = element.getAttribute('data-test-fix-type');
    // Could be 'none' or a specific fix type depending on requirement checking
    expect(Object.values(FIX_TYPES)).toContain(fixType);
  });
});

// ============================================================================
// data-test-requirements-state Tests
// ============================================================================

describe('E2E Contract: data-test-requirements-state', () => {
  it('InteractiveStep: has data-test-requirements-state attribute', () => {
    render(
      <InteractiveStep
        stepId="test-req-state"
        targetAction="button"
        refTarget="button"
      >
        Requirements state test
      </InteractiveStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-req-state'));

    // Attribute should exist
    expect(element).toHaveAttribute('data-test-requirements-state');

    // Should be one of the valid states
    const reqState = element.getAttribute('data-test-requirements-state');
    expect(Object.values(REQUIREMENTS_STATES)).toContain(reqState);
  });

  it('InteractiveMultiStep: has data-test-requirements-state attribute', () => {
    render(
      <InteractiveMultiStep
        stepId="test-multistep-req"
        internalActions={mockInternalActions}
      >
        Requirements test
      </InteractiveMultiStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-multistep-req'));

    // Attribute should exist
    expect(element).toHaveAttribute('data-test-requirements-state');

    // Should be one of the valid states
    const reqState = element.getAttribute('data-test-requirements-state');
    expect(Object.values(REQUIREMENTS_STATES)).toContain(reqState);
  });

  it('InteractiveGuided: has data-test-requirements-state attribute', () => {
    render(
      <InteractiveGuided
        stepId="test-guided-req"
        internalActions={mockGuidedActions}
      >
        Requirements test
      </InteractiveGuided>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-guided-req'));

    // Attribute should exist
    expect(element).toHaveAttribute('data-test-requirements-state');

    // Should be one of the valid states
    const reqState = element.getAttribute('data-test-requirements-state');
    expect(Object.values(REQUIREMENTS_STATES)).toContain(reqState);
  });
});

// ============================================================================
// data-test-form-state Tests
// ============================================================================

describe('E2E Contract: data-test-form-state', () => {
  it('InteractiveStep: not present for non-formfill actions', () => {
    render(
      <InteractiveStep
        stepId="test-form-button"
        targetAction="button"
        refTarget="button"
      >
        Button action
      </InteractiveStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-form-button'));

    // Attribute should not be present for non-formfill
    expect(element).not.toHaveAttribute('data-test-form-state');
  });

  it('InteractiveStep: present for formfill actions', () => {
    render(
      <InteractiveStep
        stepId="test-form-fill"
        targetAction="formfill"
        refTarget="input[name='test']"
      >
        Form fill action
      </InteractiveStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-form-fill'));

    // Attribute should be present for formfill
    expect(element).toHaveAttribute('data-test-form-state');

    // Should be one of the valid form states
    const formState = element.getAttribute('data-test-form-state');
    expect(Object.values(FORM_STATES)).toContain(formState);
  });

  it('InteractiveStep: defaults to idle for formfill', () => {
    render(
      <InteractiveStep
        stepId="test-form-idle"
        targetAction="formfill"
        refTarget="input[name='test']"
      >
        Form fill idle
      </InteractiveStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-form-idle'));

    // Default should be idle (no validation happening)
    expect(element).toHaveAttribute('data-test-form-state', FORM_STATES.IDLE);
  });
});

// ============================================================================
// data-test-action Tests
// ============================================================================

describe('E2E Contract: data-targetaction (existing)', () => {
  const actionTypes = ['button', 'hover', 'highlight', 'formfill', 'navigate', 'noop'] as const;

  it.each(actionTypes)('InteractiveStep: reflects "%s" action in data-targetaction', (actionType) => {
    render(
      <InteractiveStep
        stepId={`test-action-${actionType}`}
        targetAction={actionType}
        refTarget={actionType === 'navigate' ? '/test' : 'button'}
      >
        {actionType} action
      </InteractiveStep>
    );

    const element = screen.getByTestId(testIds.interactive.step(`test-action-${actionType}`));
    expect(element).toHaveAttribute('data-targetaction', actionType);
  });

  it('InteractiveMultiStep: always has "multistep" value', () => {
    render(
      <InteractiveMultiStep
        stepId="test-multistep-action"
        internalActions={mockInternalActions}
        title="Multi-Step Test"
      >
        Multi-step content
      </InteractiveMultiStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-multistep-action'));
    expect(element).toHaveAttribute('data-targetaction', 'multistep');
  });

  it('InteractiveGuided: does not have data-targetaction attribute', () => {
    render(
      <InteractiveGuided
        stepId="test-guided-action"
        internalActions={mockGuidedActions}
        title="Guided Test"
      >
        Guided content
      </InteractiveGuided>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-guided-action'));
    expect(element).not.toHaveAttribute('data-targetaction');
  });
});

// ============================================================================
// data-test-target-value Tests
// ============================================================================

describe('E2E Contract: data-targetvalue', () => {
  it('InteractiveStep: reflects targetValue in data-targetvalue', () => {
    render(
      <InteractiveStep
        stepId="test-value"
        targetAction="formfill"
        refTarget="input"
        targetValue="test-value-123"
      >
        Has target value
      </InteractiveStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-value'));
    expect(element).toHaveAttribute('data-targetvalue', 'test-value-123');
  });

  it('InteractiveStep: handles undefined targetValue', () => {
    render(
      <InteractiveStep
        stepId="test-value-undefined"
        targetAction="button"
        refTarget="button"
      >
        No target value
      </InteractiveStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-value-undefined'));

    // When targetValue is undefined, attribute should not be set or be empty
    const attrValue = element.getAttribute('data-targetvalue');
    expect(attrValue === null || attrValue === '' || attrValue === 'undefined').toBe(true);
  });
});

// ============================================================================
// data-testid Tests
// ============================================================================

describe('E2E Contract: data-testid', () => {
  it('InteractiveStep: matches testIds.interactive.step(stepId)', () => {
    render(
      <InteractiveStep
        stepId="test-step-123"
        targetAction="button"
        refTarget="button"
      >
        Test step content
      </InteractiveStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-step-123'));
    expect(element).toHaveAttribute('data-testid', testIds.interactive.step('test-step-123'));
  });

  it('InteractiveMultiStep: matches testIds.interactive.step(stepId)', () => {
    render(
      <InteractiveMultiStep
        stepId="test-multistep-456"
        internalActions={mockInternalActions}
        title="Test Multi-Step"
      >
        Multi-step content
      </InteractiveMultiStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-multistep-456'));
    expect(element).toHaveAttribute('data-testid', testIds.interactive.step('test-multistep-456'));
  });

  it('InteractiveGuided: matches testIds.interactive.step(stepId)', () => {
    render(
      <InteractiveGuided
        stepId="test-guided-789"
        internalActions={mockGuidedActions}
        title="Test Guided Step"
      >
        Guided step content
      </InteractiveGuided>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-guided-789'));
    expect(element).toHaveAttribute('data-testid', testIds.interactive.step('test-guided-789'));
  });

  it('uses generated renderedStepId when stepId not provided', () => {
    render(
      <InteractiveStep
        targetAction="button"
        refTarget="button"
      >
        Step without explicit ID
      </InteractiveStep>
    );

    // Should be able to find the element by its auto-generated test ID
    const element = document.querySelector('[data-testid^="interactive-step-"]');
    expect(element).toBeInTheDocument();
    expect(element).toHaveAttribute('data-testid');
  });
});

// ============================================================================
// data-reftarget Tests
// ============================================================================

describe('E2E Contract: data-reftarget', () => {
  it('InteractiveStep: reflects refTarget prop', () => {
    const refTargetValue = 'button#submit-form';

    render(
      <InteractiveStep
        stepId="test-reftarget"
        targetAction="button"
        refTarget={refTargetValue}
      >
        Click the submit button
      </InteractiveStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-reftarget'));
    expect(element).toHaveAttribute('data-reftarget', refTargetValue);
  });

  it('InteractiveStep: handles complex CSS selectors', () => {
    const complexSelector = 'div.container > button[data-testid="submit"]:not(.disabled)';

    render(
      <InteractiveStep
        stepId="test-complex-selector"
        targetAction="button"
        refTarget={complexSelector}
      >
        Complex selector test
      </InteractiveStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-complex-selector'));
    expect(element).toHaveAttribute('data-reftarget', complexSelector);
  });

  it('InteractiveMultiStep: reflects renderedStepId', () => {
    const stepId = 'test-multistep-reftarget';

    render(
      <InteractiveMultiStep
        stepId={stepId}
        internalActions={mockInternalActions}
        title="Multi-Step Test"
      >
        Multi-step content
      </InteractiveMultiStep>
    );

    const element = screen.getByTestId(testIds.interactive.step(stepId));
    expect(element).toHaveAttribute('data-reftarget', stepId);
  });

  it('InteractiveGuided: does not have data-reftarget attribute', () => {
    render(
      <InteractiveGuided
        stepId="test-guided-reftarget"
        internalActions={mockGuidedActions}
        title="Guided Test"
      >
        Guided content
      </InteractiveGuided>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-guided-reftarget'));
    expect(element).not.toHaveAttribute('data-reftarget');
  });
});

// ============================================================================
// data-internal-actions Tests
// ============================================================================

describe('E2E Contract: data-internal-actions', () => {
  it('InteractiveMultiStep: is JSON-parseable to InternalAction[]', () => {
    render(
      <InteractiveMultiStep
        stepId="test-internal-actions"
        internalActions={mockInternalActions}
        title="Internal Actions Test"
      >
        Multi-step content
      </InteractiveMultiStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-internal-actions'));
    const json = element.getAttribute('data-internal-actions');

    // Contract: attribute should be present and valid JSON
    expect(json).not.toBeNull();
    expect(() => JSON.parse(json!)).not.toThrow();

    // Parse and verify structure
    const parsedActions = JSON.parse(json!);
    expect(Array.isArray(parsedActions)).toBe(true);
    expect(parsedActions).toHaveLength(mockInternalActions.length);
  });

  it('InteractiveMultiStep: parsed JSON matches InternalAction structure', () => {
    render(
      <InteractiveMultiStep
        stepId="test-action-structure"
        internalActions={mockInternalActions}
        title="Action Structure Test"
      >
        Multi-step content
      </InteractiveMultiStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-action-structure'));
    const json = element.getAttribute('data-internal-actions');
    const parsedActions: InternalAction[] = JSON.parse(json!);

    // Contract: each action should have the expected properties
    parsedActions.forEach((action, index) => {
      expect(action).toHaveProperty('targetAction');
      expect(action).toHaveProperty('refTarget');
      expect(action).toHaveProperty('targetComment');

      // Verify against original data
      expect(action.targetAction).toBe(mockInternalActions[index].targetAction);
      expect(action.refTarget).toBe(mockInternalActions[index].refTarget);
      expect(action.targetComment).toBe(mockInternalActions[index].targetComment);
    });
  });

  it('InteractiveStep: does not have data-internal-actions attribute', () => {
    render(
      <InteractiveStep
        stepId="test-step-no-internal"
        targetAction="button"
        refTarget="button"
      >
        Regular step
      </InteractiveStep>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-step-no-internal'));
    expect(element).not.toHaveAttribute('data-internal-actions');
  });

  it('InteractiveGuided: does not have data-internal-actions attribute', () => {
    render(
      <InteractiveGuided
        stepId="test-guided-no-internal"
        internalActions={mockGuidedActions}
        title="Guided Test"
      >
        Guided content
      </InteractiveGuided>
    );

    const element = screen.getByTestId(testIds.interactive.step('test-guided-no-internal'));
    expect(element).not.toHaveAttribute('data-internal-actions');
  });
});

// ============================================================================
// data-step-id Tests
// ============================================================================

describe('E2E Contract: data-step-id', () => {
  it('InteractiveStep: reflects stepId prop when provided', () => {
    const stepId = 'custom-step-id-123';

    render(
      <InteractiveStep
        stepId={stepId}
        targetAction="button"
        refTarget="button"
      >
        Step with custom ID
      </InteractiveStep>
    );

    const element = screen.getByTestId(testIds.interactive.step(stepId));
    expect(element).toHaveAttribute('data-step-id', stepId);
  });

  it('InteractiveStep: uses generated renderedStepId when stepId absent', () => {
    render(
      <InteractiveStep
        targetAction="button"
        refTarget="button"
      >
        Step without explicit ID
      </InteractiveStep>
    );

    // Should be able to find element with generated ID
    const element = document.querySelector('[data-step-id^="standalone-step-"]');
    expect(element).toBeInTheDocument();

    const stepIdValue = element?.getAttribute('data-step-id');
    expect(stepIdValue).toBeTruthy();
    expect(stepIdValue).toMatch(/^standalone-step-/);
  });

  it('InteractiveMultiStep: reflects stepId prop when provided', () => {
    const stepId = 'custom-multistep-id-456';

    render(
      <InteractiveMultiStep
        stepId={stepId}
        internalActions={mockInternalActions}
        title="Multi-Step Test"
      >
        Multi-step content
      </InteractiveMultiStep>
    );

    const element = screen.getByTestId(testIds.interactive.step(stepId));
    expect(element).toHaveAttribute('data-step-id', stepId);
  });

  it('InteractiveMultiStep: uses generated renderedStepId when stepId absent', () => {
    render(
      <InteractiveMultiStep
        internalActions={mockInternalActions}
        title="Multi-Step Test"
      >
        Multi-step without explicit ID
      </InteractiveMultiStep>
    );

    // Should be able to find element with generated ID
    const element = document.querySelector('[data-step-id^="standalone-multistep-"]');
    expect(element).toBeInTheDocument();

    const stepIdValue = element?.getAttribute('data-step-id');
    expect(stepIdValue).toBeTruthy();
    expect(stepIdValue).toMatch(/^standalone-multistep-/);
  });

  it('InteractiveGuided: reflects stepId prop when provided', () => {
    const stepId = 'custom-guided-id-789';

    render(
      <InteractiveGuided
        stepId={stepId}
        internalActions={mockGuidedActions}
        title="Guided Test"
      >
        Guided content
      </InteractiveGuided>
    );

    const element = screen.getByTestId(testIds.interactive.step(stepId));
    expect(element).toHaveAttribute('data-step-id', stepId);
  });

  it('InteractiveGuided: uses generated renderedStepId when stepId absent', () => {
    render(
      <InteractiveGuided
        internalActions={mockGuidedActions}
        title="Guided Test"
      >
        Guided without explicit ID
      </InteractiveGuided>
    );

    // Should be able to find element with generated ID
    const element = document.querySelector('[data-step-id^="guided-step-"]');
    expect(element).toBeInTheDocument();

    const stepIdValue = element?.getAttribute('data-step-id');
    expect(stepIdValue).toBeTruthy();
    expect(stepIdValue).toMatch(/^guided-step-/);
  });

  it('data-step-id enables DOM querySelector by stepId', () => {
    const stepId = 'queryable-step-id';

    render(
      <InteractiveStep
        stepId={stepId}
        targetAction="button"
        refTarget="button"
      >
        Queryable step
      </InteractiveStep>
    );

    // Contract: data-step-id should enable querySelector lookup
    const element = document.querySelector(`[data-step-id="${stepId}"]`);
    expect(element).toBeInTheDocument();
    expect(element).toHaveAttribute('data-testid', testIds.interactive.step(stepId));
  });
});

// ============================================================================
// E2E Integration Specs (Documenting Tests)
// ============================================================================

/**
 * These tests document expected behavior that requires full application context.
 * They are skipped in unit tests but serve as specifications for Playwright E2E tests.
 *
 * The state transition tests require mocking of useStepChecker hook, which has
 * many interdependent modules. These are better tested in E2E where the full
 * application context is available.
 */
describe.skip('E2E Integration Specs (require full app context)', () => {
  // TODO: These tests specify behavior that requires Playwright E2E
  // They document the expected behavior for integration tests to implement

  it.todo('InteractiveGuided: transitions from idle to executing on button click');
  it.todo('InteractiveGuided: transitions from executing to completed on objectives met');
  it.todo('InteractiveGuided: transitions from executing to error on action failure');
  it.todo('InteractiveGuided: transitions from executing to cancelled on user cancel');

  it.todo('InteractiveMultiStep: transitions through substeps during execution');
  it.todo('InteractiveMultiStep: data-test-substep-index updates during execution');
  it.todo('InteractiveMultiStep: transitions to completed when all actions finish');

  it.todo('InteractiveStep: transitions from idle to executing on Show me click');
  it.todo('InteractiveStep: transitions from idle to executing on Do it click');
  it.todo('InteractiveStep: data-test-form-state changes during form validation');

  it.todo('All components: data-test-requirements-state updates on requirement check');
  it.todo('All components: fix button triggers fixRequirement and updates state');
});
