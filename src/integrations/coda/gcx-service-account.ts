/**
 * Which Grafana service account a gcx mint is allowed to use.
 *
 * The client mints in the browser with the user's own session, so Grafana caps
 * a *newly created* account at the caller's role. Neither half of that cap
 * survives account reuse, and the client reuses an exact name match without
 * asking whose it is or what role it holds — so the choice of name, and a check
 * on what the name already resolves to, are the whole of the guard.
 */

import { config, getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { logger } from '../../lib/logging';
import { CodaError } from './coda-api';

const ROLE_RANK: Record<string, number> = { None: 0, Viewer: 1, Editor: 2, Admin: 3 };

interface ServiceAccountSearchResult {
  serviceAccounts?: Array<{ name?: string; role?: string }>;
}

/**
 * The service account this user's sandbox tokens are minted against.
 *
 * Keyed on the numeric user id rather than the login, which is what the client
 * defaults to: its normalisation (`[^a-z0-9-]+` → `-`, lowercased, truncated to
 * 40) maps distinct logins such as `a.b` and `a-b` onto one name, and reuse is
 * by exact name. A collision hands one person a token minted against another
 * person's account, at that account's role. Ids do not collide.
 */
export function gcxServiceAccountName(): string {
  const user = config.bootData?.user;
  const id = user?.isSignedIn ? user.id : undefined;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    throw new CodaError('There is no signed-in Grafana user to mint a token for.', 'no_user', 401);
  }
  return `coda-gcx-u${id}`;
}

/**
 * The reused account outranks the caller. Its own code rather than
 * `mint_forbidden`: both branch to the paste field, but only this one names
 * something an operator can delete.
 */
export const ACCOUNT_OUTRANKS_CALLER = 'service_account_outranks_caller';

/**
 * Refuse to mint against an account that outranks the caller today.
 *
 * Grafana caps the role only when the account is created, and grants the
 * creator write on it, so an Admin who mints once and is later demoted keeps a
 * route to an Admin token through their own reused account.
 *
 * A failed search is not a refusal. Below Admin it is Grafana's own 403 on
 * `serviceaccounts:read`, which is the ordinary path to the paste field — the
 * client's search hits the same wall a moment later and says so.
 */
export async function assertServiceAccountIsMintable(name: string): Promise<void> {
  const callerRole = config.bootData?.user?.orgRole ?? 'None';

  let found: ServiceAccountSearchResult;
  try {
    found = await lastValueFrom(
      getBackendSrv().fetch<ServiceAccountSearchResult>({
        url: `/api/serviceaccounts/search?query=${encodeURIComponent(name)}&perpage=100`,
        method: 'GET',
        showErrorAlert: false,
      })
    ).then((response) => response.data ?? {});
  } catch {
    logger.warn('[gcx] could not read the service account before minting', { name });
    return;
  }

  const existing = found.serviceAccounts?.find((account) => account.name === name);
  if (!existing) {
    return;
  }

  const accountRank = ROLE_RANK[existing.role ?? 'None'] ?? 0;
  if (accountRank > (ROLE_RANK[callerRole] ?? 0)) {
    throw new CodaError(
      `The sandbox service account ${name} holds a higher Grafana role than you do, so minting against it is refused. Ask an administrator to delete it, or paste a service account token instead.`,
      ACCOUNT_OUTRANKS_CALLER,
      403
    );
  }
}
