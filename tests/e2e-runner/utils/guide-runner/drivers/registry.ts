import type { Locator, Page } from '@playwright/test';

import {
  STEP_TYPE_KIND_KEYS,
  type StepTypeKind,
} from '../../../../../src/components/interactive-tutorial/step-type-registry';
import { DEFAULT_STEP_TIMEOUT_MS, TIMEOUT_PER_GUIDED_SUBSTEP_MS, TIMEOUT_PER_MULTISTEP_ACTION_MS } from '../constants';
import type { TestableStep } from '../types';
import { clickSkipButtonAndSync, executeStandardStep, inspectCommonStep, isStepComplete } from './shared';
import { executeGuidedStep } from './guided';
import type { StepDriver, StepDriverInspection } from './types';

async function inspectPlain(page: Page, root: Locator, stepId: string): Promise<StepDriverInspection> {
  return {
    ...(await inspectCommonStep(page, root, stepId)),
    isMultistep: false,
    internalActionCount: 0,
    isGuided: false,
  };
}

async function inspectMultistep(page: Page, root: Locator, stepId: string): Promise<StepDriverInspection> {
  const common = await inspectCommonStep(page, root, stepId);
  const rawActions = await root.getAttribute('data-internal-actions');
  let internalActionCount = 3;
  if (rawActions) {
    try {
      const actions = JSON.parse(rawActions);
      internalActionCount = Array.isArray(actions) ? actions.length : 0;
    } catch {
      internalActionCount = 3;
    }
  }
  return {
    ...common,
    isMultistep: true,
    internalActionCount,
    isGuided: false,
  };
}

async function inspectGuided(page: Page, root: Locator, stepId: string): Promise<StepDriverInspection> {
  const common = await inspectCommonStep(page, root, stepId);
  const rawTotal = await root.getAttribute('data-test-substep-total');
  const parsedTotal = rawTotal ? Number.parseInt(rawTotal, 10) : Number.NaN;
  return {
    ...common,
    isMultistep: false,
    internalActionCount: 0,
    isGuided: true,
    guidedStepCount: Number.isFinite(parsedTotal) && parsedTotal >= 1 ? parsedTotal : 1,
  };
}

function supportedDriver(
  kind: 'plain' | 'multistep' | 'guided',
  inspect: StepDriver['inspect'],
  timeout: StepDriver['timeout'],
  execute: StepDriver['execute']
): StepDriver {
  return {
    kind,
    supported: true,
    inspect,
    timeout,
    completionState: isStepComplete,
    skip: clickSkipButtonAndSync,
    execute,
  };
}

function unsupportedDriver(kind: Exclude<StepTypeKind, 'plain' | 'multistep' | 'guided'>): StepDriver {
  const unsupported = (): never => {
    throw new Error(`Step kind "${kind}" does not have an E2E driver`);
  };
  return {
    kind,
    supported: false,
    inspect: unsupported,
    timeout: () => DEFAULT_STEP_TIMEOUT_MS,
    completionState: unsupported,
    skip: unsupported,
    execute: unsupported,
  };
}

const drivers = [
  supportedDriver('plain', inspectPlain, () => DEFAULT_STEP_TIMEOUT_MS, executeStandardStep),
  supportedDriver(
    'multistep',
    inspectMultistep,
    (step) =>
      DEFAULT_STEP_TIMEOUT_MS +
      (step.internalActionCount > 0 ? step.internalActionCount * TIMEOUT_PER_MULTISTEP_ACTION_MS : 0),
    executeStandardStep
  ),
  supportedDriver(
    'guided',
    inspectGuided,
    (step) =>
      DEFAULT_STEP_TIMEOUT_MS +
      (step.guidedStepCount && step.guidedStepCount > 0 ? step.guidedStepCount * TIMEOUT_PER_GUIDED_SUBSTEP_MS : 0),
    executeGuidedStep
  ),
  unsupportedDriver('quiz'),
  unsupportedDriver('terminal'),
  unsupportedDriver('terminal-connect'),
  unsupportedDriver('codeblock'),
  unsupportedDriver('challenge'),
  unsupportedDriver('datasource-check'),
] as const satisfies readonly StepDriver[];

export const STEP_DRIVERS: ReadonlyMap<StepTypeKind, StepDriver> = new Map(
  drivers.map((driver) => [driver.kind, driver])
);

export function isStepTypeKind(value: string): value is StepTypeKind {
  return (STEP_TYPE_KIND_KEYS as readonly string[]).includes(value);
}

export function getStepDriver(kind: StepTypeKind): StepDriver {
  const driver = STEP_DRIVERS.get(kind);
  if (!driver) {
    throw new Error(`No E2E driver is registered for step kind "${kind}"`);
  }
  return driver;
}

export async function resolveLegacyStepKind(root: Locator): Promise<StepTypeKind> {
  const targetAction = (await root.getAttribute('data-targetaction')) ?? undefined;
  if (targetAction === 'multistep') {
    return 'multistep';
  }
  const rawTotal = await root.getAttribute('data-test-substep-total');
  const hasSubsteps = rawTotal !== null && rawTotal !== '' && Number.parseInt(rawTotal, 10) >= 1;
  if (targetAction === 'guided' || (hasSubsteps && !targetAction)) {
    return 'guided';
  }
  return 'plain';
}

export function stepTimeout(step: TestableStep): number {
  return getStepDriver(step.stepKind).timeout(step);
}
