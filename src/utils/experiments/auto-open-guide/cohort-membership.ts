import { config } from '@grafana/runtime';

import { ALLOWED_RECOMMENDER_DOMAINS, getConfigWithDefaults } from '../../../constants';
import { getOnboardingIntentContextKey } from '../../../global-state/onboarding-exploring-intent';
import { hashString } from '../../../lib/hash.util';
import { isExperimentTelemetryAvailable } from '../../../lib/telemetry/experiments';
import { isGrafanaCloud } from '../../../lib/telemetry/filtering';
import pluginJson from '../../../plugin.json';
import { resolveDevModeOptIn } from '../../dev-mode';
import { resolveTenantSettings } from '../../resolve-tenant-settings';

const LOOKUP_TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 30000;

export function createCohortMembershipReader(onChange: () => void) {
  const contextKey = getOnboardingIntentContextKey();
  const email = config.bootData.user.email;
  let memberships: ReadonlySet<string> | undefined;
  let pending: AbortController | undefined;
  let retryAfter = 0;
  let disposed = false;

  const isCurrent = () =>
    !disposed &&
    isGrafanaCloud() &&
    isExperimentTelemetryAvailable() &&
    !!config.namespace &&
    config.bootData.user.isSignedIn &&
    config.analytics?.enabled !== false &&
    contextKey === getOnboardingIntentContextKey() &&
    email === config.bootData.user.email;

  const refresh = () => {
    if (!isCurrent() || !email || memberships || pending || Date.now() < retryAfter) {
      return;
    }
    const controller = new AbortController();
    pending = controller;
    const { signal } = controller;
    const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

    const lookup = async (): Promise<ReadonlySet<string> | undefined> => {
      const { config: tenant } = await resolveTenantSettings(pluginJson.id);
      const settings = getConfigWithDefaults(tenant);
      if (!settings.pathfinderEnabled || !settings.acceptedTermsAndConditions || !isCurrent() || signal.aborted) {
        return;
      }
      const base = new URL(settings.recommenderServiceUrl);
      if (
        base.username ||
        base.password ||
        !['https:', 'http:'].includes(base.protocol) ||
        (!(tenant.devMode && resolveDevModeOptIn() === true) &&
          (base.protocol !== 'https:' || !ALLOWED_RECOMMENDER_DOMAINS.includes(base.hostname)))
      ) {
        return;
      }
      const emailHash = await hashString(email);
      if (!isCurrent() || signal.aborted) {
        return;
      }
      const endpoint = new URL('api/v1/cohorts', `${base.origin}${base.pathname.replace(/\/$/, '')}/`);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_hash: emailHash }),
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal,
      });
      if (!response.ok) {
        return;
      }
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' || !('cohorts' in payload)) {
        return;
      }
      const { cohorts } = payload;
      if (!Array.isArray(cohorts) || !cohorts.every((cohort) => typeof cohort === 'string')) {
        return;
      }
      return new Set(cohorts);
    };

    const aborted = new Promise<undefined>((resolve) =>
      signal.addEventListener('abort', () => resolve(undefined), { once: true })
    );
    void Promise.race([lookup(), aborted])
      .catch(() => undefined)
      .then((result) => {
        clearTimeout(timer);
        if (pending !== controller) {
          return;
        }
        pending = undefined;
        if (!isCurrent()) {
          return;
        }
        memberships = signal.aborted ? undefined : result;
        retryAfter = Date.now() + RETRY_DELAY_MS;
        onChange();
      });
  };

  return {
    isCurrent,
    hasResult: () => isCurrent() && memberships !== undefined,
    has: (cohort: string) => isCurrent() && memberships?.has(cohort) === true,
    refresh,
    dispose: () => {
      disposed = true;
      memberships = undefined;
      pending?.abort();
      pending = undefined;
    },
  };
}
