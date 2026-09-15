/**
 * IRM/OnCall API checks: escalation chains.
 *
 * Unlike the Grafana-core checks in `grafana-api.ts`, this calls a different
 * app plugin's resource proxy (`/api/plugins/grafana-irm-app/resources/...`),
 * which forwards to the OnCall backend and attaches OnCall identity itself —
 * the caller just needs a normal authenticated `getBackendSrv()` call.
 */

import { getBackendSrv } from '@grafana/runtime';
import type { CheckResultError } from '../../types/requirements.types';

const ONCALL_RESOURCE_BASE = '/api/plugins/grafana-irm-app/resources';

interface OnCallEscalationChain {
  id: string;
  name: string;
}

interface OnCallEscalationPolicy {
  id: string;
  escalation_chain: string;
}

/**
 * Fetches escalation chains and policies from the OnCall backend (via the
 * grafana-irm-app resource proxy) and groups policy counts by chain id.
 *
 * Fetches full lists and filters/groups client-side rather than relying on
 * server-side query params, since the internal API's filter support hasn't
 * been confirmed to match the public API's.
 */
async function fetchConfiguredChainNames(): Promise<Set<string>> {
  const [chains, policies] = await Promise.all([
    getBackendSrv().get<OnCallEscalationChain[]>(`${ONCALL_RESOURCE_BASE}/escalation_chains/`),
    getBackendSrv().get<OnCallEscalationPolicy[]>(`${ONCALL_RESOURCE_BASE}/escalation_policies/`),
  ]);

  const chainIdsWithPolicies = new Set(policies.map((policy) => policy.escalation_chain));
  const configuredChainNames = new Set<string>();

  for (const chain of chains) {
    if (chainIdsWithPolicies.has(chain.id)) {
      configuredChainNames.add(chain.name.toLowerCase());
    }
  }

  return configuredChainNames;
}

/**
 * Escalation chain existence + configuration check.
 *
 * - `has-escalation-chains` (bare): at least one escalation chain in the org
 *   has one or more escalation steps configured.
 * - `has-escalation-chain:<name>` (parameterized): a chain matching `<name>`
 *   (case-insensitive) exists and has one or more escalation steps configured.
 *
 * A chain with zero escalation policies resolves to nobody, so it does not
 * count as "configured" for either form.
 */
export async function hasEscalationChainCheck(check: string): Promise<CheckResultError> {
  const chainName = check.startsWith('has-escalation-chain:') ? check.replace('has-escalation-chain:', '') : null;

  try {
    const configuredChainNames = await fetchConfiguredChainNames();

    if (chainName === null) {
      const pass = configuredChainNames.size > 0;
      return {
        requirement: check,
        pass,
        error: pass ? undefined : 'No escalation chain with configured steps was found',
        context: { configuredChainCount: configuredChainNames.size },
      };
    }

    const pass = configuredChainNames.has(chainName.toLowerCase());
    return {
      requirement: check,
      pass,
      error: pass ? undefined : `Escalation chain '${chainName}' was not found, or has no escalation steps configured`,
      context: { searched: chainName, configuredChainCount: configuredChainNames.size },
    };
  } catch (error) {
    return {
      requirement: check,
      pass: false,
      error: `Escalation chain check failed: ${error}`,
      context: {
        error: String(error),
        suggestion:
          'Check that the grafana-irm-app plugin is installed, enabled, and you have permission to view escalation chains.',
      },
    };
  }
}
