import { expect, test, type Page } from '@playwright/test';

import { testIds } from '../../src/constants/testIds';
import { discoverStepsFromDOM } from './utils/guide-runner/discovery';
import { terminalCommandDriver } from './utils/guide-runner/drivers/terminal';
import { calculateStepTimeout, executeAllSteps, executeStep } from './utils/guide-runner/execution';

// These fixtures exercise real Playwright controls, not a real Coda session.
test.use({ storageState: { cookies: [], origins: [] } });

async function loadFixture(
  page: Page,
  options: {
    outcome?: 'complete' | 'error' | 'detach' | 'disconnect' | 'hang';
    connected?: boolean;
    gcx?: boolean;
    unavailable?: boolean;
    customVm?: boolean;
    skippable?: boolean;
    requirementsUnmet?: boolean;
    retry?: 'complete' | 'error' | 'hang';
    startup?: 'complete' | 'disconnect' | 'hang';
  } = {}
) {
  await page.setContent(`
    <div data-test-step-kind="terminal-connect" data-test-step-id="connect" data-test-step-state="idle"
         data-testid="${testIds.interactive.terminalConnectStep('connect')}"
         data-test-terminal-status="disconnected" data-test-terminal-gcx="false"
         data-test-terminal-unavailable="false" data-test-terminal-checking="false">
      <button data-testid="${testIds.interactive.terminalConnectButton('connect')}">Custom connect label</button>
      <button hidden data-testid="${testIds.interactive.terminalSkipButton('connect')}">Continue</button>
      <button data-testid="${testIds.interactive.gcxSkipButton('connect')}">Continue without gcx</button>
    </div>
    <div data-test-step-kind="terminal" data-test-step-id="command" data-test-step-state="idle"
         data-testid="${testIds.interactive.terminalStep('command')}" data-test-skippable="false"
         data-test-terminal-status="disconnected" data-test-terminal-unavailable="false"
         data-test-terminal-checking="false">
      <code>echo 'hello pathfinder'</code>
      <button data-testid="${testIds.interactive.terminalCopyButton('command')}">Copy</button>
      <button data-testid="${testIds.interactive.terminalConnectButton('command')}">Connect terminal</button>
      <button hidden data-testid="${testIds.interactive.terminalExecButton('command')}">Exec</button>
    </div>
  `);
  await page.evaluate(
    ({ options, ids }) => {
      const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
      const connect = byId(ids.connectRoot);
      const command = byId(ids.commandRoot);
      document.body.dataset.execCount = '0';
      document.body.dataset.connectCount = '0';
      document.body.dataset.copyCount = '0';
      const makeConnected = () => {
        for (const root of [connect, command]) {
          root.setAttribute('data-test-terminal-status', 'connected');
        }
        byId(ids.connect).hidden = true;
        byId(ids.commandConnect).hidden = true;
        byId(ids.continue).hidden = false;
        byId(ids.exec).hidden = false;
      };
      if (options.connected) {
        makeConnected();
      }
      connect.setAttribute('data-test-terminal-gcx', String(!!options.gcx));
      connect.setAttribute('data-test-terminal-vm-requested', String(!!options.customVm));
      command.setAttribute('data-test-skippable', String(!!options.skippable));
      if (options.requirementsUnmet) {
        command.setAttribute('data-test-step-state', 'requirements-unmet');
      }
      if (options.unavailable) {
        for (const [root, requirement, button] of [
          [connect, ids.requirement, ids.connect],
          [command, ids.commandRequirement, ids.commandConnect],
        ] as const) {
          root.setAttribute('data-test-terminal-unavailable', 'true');
          byId(button).remove();
          const message = document.createElement('div');
          message.dataset.testid = requirement;
          message.textContent = 'The Coda app plugin is not installed or not enabled.';
          root.append(message);
        }
      }
      if (options.skippable && (options.unavailable || options.requirementsUnmet)) {
        const skip = document.createElement('button');
        skip.dataset.testid = ids.skip;
        skip.textContent = 'Skip';
        skip.onclick = () => command.setAttribute('data-test-step-state', 'completed');
        command.append(skip);
      }
      if (options.retry) {
        for (const root of [connect, command]) {
          root.setAttribute('data-test-step-state', 'error');
          root.setAttribute('data-test-terminal-status', 'error');
        }
      }
      const start = (root: HTMLElement) => {
        root.setAttribute('data-test-step-state', 'executing');
        root.setAttribute('data-test-terminal-status', 'connecting');
        setTimeout(
          () => {
            if (options.startup === 'disconnect') {
              root.setAttribute('data-test-terminal-status', 'disconnected');
            } else if (options.retry === 'error') {
              root.setAttribute('data-test-terminal-status', 'error');
              root.setAttribute('data-test-step-state', 'error');
            } else {
              makeConnected();
              root.setAttribute('data-test-step-state', root === connect ? 'completed' : 'idle');
            }
          },
          options.retry || options.startup ? 350 : 50
        );
      };
      const requestConnection = (root: HTMLElement) => {
        document.body.dataset.connectCount = String(Number(document.body.dataset.connectCount) + 1);
        if (options.retry === 'hang' || options.startup === 'hang') {
          return;
        }
        if (options.retry || options.startup) {
          setTimeout(() => start(root), 100);
        } else {
          start(root);
        }
      };
      if (!options.unavailable) {
        byId(ids.connect).onclick = () => requestConnection(connect);
        byId(ids.commandConnect).onclick = () => requestConnection(command);
      }
      byId(ids.continue).onclick = () => connect.setAttribute('data-test-step-state', 'completed');
      byId(ids.copy).onclick = () => {
        document.body.dataset.copyCount = String(Number(document.body.dataset.copyCount) + 1);
        command.setAttribute('data-test-step-state', 'completed');
      };
      byId(ids.exec).onclick = () => {
        document.body.dataset.execCount = String(Number(document.body.dataset.execCount) + 1);
        command.setAttribute('data-test-step-state', 'executing');
        setTimeout(() => {
          if (options.outcome === 'detach') {
            command.remove();
          } else if (options.outcome === 'error') {
            command.setAttribute('data-test-step-state', 'error');
            const error = document.createElement('div');
            error.dataset.testid = ids.error;
            error.textContent = 'The command could not be sent.';
            command.append(error);
          } else if (options.outcome === 'disconnect') {
            command.setAttribute('data-test-terminal-status', 'disconnected');
            command.setAttribute('data-test-step-state', 'completed');
          } else if (options.outcome !== 'hang') {
            command.setAttribute('data-test-step-state', 'completed');
          }
        }, 50);
      };
    },
    {
      options,
      ids: {
        connectRoot: testIds.interactive.terminalConnectStep('connect'),
        commandRoot: testIds.interactive.terminalStep('command'),
        connect: testIds.interactive.terminalConnectButton('connect'),
        commandConnect: testIds.interactive.terminalConnectButton('command'),
        continue: testIds.interactive.terminalSkipButton('connect'),
        exec: testIds.interactive.terminalExecButton('command'),
        copy: testIds.interactive.terminalCopyButton('command'),
        skip: testIds.interactive.terminalSkipButton('command'),
        error: testIds.interactive.errorMessage('command'),
        requirement: testIds.interactive.requirementCheck('connect'),
        commandRequirement: testIds.interactive.requirementCheck('command'),
      },
    }
  );
  return discoverStepsFromDOM(page);
}

