/**
 * Which Grafana service account a gcx mint is allowed to use.
 *
 * The client mints in the browser with the user's own session, so Grafana caps
 * a *newly created* account at the caller's role. Neither half of that cap
 * survives account reuse, and the client reuses an exact name match without
 * asking whose it is or what role it holds — so the choice of name, and a check
 * on what the name already resolves to, are the whole of the guard.
 *
 * Which is why the check fails closed. An account this code could not read is
 * an unknown role rather than an absent one, and the client reuses it a moment
 * later; a pass has to be an answer, not the absence of one.
 */

import { config, getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

import { logger } from '../../lib/logging';
import { CodaError } from './coda-api';

const ROLE_RANK: Record<string, number> = { None: 0, Viewer: 1, Editor: 2, Admin: 3 };

interface ServiceAccountSearchResult {
  serviceAccounts?: Array<{ name?: string; role?: string }>;
}

interface UserOrg {
  orgId?: number;
  role?: string;
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
 * The guard reached no answer. Distinct from every refusal: nothing here says
 * the mint is disallowed, so the mint stays on offer to be tried again rather
 * than being replaced by the paste field.
 */
export const ACCOUNT_CHECK_UNAVAILABLE = 'service_account_check_unavailable';

function checkUnavailable(subject: string): CodaError {
  logger.warn('[gcx] the service account preflight could not answer', { subject });
  return new CodaError(
    `${subject} could not be read, so minting is held back. Try again, or paste a service account token instead.`,
    ACCOUNT_CHECK_UNAVAILABLE,
    503
  );
}

/** Grafana's own "you may not look at service accounts", not a fault. */
function isAuthorizationDenial(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 401 || status === 403;
}

async function readJson<T>(url: string): Promise<T | undefined> {
  const response = await lastValueFrom(getBackendSrv().fetch<T>({ url, method: 'GET', showErrorAlert: false }));
  return response.data;
}

/**
 * The caller's role as Grafana holds it now. `bootData` carries the role the
 * page was loaded with, and the account outlives the session that created it —
 * a demotion during a long session is the case this guard exists for, so a
 * boot-time snapshot is exactly the wrong side of the comparison.
 */
async function readCallerRank(): Promise<number> {
  let orgs: UserOrg[] | undefined;
  try {
    orgs = await readJson<UserOrg[]>('/api/user/orgs');
  } catch {
    throw checkUnavailable('Your current Grafana role');
  }

  const orgId = config.bootData?.user?.orgId;
  const role = (Array.isArray(orgs) ? orgs.find((org) => org.orgId === orgId) : undefined)?.role;
  const rank = role === undefined ? undefined : ROLE_RANK[role];
  if (rank === undefined) {
    throw checkUnavailable('Your current Grafana role');
  }
  return rank;
}

/**
 * Refuse to mint unless the name is free, or resolves to an account no stronger
 * than the caller is right now.
 *
 * Grafana caps the role only when the account is created, and grants the
 * creator write on it, so an Admin who mints once and is later demoted keeps a
 * route to an Admin token through their own reused account.
 *
 * A lookup that cannot answer is not a pass. Grafana's `403` on
 * `serviceaccounts:read` is the ordinary route to the paste field below Admin,
 * so it is reported as a mint refusal; anything else holds the mint back as
 * retryable rather than claiming the account is safe to reuse.
 */
export async function assertServiceAccountIsMintable(name: string): Promise<void> {
  let found: ServiceAccountSearchResult | undefined;
  try {
    found = await readJson<ServiceAccountSearchResult>(
      `/api/serviceaccounts/search?query=${encodeURIComponent(name)}&perpage=100`
    );
  } catch (err) {
    if (isAuthorizationDenial(err)) {
      throw new CodaError(
        'Grafana would not let this account look up its own service accounts, so it cannot create a token either. Paste a service account token instead.',
        'mint_forbidden',
        403
      );
    }
    throw checkUnavailable('The sandbox service account');
  }

  const existing = found?.serviceAccounts?.find((account) => account.name === name);
  if (!existing) {
    return;
  }

  const accountRank = existing.role === undefined ? undefined : ROLE_RANK[existing.role];
  if (accountRank === undefined) {
    throw checkUnavailable(`The role on service account ${name}`);
  }

  if (accountRank > (await readCallerRank())) {
    throw new CodaError(
      `The sandbox service account ${name} holds a higher Grafana role than you do, so minting against it is refused. Ask an administrator to delete it, or paste a service account token instead.`,
      ACCOUNT_OUTRANKS_CALLER,
      403
    );
  }
}
