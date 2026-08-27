/**
 * The admin predicate that route validation is parameterised on.
 *
 * `validateRedirectPath` denies `/admin` and `/api` to non-admins, so every
 * caller that pushes an internal path has to answer "is this user an admin"
 * first. Shared rather than repeated so two navigating call sites cannot answer
 * it differently — a route denied on one path and allowed on another is the
 * same gap as having two validators.
 *
 * Grafana enforces access on these routes server-side; this only decides
 * whether the product steers someone at a page they would be bounced from.
 */

import { config } from '@grafana/runtime';

export function currentUserIsAdmin(): boolean {
  const user = config.bootData?.user;
  return user?.isGrafanaAdmin === true || user?.orgRole === 'Admin';
}