test('discovers and executes connection then command without copying', async ({ page }) => {
  const discovery = await loadFixture(page);
  expect(discovery.coverage).toMatchObject({ rendered: 2, supported: 2, unsupported: 0 });
  expect(calculateStepTimeout(discovery.steps[0]!)).toBe(240_000);
  const result = await executeAllSteps(page, discovery.steps, { sessionValidator: async () => ({ valid: true }) });
  expect(result.results.map(({ stepKind, status }) => ({ stepKind, status }))).toEqual([
    { stepKind: 'terminal-connect', status: 'passed' },
    { stepKind: 'terminal', status: 'passed' },
  ]);
  await expect(page.locator('body')).toHaveAttribute('data-connect-count', '1');
  await expect(page.locator('body')).toHaveAttribute('data-exec-count', '1');
  await expect(page.locator('body')).toHaveAttribute('data-copy-count', '0');
});

for (const stepIndex of [0, 1]) {
  for (const startup of ['complete', 'disconnect', 'hang'] as const) {
    test(`bounds delayed startup for terminal step ${stepIndex}: ${startup}`, async ({ page }) => {
      const { steps } = await loadFixture(page, { startup });
      expect(await executeStep(page, steps[stepIndex]!, { timeout: 1600 })).toMatchObject({
        status: startup === 'complete' ? 'passed' : 'failed',
      });
      await expect(page.locator('body')).toHaveAttribute('data-connect-count', '1');
      await expect(page.locator('body')).toHaveAttribute(
        'data-exec-count',
        startup === 'complete' && stepIndex === 1 ? '1' : '0'
      );
    });
  }
}

