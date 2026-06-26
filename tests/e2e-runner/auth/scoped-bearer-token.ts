import type { Page } from '@playwright/test';

import type { AuthStrategy, AuthResult, SessionValidationResult } from './grafana-auth';

export function scopedBearerHeaders(
  requestUrl: string,
  targetUrl: string,
  token: string
): { Authorization: string } | undefined {
  try {
    if (new URL(requestUrl, targetUrl).origin !== new URL(targetUrl).origin) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return { Authorization: `Bearer ${token}` };
}

export async function installScopedBearerTokenRoute(page: Page, targetUrl: string, token: string): Promise<void> {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const scopedHeaders = scopedBearerHeaders(request.url(), targetUrl, token);
    await route.continue({
      headers: scopedHeaders ? { ...request.headers(), ...scopedHeaders } : request.headers(),
    });
  });
}

export function createScopedBearerTokenAuthStrategy(token: string, targetUrl: string): AuthStrategy {
  const headers = scopedBearerHeaders(targetUrl, targetUrl, token);

  return {
    name: 'scoped-bearer-token',

    async authenticate(page: Page, grafanaUrl: string): Promise<AuthResult> {
      const response = await page.request.get(new URL('/api/user', grafanaUrl).toString(), { headers });
      if (!response.ok()) {
        return { success: false, error: `Authentication check failed: /api/user returned ${response.status()}` };
      }
      const user = (await response.json()) as { login?: string; id?: number; role?: string };
      return { success: true, user };
    },

    async validateSession(page: Page): Promise<SessionValidationResult> {
      const response = await page.request.get(new URL('/api/user', targetUrl).toString(), { headers });
      return response.ok()
        ? { valid: true }
        : { valid: false, error: `Session validation failed: /api/user returned ${response.status()}` };
    },

    async refreshSession(): Promise<boolean> {
      return false;
    },
  };
}
