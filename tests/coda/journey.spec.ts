import { test, expect, control, onlyVM, resource } from './harness';
import { randomUUID } from 'node:crypto';
import { testIds } from '../../src/constants/testIds';

for (const mode of ['tcp', 'microvm-ws']) {
  test(`guide commands, completion and recovery use the real Coda terminal (${mode})`, async ({ page, request }) => {
    let output = '';
    const collectOutput = (value: unknown): void => {
      if (typeof value === 'string' && value.startsWith('{')) {
        try {
          collectOutput(JSON.parse(value));
        } catch {
          return;
        }
        return;
      }
      if (!value || typeof value !== 'object') {
        return;
      }
      const frame = value as Record<string, unknown>;
      if (frame.type === 'output' && typeof frame.data === 'string') {
        output = (output + frame.data).slice(-65536);
      } else {
        Object.values(frame).forEach(collectOutput);
      }
    };
    page.on('websocket', (socket) =>
      socket.on('framereceived', ({ payload }) => {
        for (const line of payload.toString().split('\n')) {
          try {
            collectOutput(JSON.parse(line));
          } catch {
            /* Non-JSON heartbeat. */
          }
        }
      })
    );
    const expectOutput = async (text: string) => {
      await expect
        .poll(() => output.includes(text), { message: 'Expected output received over Grafana Live' })
        .toBe(true);
    };
    await control({ action: 'transport', mode });
    const settingsURL = '/api/plugins/grafana-pathfinder-app/settings';
    const settings = await (await request.get(settingsURL)).json();
    expect(
      (
        await request.post(settingsURL, {
          data: { enabled: true, jsonData: { ...settings.jsonData, devMode: true, enableCodaTerminal: true } },
        })
      ).ok()
    ).toBeTruthy();
    const user = await (await request.get('/api/user')).json();
    await page.addInitScript(({ id, orgId }) => {
      localStorage.setItem(`grafana-pathfinder-app-dev-mode-opt-in::${orgId}:${id}`, 'true');
    }, user);
    await page.addLocatorHandler(page.getByLabel("What's new in Grafana"), async () => {
      await page.getByLabel("What's new in Grafana").getByLabel('Close').click();
    });
    const file = `/tmp/pathfinder-journey-${randomUUID()}`;
    const guide = {
      id: 'coda-local-journey',
      title: 'Local terminal journey',
      blocks: [
        { type: 'terminal-connect', id: 'connect', content: 'Connect to the local sandbox.', vmTemplate: 'vm-microvm' },
        {
          type: 'terminal',
          id: 'write',
          content: 'Write once.',
          command: `touch /tmp/pathfinder-ready; printf x >> ${file}; printf '\\127\\122\\117\\124\\105\\n'`,
        },
        {
          type: 'terminal',
          id: 'verify',
          content: 'Verify the saved work.',
          requirements: [`coda-exit-zero:test $(wc -c < ${file}) -eq 1`],
          command: "printf '\\126\\105\\122\\111\\106\\111\\105\\104\\n'",
        },
      ],
    };
    await page.route('https://interactive-learning.grafana.net/packages/coda-local-journey/content.json', (route) =>
      route.fulfill({ json: guide, headers: { 'access-control-allow-origin': '*' } })
    );
    await page.goto('/');
    await page.waitForFunction(() => '__pathfinderPluginConfig' in window);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await expect(page.getByTestId(testIds.docsPanel.container)).toBeVisible();
    await page.evaluate(() =>
      document.dispatchEvent(
        new CustomEvent('pathfinder-auto-open-docs', {
          detail: {
            url: 'https://interactive-learning.grafana.net/packages/coda-local-journey/content.json',
            title: 'Local terminal journey',
            source: 'content_link',
          },
        })
      )
    );
    const connect = page.locator('[data-test-step-kind="terminal-connect"]');
    const write = page.locator('[data-test-step-kind="terminal"]').filter({ hasText: 'Write once.' });
    const verify = page.locator('[data-test-step-kind="terminal"]').filter({ hasText: 'Verify the saved work.' });
    await page.getByRole('button', { name: 'Try in terminal', exact: true }).click();
    await expect(connect).toHaveAttribute('data-test-terminal-status', 'connected');
    if ((await connect.getAttribute('data-test-step-state')) !== 'completed') {
      await connect.getByRole('button', { name: 'Continue', exact: true }).click();
    }
    await expect(connect).toHaveAttribute('data-test-step-state', 'completed');
    const id = await onlyVM();
    await expect(verify.getByRole('button', { name: 'Exec', exact: true })).not.toBeVisible();
    await write.getByRole('button', { name: 'Exec', exact: true }).click();
    await expectOutput('WROTE');
    await expect(write).toHaveAttribute('data-test-step-state', 'completed');
    await verify.getByRole('button', { name: 'Exec', exact: true }).click();
    await expectOutput('VERIFIED');
    await expect(verify).toHaveAttribute('data-test-step-state', 'completed');
    await expect(page.getByTestId(testIds.markComplete.percentage)).toContainText('100%');
    await control({ action: 'sever' });
    await page.getByTestId(testIds.codaTerminal.connectButton).click();
    await expect.poll(async () => (await control()).counts['relay-authorized'], { timeout: 45000 }).toBeGreaterThan(1);
    await expect(
      page.getByTestId(testIds.codaTerminal.panel).getByRole('status', { name: 'Connected', exact: true })
    ).toBeVisible();
    expect(await onlyVM()).toBe(id);
    expect((await control()).counts.created).toBe(1);
    const probe = `test $(wc -c < ${file}) -eq 1 && printf '\\117\\116\\103\\105\\n'`;
    const input = page.getByRole('textbox', { name: 'Terminal input' });
    await input.fill(`${probe}\n`);
    await expectOutput('ONCE');
    const panel = page.getByTestId(testIds.codaTerminal.panel);
    await panel.getByRole('button', { name: 'Terminal actions' }).click();
    await page.getByTestId(testIds.codaTerminal.disconnectButton).click();
    await expect(panel).toContainText('Disconnected');
    await expect.poll(async () => (await control()).attachments).toBe(0);
    expect((await request.delete(`${resource}/vms/${id}`)).ok()).toBeTruthy();
    expect((await control()).vms.find((vm) => vm.id === id)?.state).toBe('destroyed');
  });
}
