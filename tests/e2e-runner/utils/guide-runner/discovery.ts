import type { Locator, Page } from '@playwright/test';

import { CURRENT_STEP_SELECTOR, LEGACY_STEP_SELECTOR, STEP_TESTID_PREFIX } from './constants';
import { getStepDriver, isStepTypeKind, resolveLegacyStepKind } from './drivers';
import { calculateStepTimeout } from './execution';
import type { StepContractSource, StepCoverage, StepDiscoveryResult, StepTestResult, TestableStep } from './types';

interface DiscoveryRoots {
  contractSource: StepContractSource;
  roots: Locator[];
}

async function selectDiscoveryRoots(page: Page): Promise<DiscoveryRoots> {
  const currentRoots = await page.locator(CURRENT_STEP_SELECTOR).all();
  if (currentRoots.length > 0) {
    return { contractSource: 'current', roots: currentRoots };
  }
  return {
    contractSource: 'legacy',
    roots: await page.locator(LEGACY_STEP_SELECTOR).all(),
  };
}

async function readRootIdentity(
  root: Locator,
  contractSource: StepContractSource,
  index: number
): Promise<{ stepKind: string; stepId: string }> {
  if (contractSource === 'current') {
    return {
      stepKind: (await root.getAttribute('data-test-step-kind')) ?? 'unknown',
      stepId: (await root.getAttribute('data-test-step-id')) ?? `unknown-${index}`,
    };
  }

  const dataTestId = await root.getAttribute('data-testid');
  return {
    stepKind: await resolveLegacyStepKind(root),
    stepId: dataTestId?.replace(STEP_TESTID_PREFIX, '') ?? `unknown-${index}`,
  };
}

async function findParentSectionId(root: Locator): Promise<string | undefined> {
  const sectionId = await root.evaluate((element) => {
    const section = element.closest('[data-testid^="interactive-section-"]');
    return section?.getAttribute('data-testid')?.replace('interactive-section-', '') ?? null;
  });
  return sectionId ?? undefined;
}

export async function discoverStepsFromDOM(page: Page): Promise<StepDiscoveryResult> {
  const startedAt = Date.now();
  const { contractSource, roots } = await selectDiscoveryRoots(page);
  const steps: TestableStep[] = [];
  const unsupportedSteps: StepCoverage['unsupportedSteps'] = [];

  for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) {
    const root = roots[rootIndex];
    const { stepKind, stepId } = await readRootIdentity(root, contractSource, rootIndex);
    if (!isStepTypeKind(stepKind)) {
      unsupportedSteps.push({ stepKind, stepId });
      continue;
    }

    const driver = getStepDriver(stepKind);
    if (!driver.supported) {
      unsupportedSteps.push({ stepKind, stepId });
      continue;
    }

    await root.scrollIntoViewIfNeeded().catch(() => undefined);
    const inspected = await driver.inspect(page, root, stepId);
    steps.push({
      stepKind,
      stepId,
      index: steps.length,
      sectionId: await findParentSectionId(root),
      ...inspected,
      locator: root,
    });
  }

  const coverage: StepCoverage = {
    contractSource,
    rendered: roots.length,
    supported: steps.length,
    executed: 0,
    unsupported: unsupportedSteps.length,
    unsupportedSteps,
  };

  return {
    steps,
    totalSteps: steps.length,
    preCompletedCount: steps.filter((step) => step.isPreCompleted).length,
    noDoItButtonCount: steps.filter((step) => !step.hasDoItButton).length,
    durationMs: Date.now() - startedAt,
    coverage,
  };
}

export function withExecutedCoverage(coverage: StepCoverage, results: StepTestResult[]): StepCoverage {
  const executedStepIds = new Set(
    results.filter((result) => result.status !== 'not_reached').map((result) => result.stepId)
  );
  return {
    ...coverage,
    executed: executedStepIds.size,
  };
}

export function logDiscoveryResults(result: StepDiscoveryResult, verbose = false): void {
  console.log(`\n📋 Step discovery results`);
  console.log(`   Contract: ${result.coverage.contractSource}`);
  console.log(`   Rendered roots: ${result.coverage.rendered}`);
  console.log(`   Supported steps: ${result.coverage.supported}`);
  console.log(`   Unsupported steps: ${result.coverage.unsupported}`);
  console.log(`   Pre-completed: ${result.preCompletedCount}`);
  console.log(`   Without "Do it": ${result.noDoItButtonCount}`);
  console.log(`   Discovery time: ${result.durationMs}ms`);

  if (verbose) {
    for (const step of result.steps) {
      console.log(
        `   ${step.index + 1}. ${step.stepId} [${step.stepKind}] timeout:${Math.round(calculateStepTimeout(step) / 1000)}s`
      );
    }
    for (const unsupported of result.coverage.unsupportedSteps) {
      console.log(`   Unsupported: ${unsupported.stepId} [${unsupported.stepKind}]`);
    }
  }
}
