/**
 * Baseline behavioral tests for InteractiveSection.
 *
 * Lifecycle: **disposable** — These tests exist to catch regressions during
 * the interactive-section refactor. They may be replaced or deleted once
 * permanent post-extraction unit tests provide equivalent or better coverage.
 *
 * These tests verify rendering and behavioral contracts from the outside.
 * They intentionally do NOT test implementation details (internal state,
 * refs, effect ordering, etc.).
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { InteractiveSection } from './interactive-section';
import { InteractiveStep } from './interactive-step';
import { testIds } from '../../../components/testIds';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the interactive engine — InteractiveSection depends on useInteractiveElements
jest.mock('../../../interactive-engine', () => ({
  useInteractiveElements: () => ({
    executeInteractiveAction: jest.fn().mockResolvedValue(undefined),
    startSectionBlocking: jest.fn(),
    stopSectionBlocking: jest.fn(),
    verifyStepResult: jest.fn().mockResolvedValue({ pass: true }),
    checkRequirementsFromData: jest.fn().mockResolvedValue({ pass: true }),
  }),
  ActionMonitor: {
    getInstance: () => ({
      enable: jest.fn(),
      disable: jest.fn(),
      forceDisable: jest.fn(),
      forceEnable: jest.fn(),
    }),
  },
}));

// Mock the requirements manager — useStepChecker is used for objectives checking
jest.mock('../../../requirements-manager', () => ({
  useStepChecker: () => ({
    completionReason: 'none',
    isCompleted: false,
    isChecking: false,
  }),
  SequentialRequirementsManager: {
    getInstance: () => ({
      triggerReactiveCheck: jest.fn(),
      watchNextStep: jest.fn(),
      stopDOMMonitoring: jest.fn(),
      startDOMMonitoring: jest.fn(),
      updateStep: jest.fn(),
    }),
  },
}));

// Mock user storage — avoid real localStorage in tests
jest.mock('../../../lib/user-storage', () => ({
  interactiveStepStorage: {
    getCompleted: jest.fn().mockResolvedValue(new Set()),
    setCompleted: jest.fn(),
    countAllCompleted: jest.fn().mockReturnValue(0),
    clear: jest.fn(),
  },
  sectionCollapseStorage: {
    get: jest.fn().mockResolvedValue(false),
    set: jest.fn(),
    clear: jest.fn(),
  },
  interactiveCompletionStorage: {
    set: jest.fn(),
  },
}));

// Mock analytics
jest.mock('../../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { DoSectionButtonClick: 'DoSectionButtonClick' },
  getSourceDocument: jest.fn().mockReturnValue({ source_document: 'test', step_id: '' }),
  calculateStepCompletion: jest.fn().mockReturnValue(0),
}));

// Mock Grafana dependencies
// @grafana/ui's deep dependency graph (BarGauge → d3-scale) triggers errors in jsdom.
jest.mock('@grafana/ui', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

jest.mock('@grafana/data', () => ({
  usePluginContext: () => ({ meta: { jsonData: {} } }),
}));

jest.mock('@grafana/runtime', () => ({
  config: {
    namespace: '',
    bootData: { user: null },
    buildInfo: { version: '10.0.0', env: 'production' },
  },
  locationService: { getLocation: jest.fn() },
}));

// Mock InteractiveStep as a thin component.
// InteractiveSection identifies step children via `child.type === InteractiveStep`,
// so the mock must be the *same reference* that is re-exported by the module.
// Using forwardRef to match the real component's signature.
jest.mock('./interactive-step', () => {
  const React = require('react');
  const MockStep = React.forwardRef(({ children, stepId, ...rest }: any, _ref: any) => (
    <li
      className="interactive-step"
      data-testid={`interactive-step-${stepId || 'auto'}`}
      data-step-id={stepId}
      data-targetaction={rest.targetAction}
    >
      {children}
    </li>
  ));
  MockStep.displayName = 'InteractiveStep';
  return {
    InteractiveStep: MockStep,
    resetStepCounter: jest.fn(),
  };
});

// Mock sibling step types (InteractiveSection also checks their .type)
jest.mock('./interactive-multi-step', () => ({
  InteractiveMultiStep: () => null,
  resetMultiStepCounter: jest.fn(),
}));

jest.mock('./interactive-guided', () => ({
  InteractiveGuided: () => null,
  resetGuidedCounter: jest.fn(),
}));

jest.mock('./interactive-quiz', () => ({
  InteractiveQuiz: () => null,
  resetQuizCounter: jest.fn(),
}));

// Mock config
jest.mock('../../../constants', () => ({
  getConfigWithDefaults: () => ({}),
}));

jest.mock('../../../constants/interactive-config', () => ({
  INTERACTIVE_CONFIG: {
    delays: {
      section: {
        showPhaseIterations: 1,
        baseInterval: 10,
        betweenStepsIterations: 1,
      },
    },
  },
  getInteractiveConfig: () => ({
    autoDetection: { enabled: false },
  }),
}));

// Mock content key
jest.mock('./get-content-key', () => ({
  getContentKey: () => 'test-content-key',
}));

// ---------------------------------------------------------------------------
// Rendering contracts
// ---------------------------------------------------------------------------

describe('InteractiveSection — rendering contracts (disposable baseline)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders the section container with correct test ID', () => {
    render(
      <InteractiveSection title="Test section" id="test-render">
        <InteractiveStep targetAction="button" refTarget="button">
          Step 1
        </InteractiveStep>
      </InteractiveSection>
    );

    const section = screen.getByTestId(testIds.interactive.section('section-test-render'));
    expect(section).toBeInTheDocument();
    expect(section).toHaveAttribute('data-interactive-section', 'true');
  });

  it('renders the section title', () => {
    render(
      <InteractiveSection title="My tutorial section" id="title-test">
        <InteractiveStep targetAction="button" refTarget="button">
          Step 1
        </InteractiveStep>
      </InteractiveSection>
    );

    expect(screen.getByText('My tutorial section')).toBeInTheDocument();
  });

  it('renders the section description when provided', () => {
    render(
      <InteractiveSection title="Section" description="Learn how to do this" id="desc-test">
        <InteractiveStep targetAction="button" refTarget="button">
          Step 1
        </InteractiveStep>
      </InteractiveSection>
    );

    expect(screen.getByText('Learn how to do this')).toBeInTheDocument();
  });

  it('renders child step content', () => {
    render(
      <InteractiveSection title="Section" id="children-test">
        <InteractiveStep targetAction="button" refTarget="button">
          Click the save button
        </InteractiveStep>
        <InteractiveStep targetAction="highlight" refTarget="div.panel">
          Find the panel
        </InteractiveStep>
      </InteractiveSection>
    );

    expect(screen.getByText('Click the save button')).toBeInTheDocument();
    expect(screen.getByText('Find the panel')).toBeInTheDocument();
  });

  it('renders hints icon when hints are provided', () => {
    render(
      <InteractiveSection title="Section" hints="This is a helpful hint" id="hints-test">
        <InteractiveStep targetAction="button" refTarget="button">
          Step 1
        </InteractiveStep>
      </InteractiveSection>
    );

    // The hint renders as an ⓘ icon inside a span with a title attribute
    const hintSpan = screen.getByText('ⓘ');
    expect(hintSpan).toBeInTheDocument();
    expect(hintSpan).toHaveAttribute('title', 'This is a helpful hint');
  });

  it('renders the Do Section button with step count', () => {
    render(
      <InteractiveSection title="Section" id="button-test">
        <InteractiveStep targetAction="button" refTarget="button">
          Step 1
        </InteractiveStep>
        <InteractiveStep targetAction="button" refTarget="button">
          Step 2
        </InteractiveStep>
        <InteractiveStep targetAction="button" refTarget="button">
          Step 3
        </InteractiveStep>
      </InteractiveSection>
    );

    const doButton = screen.getByTestId(testIds.interactive.doSectionButton('section-button-test'));
    expect(doButton).toBeInTheDocument();
    expect(doButton).toHaveTextContent('Do Section (3 steps)');
  });

  it('generates a section ID from the HTML id attribute', () => {
    render(
      <InteractiveSection title="Section" id="my-custom-id">
        <InteractiveStep targetAction="button" refTarget="button">
          Step 1
        </InteractiveStep>
      </InteractiveSection>
    );

    // Section ID should be "section-my-custom-id"
    expect(screen.getByTestId(testIds.interactive.section('section-my-custom-id'))).toBeInTheDocument();
  });

  it('applies custom className to the section container', () => {
    render(
      <InteractiveSection title="Section" id="class-test" className="my-custom-class">
        <InteractiveStep targetAction="button" refTarget="button">
          Step 1
        </InteractiveStep>
      </InteractiveSection>
    );

    const section = screen.getByTestId(testIds.interactive.section('section-class-test'));
    expect(section.className).toContain('my-custom-class');
  });

  it('generates a fallback section ID when no id prop is provided', () => {
    render(
      <InteractiveSection title="Fallback section">
        <InteractiveStep targetAction="button" refTarget="button">
          Step 1
        </InteractiveStep>
      </InteractiveSection>
    );

    // Without an id prop, the section falls back to section-{nextSectionCounter()}
    // The counter is 1-based, so the first render gets section-1
    const section = screen.getByTestId(testIds.interactive.section('section-1'));
    expect(section).toBeInTheDocument();
    expect(section).toHaveAttribute('data-interactive-section', 'true');
  });

  it('renders non-step children as-is (passthrough)', () => {
    render(
      <InteractiveSection title="Section" id="passthrough-test">
        <p>Informational paragraph</p>
        <InteractiveStep targetAction="button" refTarget="button">
          Step 1
        </InteractiveStep>
      </InteractiveSection>
    );

    expect(screen.getByText('Informational paragraph')).toBeInTheDocument();
    expect(screen.getByText('Step 1')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Prop injection contracts (canary for Phase 3 enhanceChildren extraction)
// ---------------------------------------------------------------------------

describe('InteractiveSection — prop injection (disposable baseline)', () => {
  it('injects coordination props into InteractiveStep children', () => {
    // Render a section with a single step
    render(
      <InteractiveSection title="Section" id="prop-test">
        <InteractiveStep targetAction="button" refTarget="button">
          Step 1
        </InteractiveStep>
      </InteractiveSection>
    );

    // The mock InteractiveStep renders as <li> with data attributes.
    // The key props we care about are passed via cloneElement. Since our mock
    // renders data-step-id={stepId}, we can verify stepId injection.
    const stepEl = screen.getByTestId('interactive-step-section-prop-test-step-1');
    expect(stepEl).toBeInTheDocument();

    // stepId is injected and rendered via our mock's data-step-id
    expect(stepEl).toHaveAttribute('data-step-id', 'section-prop-test-step-1');
  });

  it('injects all expected coordination props (verified via mock inspection)', () => {
    // We verify the props indirectly through what the mock renders.
    // The real contract is that these props are set by cloneElement.
    // We verify the most critical ones that are observable:
    render(
      <InteractiveSection title="Coordination" id="inject-test">
        <InteractiveStep targetAction="button" refTarget="button">
          Step 1
        </InteractiveStep>
      </InteractiveSection>
    );

    const stepEl = screen.getByTestId('interactive-step-section-inject-test-step-1');

    // The mock renders data-step-id from stepId prop
    expect(stepEl).toHaveAttribute('data-step-id', 'section-inject-test-step-1');

    // The mock renders data-targetaction from the original prop passthrough
    expect(stepEl).toHaveAttribute('data-targetaction', 'button');

    // The step should be rendered inside the section's ordered list
    expect(stepEl.closest('ol.interactive-section-content')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Disabled state
// ---------------------------------------------------------------------------

describe('InteractiveSection — disabled state (disposable baseline)', () => {
  it('disables the Do Section button when disabled=true', () => {
    render(
      <InteractiveSection title="Section" id="disabled-test" disabled>
        <InteractiveStep targetAction="button" refTarget="button">
          Step 1
        </InteractiveStep>
      </InteractiveSection>
    );

    const doButton = screen.getByTestId(testIds.interactive.doSectionButton('section-disabled-test'));
    expect(doButton).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Collapse/expand behavior
// ---------------------------------------------------------------------------

describe('InteractiveSection — collapse toggle (disposable baseline)', () => {
  it('does not show collapse toggle when section is not completed', () => {
    render(
      <InteractiveSection title="Section" id="collapse-test">
        <InteractiveStep targetAction="button" refTarget="button">
          Step 1
        </InteractiveStep>
      </InteractiveSection>
    );

    // Toggle button should not be present on incomplete section
    expect(screen.queryByTitle('Collapse section')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Expand section')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Requirements banner
// ---------------------------------------------------------------------------

describe('InteractiveSection — requirements banner (disposable baseline)', () => {
  it('does not show requirements banner when no requirements specified', () => {
    render(
      <InteractiveSection title="Section" id="no-req-test">
        <InteractiveStep targetAction="button" refTarget="button">
          Step 1
        </InteractiveStep>
      </InteractiveSection>
    );

    expect(screen.queryByText('Requirements not yet met')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Step coordination contracts
// ---------------------------------------------------------------------------

describe('InteractiveSection — step coordination (disposable baseline)', () => {
  it('assigns stepId to child InteractiveStep components', () => {
    render(
      <InteractiveSection title="Section" id="coord-test">
        <InteractiveStep targetAction="button" refTarget="button">
          Step 1
        </InteractiveStep>
        <InteractiveStep targetAction="button" refTarget="button">
          Step 2
        </InteractiveStep>
      </InteractiveSection>
    );

    // The section assigns stepIds like "section-coord-test-step-1", "section-coord-test-step-2"
    expect(screen.getByTestId(testIds.interactive.step('section-coord-test-step-1'))).toBeInTheDocument();
    expect(screen.getByTestId(testIds.interactive.step('section-coord-test-step-2'))).toBeInTheDocument();
  });

  it('renders steps inside an ordered list', () => {
    render(
      <InteractiveSection title="Section" id="ol-test">
        <InteractiveStep targetAction="button" refTarget="button">
          Step 1
        </InteractiveStep>
      </InteractiveSection>
    );

    const section = screen.getByTestId(testIds.interactive.section('section-ol-test'));
    const ol = section.querySelector('ol.interactive-section-content');
    expect(ol).toBeInTheDocument();
  });
});
