import { expect, type Locator, type Page } from '@playwright/test';

import { testIds } from '../../../../../src/constants/testIds';
import { dismissBadgeCelebrations } from '../badge-celebrations';
import {
  COMPLETION_POLL_INTERVAL_MS,
  DEFAULT_STEP_TIMEOUT_MS,
  REQUIREMENTS_CHECK_TIMEOUT_MS,
  REQUIREMENTS_SETTLE_TIMEOUT_MS,
  SKIP_SYNC_TIMEOUT_MS,
} from '../constants';
import type { StepDriver } from './types';

export const TERMINAL_CONNECTION_TIMEOUT_MS = 240_000;
const TERMINAL_RETRY_START_TIMEOUT_MS = 1_000;
type TerminalKind = 'terminal' | 'terminal-connect';

function terminalRoot(page: Page, kind: TerminalKind, stepId: string): Locator {
  return page.getByTestId(
    kind === 'terminal' ? testIds.interactive.terminalStep(stepId) : testIds.interactive.terminalConnectStep(stepId)
  );
}

async function readStatus(root: Locator, timeout: number) {
  const state = await root.getAttribute('data-test-step-state', { timeout });
  const connection = await root.getAttribute('data-test-terminal-status', { timeout });
  if (!connection) {
    throw new Error('Terminal execution requires a Pathfinder build with the terminal runner DOM contract.');
  }
  return { state, connection };
}

async function textEvidence(root: Locator, testId: string): Promise<string | undefined> {
  const message = root.getByTestId(testId);
  return (await message.count()) > 0 ? (await message.textContent())?.trim() || undefined : undefined;
}

async function expandCompletedSection(page: Page, sectionId: string | undefined, timeout: number): Promise<boolean> {
  if (!sectionId) {
    return false;
  }
  const section = page.getByTestId(testIds.interactive.section(sectionId));
  const collapsed = await section.evaluateAll((elements) =>
    elements.some((element) => element.classList.contains('completed') && element.classList.contains('collapsed'))
  );
  if (!collapsed) {
    return false;
  }
  await section
    .getByTestId(testIds.interactive.sectionToggle(sectionId))
    .and(section.getByRole('button', { name: 'Expand section', exact: true }))
    .click({ timeout });
  return true;
}

