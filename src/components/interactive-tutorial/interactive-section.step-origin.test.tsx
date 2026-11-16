import React from 'react';
import { act, render } from '@testing-library/react';

import { InteractiveStep } from './interactive-step';
import { InteractiveSection, resetInteractiveCounters } from './interactive-section';
import {
  evictSectionCache,
  markStepCompleted,
  resetCompletionStoreForTests,
} from '../../global-state/completion-store';
import { CompletionObservationContext } from '../../global-state/observation/context';
import { CompletionCoordinator } from '../../global-state/observation/coordinator';
import { subscribeProgressEvent, type ProgressEventDetail } from '../../global-state/progress-events';
import { checkRequirements } from '../../requirements-manager/requirements-checker.utils';

const mockRefreshChange = jest.fn();
const mockRefreshOnLoad = jest.fn();
jest.mock('../../global-state/completion-store', () => {
  const actual = jest.requireActual('../../global-state/completion-store');
  return {
    ...actual,
    refreshAndNotifyGuideProgress: (...args: unknown[]) => {
      mockRefreshChange(...args);
      return actual.refreshAndNotifyGuideProgress(...args);
    },
    refreshGuidePercentageOnLoad: (...args: unknown[]) => {
      mockRefreshOnLoad(...args);
      return actual.refreshGuidePercentageOnLoad(...args);
    },
  };
});
jest.mock('../../requirements-manager/requirements-checker.utils', () => ({
  ...jest.requireActual('../../requirements-manager/requirements-checker.utils'),
  checkRequirements: jest.fn(),
}));

const SECTION_ID = 'section-origin';
const FIRST_STEP_ID = `${SECTION_ID}-step-1`;
const SECOND_STEP_ID = `${SECTION_ID}-step-2`;

const section = (
  <InteractiveSection id="origin" title="Section" autoCollapse={false}>
    <InteractiveStep targetAction="highlight" refTarget=".a" objectives="has-datasources">
      First
    </InteractiveStep>
    <InteractiveStep targetAction="highlight" refTarget=".b" objectives="has-datasources">
      Second
    </InteractiveStep>
  </InteractiveSection>
);

const mixedSection = (
  <InteractiveSection id="origin" title="Section" autoCollapse={false}>
    <InteractiveStep targetAction="highlight" refTarget=".a" objectives="has-datasources">
      First
    </InteractiveStep>
    <InteractiveStep targetAction="highlight" refTarget=".b" objectives="has-plugin:grafana-testdata-datasource">
      Second
    </InteractiveStep>
  </InteractiveSection>
);

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
  });

let events: ProgressEventDetail[] = [];
let unsubscribe: () => void = () => {};
let checkPasses: (requirements: string) => boolean = () => true;

const sectionEvents = () => events.filter((event) => event.kind === 'section');

function expectLoad() {
  expect(sectionEvents()).toEqual([expect.objectContaining({ sectionId: SECTION_ID, hydrated: true })]);
  expect(mockRefreshOnLoad).toHaveBeenCalledTimes(1);
  expect(mockRefreshChange).not.toHaveBeenCalled();
}

function expectChange() {
  expect(sectionEvents()).toEqual([expect.objectContaining({ sectionId: SECTION_ID, hydrated: false })]);
  expect(mockRefreshChange).toHaveBeenCalledTimes(1);
  expect(mockRefreshChange.mock.calls[0]![1]).toBe('change');
  expect(mockRefreshOnLoad).not.toHaveBeenCalled();
}

beforeEach(() => {
  localStorage.clear();
  resetCompletionStoreForTests();
  resetInteractiveCounters();
  mockRefreshChange.mockClear();
  mockRefreshOnLoad.mockClear();
  checkPasses = () => true;
  (checkRequirements as unknown as jest.Mock).mockImplementation(async ({ requirements }: { requirements: string }) => {
    const pass = checkPasses(requirements);
    return { requirements, pass, error: [{ requirement: requirements, pass, satisfied: pass }] };
  });
  events = [];
  unsubscribe = subscribeProgressEvent((detail) => events.push(detail));
});

afterEach(() => {
  unsubscribe();
});

describe('a section with no objectives of its own, with passive completion on', () => {
  it('counts as load when every step passes on its first answered check', async () => {
    const coordinator = new CompletionCoordinator(async () => true);
    render(
      <CompletionObservationContext.Provider value={coordinator}>{section}</CompletionObservationContext.Provider>
    );
    act(() => coordinator.start());
    await settle();
    coordinator.stop();

    expectLoad();
  }, 10000);

  it('counts as a change when a step was seen unmet first', async () => {
    let met = false;
    const coordinator = new CompletionCoordinator(async () => met);
    render(
      <CompletionObservationContext.Provider value={coordinator}>{section}</CompletionObservationContext.Provider>
    );
    act(() => coordinator.start());
    await settle();
    expect(sectionEvents()).toEqual([]);

    met = true;
    act(() => coordinator.observe(() => true));
    act(() => coordinator.recheck());
    await settle();
    coordinator.stop();

    expectChange();
  }, 10000);
});

describe('a section with no objectives of its own, with passive completion off', () => {
  it('counts as load when every step passes on its first answered check', async () => {
    render(section);
    await settle();

    expectLoad();
  }, 10000);

  it('counts as a change when the reader completed one step and the other passed on its first check', async () => {
    checkPasses = (requirements) => requirements !== 'has-datasources';
    render(mixedSection);
    await settle();
    expect(sectionEvents()).toEqual([]);

    act(() => markStepCompleted(FIRST_STEP_ID, SECTION_ID, 'manual'));
    await settle();

    expectChange();
  }, 10000);

  it('remembers a reader completion across a cross-tab eviction', async () => {
    checkPasses = () => false;
    render(mixedSection);
    await settle();

    act(() => markStepCompleted(FIRST_STEP_ID, SECTION_ID, 'manual'));
    await settle();
    act(() => evictSectionCache(SECTION_ID));
    await settle();
    expect(sectionEvents()).toEqual([]);

    act(() => markStepCompleted(SECOND_STEP_ID, SECTION_ID, 'objectives', undefined, 'load'));
    await settle();

    expectChange();
  }, 10000);

  it('leaves a section with its own unmet objectives on its existing rule', async () => {
    checkPasses = () => false;
    render(
      <InteractiveSection id="origin" title="Section" objectives="has-datasources" autoCollapse={false}>
        <InteractiveStep targetAction="highlight" refTarget=".a">
          First
        </InteractiveStep>
      </InteractiveSection>
    );
    await settle();

    act(() => markStepCompleted(FIRST_STEP_ID, SECTION_ID, 'objectives', undefined, 'load'));
    await settle();

    expectChange();
  }, 10000);
});
