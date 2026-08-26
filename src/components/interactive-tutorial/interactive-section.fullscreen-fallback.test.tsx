/**
 * The section-driven "Do Section" sequence runner is a structurally distinct
 * path from a standalone step's own "Do it" click (covered in
 * content-renderer.fullscreen-fallback.test.tsx): it reads `fullScreenFallbackLocation`
 * back off the child's own React props via `StepInfo`/`toStepInfoExtension`
 * (step-type-registry.ts) rather than through the click handler's own closure.
 * Neither path exercises the other — this test proves the sequence-runner one,
 * reusing the same shared harness as interactive-section.runner.tripwire.test.tsx.
 */

import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

jest.mock('@grafana/ui', () => {
  return require('../../test-utils/interactive-section-harness').createGrafanaUiMock();
});
jest.mock('@grafana/data', () => {
  return require('../../test-utils/interactive-section-harness').createGrafanaDataMock();
});
jest.mock('../../lib/analytics', () => {
  return require('../../test-utils/interactive-section-harness').createAnalyticsMock();
});
jest.mock('../../constants', () => {
  return require('../../test-utils/interactive-section-harness').createConstantsMock();
});
jest.mock('../../constants/interactive-config', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveConfigMock();
});
jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));
jest.mock('../../lib/faro', () => ({
  withFaroUserAction: jest.fn((_name: string, _attributes: unknown, work: () => unknown) => work()),
  setFaroUserActionAttributes: jest.fn(),
  USER_ACTION_TIMEOUT_LONG_MS: 600000,
}));
jest.mock('../../lib/user-storage', () => {
  return require('../../test-utils/interactive-section-harness').createUserStorageMock();
});
jest.mock('../../global-state/alignment-pending-context', () => {
  return require('../../test-utils/interactive-section-harness').createAlignmentContextMock();
});
jest.mock('../../interactive-engine', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveEngineMock();
});
jest.mock('../../requirements-manager', () => {
  return require('../../test-utils/interactive-section-harness').createRequirementsManagerMock();
});
jest.mock('../../docs-retrieval', () => {
  return require('../../test-utils/interactive-section-harness').createDocsRetrievalMock();
});
jest.mock('./interactive-step', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveStepMock();
});
jest.mock('./interactive-multi-step', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveMultiStepMock();
});
jest.mock('./interactive-guided', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveGuidedMock();
});
jest.mock('./interactive-quiz', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveQuizMock();
});
jest.mock('./terminal-step', () => {
  return require('../../test-utils/interactive-section-harness').createTerminalStepMock();
});
jest.mock('./terminal-connect-step', () => {
  return require('../../test-utils/interactive-section-harness').createTerminalConnectStepMock();
});
jest.mock('./code-block-step', () => {
  return require('../../test-utils/interactive-section-harness').createCodeBlockStepMock();
});
jest.mock('./datasource-check-step', () => {
  return require('../../test-utils/interactive-section-harness').createDatasourceCheckStepMock();
});
jest.mock('./interactive-conditional', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveConditionalMock();
});

import { testIds } from '../../constants/testIds';
import { InteractiveStep } from './interactive-step';
import { InteractiveSection, resetInteractiveCounters } from './interactive-section';
import {
  executeInteractiveActionCalls,
  resetSectionHarness,
  silenceSectionWarnings,
} from '../../test-utils/interactive-section-harness';

const SECTION_ID = 'section-fullscreen-fallback';
const doSectionBtn = (id: string) => testIds.interactive.doSectionButton(id);

let warnSpy: jest.SpyInstance;
beforeAll(() => {
  warnSpy = silenceSectionWarnings();
});
afterAll(() => {
  warnSpy.mockRestore();
});

beforeEach(() => {
  resetSectionHarness();
  resetInteractiveCounters();
});

afterEach(() => {
  cleanup();
});

describe('"Do Section" threads fullScreenFallbackLocation through StepInfo', () => {
  it('reaches executeInteractiveAction when the section is run via "Do Section"', async () => {
    render(
      <InteractiveSection id="fullscreen-fallback" title="Section" autoCollapse={false}>
        <InteractiveStep targetAction="highlight" refTarget=".a" fullScreenFallbackLocation="/connections">
          Step 1
        </InteractiveStep>
      </InteractiveSection>
    );

    await waitFor(() => expect(screen.getByTestId(doSectionBtn(SECTION_ID))).toBeInTheDocument());
    act(() => {
      screen.getByTestId(doSectionBtn(SECTION_ID)).click();
    });

    // The section's own choreography may call executeInteractiveAction more
    // than once per step (e.g. a show phase ahead of the 'do' phase) — assert
    // on the 'do' call specifically, not call count.
    await waitFor(() => expect(executeInteractiveActionCalls.some((c) => (c as any).buttonType === 'do')).toBe(true));
    const doCall = executeInteractiveActionCalls.find((c) => (c as any).buttonType === 'do');
    expect(doCall).toMatchObject({ fullScreenFallbackLocation: '/connections' });
  });

  it('leaves it undefined when the child step carries no fallback location', async () => {
    render(
      <InteractiveSection id="fullscreen-fallback" title="Section" autoCollapse={false}>
        <InteractiveStep targetAction="highlight" refTarget=".a">
          Step 1
        </InteractiveStep>
      </InteractiveSection>
    );

    await waitFor(() => expect(screen.getByTestId(doSectionBtn(SECTION_ID))).toBeInTheDocument());
    act(() => {
      screen.getByTestId(doSectionBtn(SECTION_ID)).click();
    });

    await waitFor(() => expect(executeInteractiveActionCalls.some((c) => (c as any).buttonType === 'do')).toBe(true));
    const doCall = executeInteractiveActionCalls.find((c) => (c as any).buttonType === 'do');
    expect(doCall).toMatchObject({ fullScreenFallbackLocation: undefined });
  });
});
