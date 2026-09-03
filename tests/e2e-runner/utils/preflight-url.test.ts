/** @jest-environment node */

import type { Page } from '@playwright/test';

import { pluginE2EAuthStrategy } from '../auth/grafana-auth';
import { checkAuthValid, checkPluginInstalled } from './preflight';

function response(data: unknown, status = 200) {
  return {
    ok: jest.fn(() => status >= 200 && status < 300),
    status: jest.fn(() => status),
    json: jest.fn().mockResolvedValue(data),
  };
}

describe('runner preflight URLs', () => {
  it('checks the user endpoint without a double slash', async () => {
    const userResponse = response({ login: 'admin' });
    const page = {
      goto: jest.fn().mockResolvedValue(undefined),
      url: jest.fn(() => 'http://localhost:3010/dashboards'),
      request: {
        get: jest.fn().mockResolvedValue(userResponse),
      },
    } as unknown as Page;

    await pluginE2EAuthStrategy.authenticate(page, 'http://localhost:3010/');

    expect(page.request.get).toHaveBeenCalledWith('http://localhost:3010/api/user');
  });

  it('checks the plugin endpoint without a double slash', async () => {
    const pluginResponse = response({ enabled: true });
    const page = {
      request: {
        get: jest.fn().mockResolvedValue(pluginResponse),
      },
    } as unknown as Page;

    await checkPluginInstalled(page, 'http://localhost:3010/');

    expect(page.request.get).toHaveBeenCalledWith('http://localhost:3010/api/plugins/grafana-pathfinder-app/settings', {
      headers: undefined,
    });
  });
});

describe('browser session classification', () => {
  it.each(['auth_expired', 'infrastructure_error'] as const)(
    'preserves %s through authentication preflight',
    async (failureKind) => {
      const page = {} as Page;
      const authStrategy = {
        name: 'test',
        authenticate: jest.fn().mockResolvedValue({ success: false, failureKind, error: 'Failed' }),
        validateSession: jest.fn(),
        refreshSession: jest.fn(),
      };

      await expect(checkAuthValid(page, 'http://localhost:3010/', { authStrategy })).resolves.toMatchObject({
        passed: false,
        failureKind,
      });
    }
  );
  it.each([401, 403])('classifies HTTP %s as auth expiry', async (status) => {
    const page = {
      evaluate: jest.fn().mockResolvedValue({
        kind: 'response',
        status,
        url: 'http://localhost:3010/api/user',
      }),
      url: jest.fn(() => 'http://localhost:3010/dashboards'),
    } as unknown as Page;

    await expect(pluginE2EAuthStrategy.validateSession(page)).resolves.toEqual({
      valid: false,
      failureKind: 'auth_expired',
      error: `Session validation failed: /api/user returned ${status}`,
    });
  });

  it('classifies a login redirect as auth expiry', async () => {
    const page = {
      evaluate: jest.fn().mockResolvedValue({
        kind: 'response',
        status: 200,
        url: 'http://localhost:3010/login',
      }),
      url: jest.fn(() => 'http://localhost:3010/dashboards'),
    } as unknown as Page;

    await expect(pluginE2EAuthStrategy.validateSession(page)).resolves.toMatchObject({
      valid: false,
      failureKind: 'auth_expired',
    });
  });

  it.each([
    ['HTTP 500', { kind: 'response', status: 500, url: 'http://localhost:3010/api/user' }],
    ['a network error', { kind: 'error', message: 'Failed to fetch' }],
  ])('classifies %s as infrastructure loss', async (_name, validationResult) => {
    const page = {
      evaluate: jest.fn().mockResolvedValue(validationResult),
      url: jest.fn(() => 'http://localhost:3010/dashboards'),
    } as unknown as Page;

    await expect(pluginE2EAuthStrategy.validateSession(page)).resolves.toMatchObject({
      valid: false,
      failureKind: 'infrastructure_error',
    });
  });

  it('classifies page or context closure as infrastructure loss', async () => {
    const page = {
      evaluate: jest.fn().mockRejectedValue(new Error('Target page, context or browser has been closed')),
    } as unknown as Page;

    await expect(pluginE2EAuthStrategy.validateSession(page)).resolves.toMatchObject({
      valid: false,
      failureKind: 'infrastructure_error',
    });
  });
});
