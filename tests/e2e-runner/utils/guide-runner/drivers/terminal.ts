import { type Locator, type Page } from '@playwright/test';

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
const TERMINAL_CONNECTION_START_TIMEOUT_MS = 1_000;
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
  goal: 'connected' | 'completed' | 'skipped' | 'connection-step',
  startingFrom: string | null = null,
  sectionId?: string
): Promise<void> {
  const startDeadline = Math.min(deadline, Date.now() + TERMINAL_CONNECTION_START_TIMEOUT_MS);
  let awaitingStart = startingFrom === 'error' || startingFrom === 'disconnected';
  let sawConnecting = false;
  let expanded = false;
  let continued = false;
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
    if (goal === 'skipped' && state === 'completed') {
      return;
    }
    // openTerminal defers connection, briefly retaining the previous status.
    awaitingStart &&= connection === startingFrom && Date.now() < startDeadline;
    if (((state === 'error' || connection === 'error') && !awaitingStart) || state === 'cancelled') {
      throw new Error(
        (await textEvidence(root, testIds.interactive.errorMessage(stepId))) ?? `Terminal step ${stepId} failed.`
      );
    }
    sawConnecting ||= connection === 'connecting';
    if (
      goal !== 'skipped' &&
      connection === 'disconnected' &&
      !awaitingStart &&
      (goal === 'completed' ||
        goal === 'connection-step' ||
        sawConnecting ||
        expanded ||
        startingFrom === 'disconnected')
    ) {
      throw new Error(`Terminal step ${stepId} disconnected before completion.`);
    }
    if (
      goal !== 'skipped' &&
      connection === 'connected' &&
      ((goal === 'connected' && !expanded) || state === 'completed')
    ) {
      return;
    }
    if (goal === 'connection-step' && connection === 'connected' && !continued && !expanded) {
      const button = root.getByTestId(testIds.interactive.terminalSkipButton(stepId));
      if (await button.isVisible()) {
        await dismissBadgeCelebrations(page);
        continued = true;
        try {
          await button.click({ timeout: Math.min(1000, Math.max(1, deadline - Date.now())) });
        } catch (error) {
          const completedOrDetached = await root.evaluateAll(
            (elements) => elements.length === 0 || elements[0]?.getAttribute('data-test-step-state') === 'completed'
          );
          if (!completedOrDetached) {
            throw error;
          }
        }
      }
    }
    await page.waitForTimeout(Math.min(COMPLETION_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
  }
  throw new Error(
    `Terminal step ${stepId} did not reach ${goal === 'connected' ? 'connected state' : goal === 'skipped' ? 'skipped completion' : 'connected completion'} before its deadline.`
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
      const readAttribute = (name: string) => root.getAttribute(name, { timeout: Math.max(1, deadline - Date.now()) });
      let state: string | null;
      while (true) {
        ({ state } = await readStatus(root, Math.max(1, deadline - Date.now())));
        const checking = state === 'checking' || (await readAttribute('data-test-terminal-checking')) === 'true';
        const settling =
          Date.now() < settleDeadline &&
          (state === 'requirements-unmet' || (await readAttribute('data-test-terminal-unavailable')) === 'true');
        if (!checking && !settling) {
          break;
        }
        if (Date.now() >= deadline) {
          throw new Error(`Terminal step ${step.stepId} requirements did not settle.`);
        }
        await page.waitForTimeout(Math.min(COMPLETION_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())));
      }
      const gcx = (await readAttribute('data-test-terminal-gcx')) === 'true';
      const unavailable = (await readAttribute('data-test-terminal-unavailable')) === 'true';
      const existingSandbox =
        kind === 'terminal-connect' &&
        ['connected', 'connecting'].includes((await readAttribute('data-test-terminal-status')) ?? '') &&
        (await readAttribute('data-test-terminal-vm-requested')) === 'true';
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
      const deadline = Date.now() + timeout;
      const remaining = () => Math.max(1, deadline - Date.now());
      const sectionId = await root.evaluate(
        (element) => element.closest('[data-interactive-section="true"]')?.getAttribute('id') ?? undefined,
        undefined,
        { timeout: remaining() }
      );
      await dismissBadgeCelebrations(page);
      await root.getByTestId(testIds.interactive.terminalSkipButton(stepId)).click({ timeout: remaining() });
      await waitForTerminal(page, root, stepId, deadline, 'skipped', null, sectionId);
    },
    async execute({ page, step, timeout }) {
      const root = terminalRoot(page, kind, step.stepId);
      const deadline = Date.now() + timeout;
      const remaining = () => Math.max(1, deadline - Date.now());
      if ((await root.getAttribute('data-test-terminal-gcx', { timeout: remaining() })) === 'true') {
        throw new Error('Automatic gcx credential provisioning is not supported by the terminal runner.');
      }
      const { connection } = await readStatus(root, remaining());
      if (
        kind === 'terminal-connect' &&
        ['connected', 'connecting'].includes(connection) &&
        (await root.getAttribute('data-test-terminal-vm-requested', { timeout: remaining() })) === 'true'
      ) {
        throw new Error('Disconnect the existing terminal before connecting to the requested sandbox.');
      }
      if (connection !== 'connected' && connection !== 'connecting') {
        await dismissBadgeCelebrations(page);
        await root.getByTestId(testIds.interactive.terminalConnectButton(step.stepId)).click({ timeout: remaining() });
      }
      if (kind === 'terminal-connect') {
        await waitForTerminal(page, root, step.stepId, deadline, 'connection-step', connection, step.sectionId);
        return { outcome: 'completed' };
      }
      if (connection !== 'connected') {
        await waitForTerminal(page, root, step.stepId, deadline, 'connected', connection, step.sectionId);
      }
      if ((await root.getAttribute('data-test-step-state', { timeout: remaining() })) !== 'completed') {
        const actionId = testIds.interactive.terminalExecButton(step.stepId);
        await dismissBadgeCelebrations(page);
        await root.getByTestId(actionId).click({ timeout: remaining() });
      }
      await waitForTerminal(page, root, step.stepId, deadline, 'completed', null, step.sectionId);
      return { outcome: 'completed' };
    },
  };
}

export const terminalCommandDriver = terminalDriver('terminal');
export const terminalConnectDriver = terminalDriver('terminal-connect');