test('connects through a standalone terminal step before executing', async ({ page }) => {
  const { steps } = await loadFixture(page);
  expect(await executeStep(page, steps[1]!)).toMatchObject({ status: 'passed' });
  await expect(page.locator('body')).toHaveAttribute('data-connect-count', '1');
  await expect(page.locator('body')).toHaveAttribute('data-exec-count', '1');
});

test('uses Continue for an existing connection without provisioning again', async ({ page }) => {
  const { steps } = await loadFixture(page, { connected: true });
  expect(await executeStep(page, steps[0]!)).toMatchObject({ status: 'passed' });
  await expect(page.locator('body')).toHaveAttribute('data-connect-count', '0');
});

for (const outcome of ['error', 'detach', 'disconnect', 'hang'] as const) {
  test(`does not pass an unsuccessful command: ${outcome}`, async ({ page }) => {
    const { steps } = await loadFixture(page, { connected: true, outcome });
    expect(await executeStep(page, steps[1]!, { timeout: 600 })).toMatchObject({ status: 'failed' });
    await expect(page.locator('body')).toHaveAttribute('data-exec-count', '1');
    await expect(page.locator('body')).toHaveAttribute('data-copy-count', '0');
  });
}

for (const kind of ['terminal', 'terminal-connect', 'skip'] as const) {
  for (const restored of ['completed', 'idle', 'disconnected', 'missing'] as const) {
    test(`${kind} verifies its own state after section collapse: ${restored}`, async ({ page }) => {
      await loadFixture(page, {
        connected: kind === 'terminal',
        unavailable: kind === 'skip',
        skippable: kind === 'skip',
      });
      await page.evaluate(
        ({ rootId, sectionId, toggleId, restored }) => {
          const root = document.querySelector<HTMLElement>(`[data-testid="${rootId}"]`)!;
          const section = document.createElement('div');
          section.dataset.testid = sectionId;
          section.id = 'setup';
          section.dataset.interactiveSection = 'true';
          root.before(section);
          section.append(root);
          const toggle = document.createElement('button');
          toggle.dataset.testid = toggleId;
          toggle.setAttribute('aria-label', 'Expand section');
          toggle.textContent = 'Expand';
          document.body.dataset.expandCount = '0';
          toggle.onclick = () => {
            document.body.dataset.expandCount = String(Number(document.body.dataset.expandCount) + 1);
            section.classList.remove('collapsed');
            toggle.setAttribute('aria-label', 'Collapse section');
            if (restored !== 'missing') {
              root.setAttribute('data-test-step-state', restored === 'idle' ? 'idle' : 'completed');
              root.setAttribute(
                'data-test-terminal-status',
                restored === 'disconnected' ? 'disconnected' : 'connected'
              );
              section.append(root);
            }
          };
          const observer = new MutationObserver(() => {
            if (root.getAttribute('data-test-step-state') === 'completed') {
              observer.disconnect();
              section.classList.add('completed', 'collapsed');
              root.remove();
              section.append(toggle);
            }
          });
          observer.observe(root, { attributes: true });
        },
        {
          rootId:
            kind === 'terminal-connect'
              ? testIds.interactive.terminalConnectStep('connect')
              : testIds.interactive.terminalStep('command'),
          sectionId: testIds.interactive.section('setup'),
          toggleId: testIds.interactive.sectionToggle('setup'),
          restored,
        }
      );
      const { steps } = await discoverStepsFromDOM(page);
      const step = steps.find((step) => step.stepKind === (kind === 'skip' ? 'terminal' : kind))!;
      expect(step.sectionId).toBe('setup');
      if (kind === 'skip') {
        const skipped = terminalCommandDriver.skip(page, step.stepId, 1500);
        if (restored === 'completed' || restored === 'disconnected') {
          await expect(skipped).resolves.toBeUndefined();
        } else {
          await expect(skipped).rejects.toThrow();
        }
      } else {
        expect(await executeStep(page, step, { timeout: 1500 })).toMatchObject({
          status: restored === 'completed' ? 'passed' : 'failed',
        });
      }
      await expect(page.locator('body')).toHaveAttribute('data-expand-count', '1');
      await expect(page.locator('body')).toHaveAttribute('data-exec-count', kind === 'terminal' ? '1' : '0');
      await expect(page.locator('body')).toHaveAttribute('data-connect-count', kind === 'terminal-connect' ? '1' : '0');
    });
  }
}

