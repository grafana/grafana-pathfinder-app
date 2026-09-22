import { expect, type Locator, type Page } from '@playwright/test';

import { testIds } from '../../../../../src/constants/testIds';
import { dismissBadgeCelebrations } from '../badge-celebrations';
import {
  COMPLETION_POLL_INTERVAL_MS,
  DEFAULT_STEP_TIMEOUT_MS,
  REQUIREMENTS_CHECK_TIMEOUT_MS,
  SKIP_SYNC_TIMEOUT_MS,
} from '../constants';
import type { StepDriver } from './types';

function dataCheckRoot(page: Page, stepId: string) {
  return page.getByTestId(testIds.dataCheck.step(stepId));
}

async function readCheck(root: Locator, timeout: number) {
  const status = await root.evaluate(
    (el) => ({
      stepState: el.getAttribute('data-test-step-state'),
      checkState: el.getAttribute('data-test-datasource-check-state'),
      selected: el.getAttribute('data-test-datasource-selected'),
      count: el.getAttribute('data-test-datasource-count'),
      loading: el.getAttribute('data-test-datasource-loading'),
      canRun: el.getAttribute('data-test-datasource-can-run'),
    }),
    undefined,
    { timeout }
  );
  const count = Number(status.count);
  if (
    status.selected === null ||
    status.count === null ||
    !Number.isInteger(count) ||
    count < 0 ||
    !['idle', 'checking', 'passed', 'no-data', 'error'].includes(status.checkState ?? '') ||
    !['true', 'false'].includes(status.loading ?? '') ||
    !['true', 'false'].includes(status.canRun ?? '')
  ) {
    throw new Error('Data source checks require a Pathfinder build with the datasource-check runner DOM contract.');
  }
  return { ...status, count, loading: status.loading === 'true', canRun: status.canRun === 'true' };
}

async function selectOnlyDatasource(page: Page, root: Locator, stepId: string, deadline: number) {
  const remaining = () => Math.max(1, deadline - Date.now());
  const picker = root.getByTestId(testIds.dataCheck.datasourcePicker(stepId));
  await dismissBadgeCelebrations(page);
  await picker.click({ timeout: remaining() });
  // Grafana renders the listbox in a portal; bind it to this picker's accessible control.
  const menuId = await picker.getAttribute('aria-controls', { timeout: remaining() });
  if (!menuId) {
    throw new Error(`Data source step ${stepId} has no linked picker menu.`);
  }
  const options = page.locator(`[id=${JSON.stringify(menuId)}]`).getByRole('option');
  await expect(options).toHaveCount(1, { timeout: remaining() });
  await options.first().click({ timeout: remaining() });
  await expect(root).not.toHaveAttribute('data-test-datasource-selected', '', { timeout: remaining() });
}