async function waitForTerminal(
  page: Page,
  root: Locator,
  stepId: string,
  deadline: number,
  requireCompletion: boolean,
  retrying = false,
  sectionId?: string
): Promise<void> {
  const retryStartDeadline = Math.min(deadline, Date.now() + TERMINAL_RETRY_START_TIMEOUT_MS);
  let awaitingRetryStart = retrying;
  let sawConnecting = false;
  let expanded = false;
  while (Date.now() < deadline) {
    const status = await root.evaluateAll((elements) => {
      const element = elements[0];
      return element
        ? {
            state: element.getAttribute('data-test-step-state'),
            connection: element.getAttribute('data-test-terminal-status'),
          }
        : null;
    });
    if (!status) {
      if (!expanded && (await expandCompletedSection(page, sectionId, Math.max(1, deadline - Date.now())))) {
        expanded = true;
        await root.waitFor({ state: 'attached', timeout: Math.max(1, deadline - Date.now()) });
        continue;
      }
      throw new Error(`Terminal step ${stepId} detached before completion could be verified.`);
    }
    const { state, connection } = status;
    if (!connection) {
      throw new Error('Terminal execution requires a Pathfinder build with the terminal runner DOM contract.');
    }
    // openTerminal defers reconnect, briefly leaving the previous attempt's error visible.
    awaitingRetryStart &&= connection === 'error' && Date.now() < retryStartDeadline;
    if (((state === 'error' || connection === 'error') && !awaitingRetryStart) || state === 'cancelled') {
      throw new Error(
        (await textEvidence(root, testIds.interactive.errorMessage(stepId))) ?? `Terminal step ${stepId} failed.`
      );
    }
    sawConnecting ||= connection === 'connecting';
    if (connection === 'disconnected' && (requireCompletion || sawConnecting || expanded)) {
      throw new Error(`Terminal step ${stepId} disconnected before completion.`);
    }
    if (connection === 'connected' && ((!requireCompletion && !expanded) || state === 'completed')) {
      return;
    }
    await page.waitForTimeout(Math.min(COMPLETION_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
  }
  throw new Error(
    `Terminal step ${stepId} did not reach ${requireCompletion ? 'connected completion' : 'connected state'} before its deadline.`
  );
}

function terminalDriver(kind: TerminalKind): StepDriver {
  return {
    kind,
    supported: true,
    root: (page, stepId) => terminalRoot(page, kind, stepId),
    detachmentCompletes: false,
    timeout: () => TERMINAL_CONNECTION_TIMEOUT_MS + (kind === 'terminal' ? DEFAULT_STEP_TIMEOUT_MS : 0),
    async inspect(page, root, stepId) {
      return {
        actionCount: 0,
        targetAction: kind,
        isPreCompleted: (await root.getAttribute('data-test-step-state')) === 'completed',
        skippable: kind === 'terminal' && (await root.getAttribute('data-test-skippable')) === 'true',
        hasDoItButton:
          (await root
            .getByTestId(
              kind === 'terminal'
                ? testIds.interactive.terminalExecButton(stepId)
                : testIds.interactive.terminalConnectButton(stepId)
            )
            .count()) > 0,
        hasShowMeButton: false,
      };
    },
    async completionState(page, stepId) {
      const root = terminalRoot(page, kind, stepId);
      const { state, connection } = await readStatus(root, REQUIREMENTS_CHECK_TIMEOUT_MS);
      return state === 'completed' && connection === 'connected';
    },
    async checkRequirements({ page, step, timeout }) {
      const root = terminalRoot(page, kind, step.stepId);
      const deadline = Date.now() + Math.min(timeout, REQUIREMENTS_CHECK_TIMEOUT_MS);
      const settleDeadline = Date.now() + Math.min(timeout, REQUIREMENTS_SETTLE_TIMEOUT_MS);
      let state: string | null;
      while (true) {
        ({ state } = await readStatus(root, Math.max(1, deadline - Date.now())));
        const checking = state === 'checking' || (await root.getAttribute('data-test-terminal-checking')) === 'true';
        const settling =
          Date.now() < settleDeadline &&
          (state === 'requirements-unmet' || (await root.getAttribute('data-test-terminal-unavailable')) === 'true');
        if (!checking && !settling) {
          break;
        }
        if (Date.now() >= deadline) {
          throw new Error(`Terminal step ${step.stepId} requirements did not settle.`);
        }
        await page.waitForTimeout(Math.min(COMPLETION_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
      }
      const gcx = (await root.getAttribute('data-test-terminal-gcx')) === 'true';
      const unavailable = (await root.getAttribute('data-test-terminal-unavailable')) === 'true';
      const existingSandbox =
        kind === 'terminal-connect' &&
        ['connected', 'connecting'].includes((await root.getAttribute('data-test-terminal-status')) ?? '') &&
        (await root.getAttribute('data-test-terminal-vm-requested')) === 'true';
      const unmet = gcx || unavailable || existingSandbox || state === 'requirements-unmet';
      return {
        requirements: {
          requirementsMet: !unmet,
          status: unmet ? 'unmet' : 'met',
          hasFixButton: false,
          hasRetryButton: false,
          hasSkipButton:
            kind === 'terminal' &&
            (await root.getByTestId(testIds.interactive.terminalSkipButton(step.stepId)).count()) > 0,
          skippable: step.skippable,
          isChecking: false,
          explanationText: gcx
            ? 'Automatic gcx credential provisioning is not supported by the terminal runner.'
            : existingSandbox
              ? "Disconnect the existing terminal before connecting to the guide's requested sandbox."
              : await textEvidence(root, testIds.interactive.requirementCheck(step.stepId)),
        },
      };
    },
    async skip(page, stepId, timeout = SKIP_SYNC_TIMEOUT_MS) {
      if (kind !== 'terminal') {
        throw new Error('Terminal connection steps cannot be skipped by the runner.');
      }
      const root = terminalRoot(page, kind, stepId);
      await dismissBadgeCelebrations(page);
      await root.getByTestId(testIds.interactive.terminalSkipButton(stepId)).click({ timeout });
      await expect(root).toHaveAttribute('data-test-step-state', 'completed', { timeout });
    },
    async execute({ page, step, timeout }) {
      const root = terminalRoot(page, kind, step.stepId);
      const deadline = Date.now() + timeout;
      const remaining = () => Math.max(1, deadline - Date.now());
      if ((await root.getAttribute('data-test-terminal-gcx')) === 'true') {
        throw new Error('Automatic gcx credential provisioning is not supported by the terminal runner.');
      }
      const { connection } = await readStatus(root, remaining());
      if (
        kind === 'terminal-connect' &&
        ['connected', 'connecting'].includes(connection) &&
        (await root.getAttribute('data-test-terminal-vm-requested')) === 'true'
      ) {
        throw new Error('Disconnect the existing terminal before connecting to the requested sandbox.');
      }
      if (connection !== 'connected') {
        if (connection !== 'connecting') {
          await dismissBadgeCelebrations(page);
          await root
            .getByTestId(testIds.interactive.terminalConnectButton(step.stepId))
            .click({ timeout: remaining() });
        }
        await waitForTerminal(page, root, step.stepId, deadline, false, connection === 'error', step.sectionId);
      }
      if ((await root.getAttribute('data-test-step-state')) !== 'completed') {
        const actionId =
          kind === 'terminal'
            ? testIds.interactive.terminalExecButton(step.stepId)
            : testIds.interactive.terminalSkipButton(step.stepId);
        await dismissBadgeCelebrations(page);
        await root.getByTestId(actionId).click({ timeout: remaining() });
      }
      await waitForTerminal(page, root, step.stepId, deadline, true, false, step.sectionId);
      return { outcome: 'completed' };
    },
  };
}

export const terminalCommandDriver = terminalDriver('terminal');
export const terminalConnectDriver = terminalDriver('terminal-connect');
