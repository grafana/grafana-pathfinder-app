/**
 * Header-label contract: an author-supplied title is preserved verbatim.
 * Otherwise the header is "Interactive section" when interactive steps
 * exist, or "Steps" when every child is passive/noop.
 */

import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';

// ─── Mocks (shared harness) ─────────────────────────────────────────────────

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

jest.mock('../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), exception: jest.fn() },
}));
jest.mock('../../lib/faro', () => ({
  withFaroUserAction: jest.fn((_name: string, _attributes: unknown, work: () => unknown) => work()),
  setFaroUserActionAttributes: jest.fn(),
  USER_ACTION_TIMEOUT_LONG_MS: 600000,
}));

jest.mock('../../constants/interactive-config', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveConfigMock();
});

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

jest.mock('./interactive-conditional', () => {
  return require('../../test-utils/interactive-section-harness').createInteractiveConditionalMock();
});

// ─── Imports after mocks ────────────────────────────────────────────────────

import { InteractiveStep } from './interactive-step';
import {
  DEFAULT_INTERACTIVE_SECTION_TITLE,
  InteractiveSection,
  PASSIVE_SECTION_TITLE,
  resetInteractiveCounters,
} from './interactive-section';
import { resetSectionHarness, silenceSectionWarnings } from '../../test-utils/interactive-section-harness';

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

function getHeaderTitle(): string {
  const headers = document.querySelectorAll('.interactive-section-title');
  expect(headers.length).toBeGreaterThan(0);
  return headers[0]!.textContent ?? '';
}

describe('InteractiveSection — header label semantics', () => {
  it('shows "Steps" when the title is the default fallback and the section has no interactive steps', async () => {
    render(
      <InteractiveSection id="passive-default" title={DEFAULT_INTERACTIVE_SECTION_TITLE} autoCollapse={false}>
        <p>Read me — no actions here.</p>
      </InteractiveSection>
    );

    await waitFor(() => expect(document.querySelector('.interactive-section-title')).toBeInTheDocument());
    expect(getHeaderTitle()).toBe(PASSIVE_SECTION_TITLE);
  });

  it('shows "Steps" when the section is composed entirely of noop steps under the default title', async () => {
    render(
      <InteractiveSection id="noop-default" title={DEFAULT_INTERACTIVE_SECTION_TITLE} autoCollapse={false}>
        <InteractiveStep targetAction="noop" refTarget="info-1">
          Informational only.
        </InteractiveStep>
        <InteractiveStep targetAction="noop" refTarget="info-2">
          Still informational.
        </InteractiveStep>
      </InteractiveSection>
    );

    await waitFor(() => expect(document.querySelector('.interactive-section-title')).toBeInTheDocument());
    expect(getHeaderTitle()).toBe(PASSIVE_SECTION_TITLE);
  });

  it('keeps "Interactive section" when the default title is paired with at least one interactive step', async () => {
    render(
      <InteractiveSection id="interactive-default" title={DEFAULT_INTERACTIVE_SECTION_TITLE} autoCollapse={false}>
        <InteractiveStep targetAction="highlight" refTarget=".a">
          Click me.
        </InteractiveStep>
      </InteractiveSection>
    );

    await waitFor(() => expect(document.querySelector('.interactive-section-title')).toBeInTheDocument());
    expect(getHeaderTitle()).toBe(DEFAULT_INTERACTIVE_SECTION_TITLE);
  });

  it('preserves an author-set title verbatim even when the section is fully passive', async () => {
    render(
      <InteractiveSection id="passive-authored" title="Read this carefully" autoCollapse={false}>
        <p>Background reading.</p>
      </InteractiveSection>
    );

    await waitFor(() => expect(document.querySelector('.interactive-section-title')).toBeInTheDocument());
    expect(getHeaderTitle()).toBe('Read this carefully');
  });
});