export const datasourceCheckDriver: StepDriver = {
  kind: 'datasource-check',
  supported: true,
  root: dataCheckRoot,
  detachmentCompletes: false,
  timeout: () => DEFAULT_STEP_TIMEOUT_MS,
  async inspect(page, root, stepId) {
    return {
      actionCount: 0,
      targetAction: 'datasource-check',
      skippable: (await root.getAttribute('data-test-skippable')) === 'true',
      isPreCompleted: (await root.getAttribute('data-test-step-state')) === 'completed',
      hasDoItButton: (await page.getByTestId(testIds.dataCheck.runQueryButton(stepId)).count()) > 0,
      hasShowMeButton: false,
    };
  },
  async completionState(page, stepId) {
    const root = dataCheckRoot(page, stepId);
    return (
      (await root.getAttribute('data-test-step-state')) === 'completed' &&
      (await root.getAttribute('data-test-datasource-check-state')) === 'passed'
    );
  },
  async checkRequirements({ page, step, timeout }) {
    const root = dataCheckRoot(page, step.stepId);
    const deadline = Date.now() + Math.min(timeout, REQUIREMENTS_CHECK_TIMEOUT_MS);
    const remaining = () => Math.max(1, deadline - Date.now());
    let status;
    while (true) {
      if (Date.now() >= deadline) {
        throw new Error(`Data source step ${step.stepId} requirements or saved selection did not settle.`);
      }
      status = await readCheck(root, remaining());
      if (!status.loading && status.stepState !== 'checking') {
        break;
      }
      await page.waitForTimeout(Math.min(COMPLETION_POLL_INTERVAL_MS, remaining()));
    }
    let explanation: string | undefined;
    if (status.stepState === 'requirements-unmet') {
      const message = root.getByTestId(testIds.interactive.requirementCheck(step.stepId));
      explanation = (await message.count()) > 0 ? (await message.textContent())?.trim() : undefined;
      explanation ||= 'Complete the data source check prerequisites.';
    } else if (status.count === 0) {
      explanation = 'No data sources match the authored filter.';
    } else if (!status.selected && status.count > 1) {
      explanation = 'Select a data source before this run; the runner will not choose between multiple sources.';
    } else {
      if (!status.selected) {
        await selectOnlyDatasource(page, root, step.stepId, deadline);
        status = await readCheck(root, remaining());
      }
      if (!status.canRun) {
        explanation = 'The selected data source or authored query cannot run this check.';
      }
    }
    const unmet = !!explanation;
    return {
      requirements: {
        requirementsMet: !unmet,
        status: unmet ? 'unmet' : 'met',
        hasFixButton: false,
        hasRetryButton: false,
        hasSkipButton: (await root.getByTestId(testIds.dataCheck.skipButton(step.stepId)).count()) > 0,
        skippable: step.skippable,
        isChecking: false,
        explanationText: explanation,
      },
    };
  },
  async skip(page, stepId, timeout = SKIP_SYNC_TIMEOUT_MS) {
    const root = dataCheckRoot(page, stepId);
    await dismissBadgeCelebrations(page);
    await root.getByTestId(testIds.dataCheck.skipButton(stepId)).click({ timeout });
    await expect(root).toHaveAttribute('data-test-step-state', 'completed', { timeout });
  },
  async execute({ page, step, timeout }) {
    const root = dataCheckRoot(page, step.stepId);
    const deadline = Date.now() + timeout;
    const remaining = () => Math.max(1, deadline - Date.now());
    const initial = await readCheck(root, remaining());
    if (initial.loading || !initial.selected || !initial.canRun || initial.stepState === 'requirements-unmet') {
      throw new Error(`Data source step ${step.stepId} is not ready to run.`);
    }
    if (initial.checkState !== 'checking') {
      await dismissBadgeCelebrations(page);
      await root.getByTestId(testIds.dataCheck.runQueryButton(step.stepId)).click({ timeout: remaining() });
    }
    while (Date.now() < deadline) {
      const status = await readCheck(root, remaining());
      if (status.selected !== initial.selected || status.loading) {
        throw new Error(`Data source step ${step.stepId} changed selection before completion.`);
      }
      if (status.checkState === 'no-data' || status.checkState === 'error') {
        const message = root.getByTestId(testIds.dataCheck.failure(step.stepId));
        const detail = (await message.count()) > 0 ? (await message.textContent())?.trim() : undefined;
        throw new Error(detail || `Data source step ${step.stepId} returned ${status.checkState}.`);
      }
      if (status.stepState === 'completed' && status.checkState === 'passed') {
        return { outcome: 'completed' };
      }
      if (status.stepState === 'cancelled' || status.stepState === 'requirements-unmet') {
        throw new Error(`Data source step ${step.stepId} entered ${status.stepState} state.`);
      }
      await page.waitForTimeout(Math.min(COMPLETION_POLL_INTERVAL_MS, remaining()));
    }
    throw new Error(`Data source step ${step.stepId} did not reach passed completion before its deadline.`);
  },
};