test('refuses missing Coda and stops before the command', async ({ page }) => {
  const { steps } = await loadFixture(page, { unavailable: true });
  const result = await executeAllSteps(page, steps, { sessionValidator: async () => ({ valid: true }) });
  expect(result.results[0]).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('Requirements not met: The Coda'),
  });
  expect(result.results[1]).toMatchObject({ status: 'not_reached' });
  await expect(page.locator('body')).toHaveAttribute('data-connect-count', '0');
});

test('does not mint or skip gcx credentials', async ({ page }) => {
  const { steps } = await loadFixture(page, { gcx: true });
  expect(await executeStep(page, steps[0]!)).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('gcx credential provisioning is not supported'),
  });
  await expect(page.locator('body')).toHaveAttribute('data-connect-count', '0');
  await expect(page.getByTestId(testIds.interactive.terminalConnectStep('connect'))).toHaveAttribute(
    'data-test-step-state',
    'idle'
  );
});

test('refuses to substitute an existing sandbox for explicit VM options', async ({ page }) => {
  const { steps } = await loadFixture(page, { connected: true, customVm: true });
  expect(await executeStep(page, steps[0]!)).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('requested sandbox'),
  });
});

test('does not fall back to Copy when Exec is disabled', async ({ page }) => {
  const { steps } = await loadFixture(page, { connected: true });
  await page.getByTestId(testIds.interactive.terminalExecButton('command')).evaluate((el: HTMLButtonElement) => {
    el.disabled = true;
  });
  expect(await executeStep(page, steps[1]!, { timeout: 300 })).toMatchObject({ status: 'failed' });
  await expect(page.locator('body')).toHaveAttribute('data-copy-count', '0');
});

test('synchronizes an authored Skip when command requirements are unmet', async ({ page }) => {
  const { steps } = await loadFixture(page, { skippable: true, requirementsUnmet: true });
  const root = page.getByTestId(testIds.interactive.terminalStep('command'));
  expect(await executeStep(page, steps[1]!)).toMatchObject({ status: 'skipped', skipReason: 'requirements_unmet' });
  await expect(root).toHaveAttribute('data-test-step-state', 'completed');
  await expect(page.locator('body')).toHaveAttribute('data-exec-count', '0');
});

for (const skippable of [true, false]) {
  test(`handles unavailable Coda with authored skippable=${skippable}`, async ({ page }) => {
    const { steps } = await loadFixture(page, { unavailable: true, skippable });
    const root = page.getByTestId(testIds.interactive.terminalStep('command'));
    await expect(root).toHaveAttribute('data-test-step-state', 'idle');
    await expect(root.getByTestId(testIds.interactive.terminalSkipButton('command'))).toHaveCount(skippable ? 1 : 0);
    expect(await executeStep(page, steps[1]!)).toMatchObject(
      skippable
        ? { status: 'skipped', skipReason: 'requirements_unmet' }
        : { status: 'failed', error: expect.stringContaining('Requirements not met: The Coda') }
    );
    await expect(root).toHaveAttribute('data-test-step-state', skippable ? 'completed' : 'idle');
    for (const counter of ['connect', 'exec', 'copy']) {
      await expect(page.locator('body')).toHaveAttribute(`data-${counter}-count`, '0');
    }
  });
}

for (const stepIndex of [0, 1]) {
  test(`allows the delayed retry transition for terminal step ${stepIndex}`, async ({ page }) => {
    const { steps } = await loadFixture(page, { retry: 'complete' });
    expect(await executeStep(page, steps[stepIndex]!, { timeout: 3_000 })).toMatchObject({ status: 'passed' });
    await expect(page.locator('body')).toHaveAttribute('data-connect-count', '1');
    await expect(page.locator('body')).toHaveAttribute('data-exec-count', String(stepIndex));
  });
}

for (const retry of ['error', 'hang'] as const) {
  test(`fails a retry that returns to or stays in error: ${retry}`, async ({ page }) => {
    const { steps } = await loadFixture(page, { retry });
    expect(await executeStep(page, steps[0]!, { timeout: 3_000 })).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Terminal step connect failed'),
    });
    await expect(page.locator('body')).toHaveAttribute('data-connect-count', '1');
    await expect(page.locator('body')).toHaveAttribute('data-exec-count', '0');
  });
}

test('fails explicitly against an older terminal DOM contract', async ({ page }) => {
  const { steps } = await loadFixture(page);
  await page
    .getByTestId(testIds.interactive.terminalConnectStep('connect'))
    .evaluate((el) => el.removeAttribute('data-test-terminal-status'));
  expect(await executeStep(page, steps[0]!)).toMatchObject({
    status: 'failed',
    error: expect.stringContaining('terminal runner DOM contract'),
  });
});
