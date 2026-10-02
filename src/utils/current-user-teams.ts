/**
 * The current user's Grafana Team memberships, read live from Grafana's own
 * HTTP API rather than `config.bootData.user` — unlike `orgRole`
 * (`current-user-role.ts`), team membership is not part of the boot payload,
 * so there is no synchronous shortcut here.
 *
 * @coupling API: GET /api/user/teams, Grafana core (no plugin backend route)
 */
import { getBackendSrv } from '@grafana/runtime';

import { logger } from '../lib/logging';

export interface CurrentUserTeam {
  id: number;
  uid: string;
  name: string;
  orgId: number;
}

interface TeamDTO {
  id: number;
  uid: string;
  name: string;
  orgId: number;
}

// Team sync (e.g. Okta-to-Grafana-Team) runs at a far lower cadence than a
// panel render, so a long TTL avoids a redundant fetch on every consult
// without risking meaningfully stale membership.
const CACHE_TTL_MS = 60 * 60 * 1000;

const cache = new Map<number, { teams: CurrentUserTeam[]; at: number }>();
const inflight = new Map<number, Promise<CurrentUserTeam[]>>();

function shapeTeam(team: TeamDTO): CurrentUserTeam {
  return { id: team.id, uid: team.uid, name: team.name, orgId: team.orgId };
}

async function requestCurrentUserTeams(): Promise<CurrentUserTeam[]> {
  const teams = await getBackendSrv().get<TeamDTO[]>('/api/user/teams');
  return Array.isArray(teams) ? teams.map(shapeTeam) : [];
}

/**
 * Fetch the current user's Grafana Team memberships for the given org.
 *
 * Best-effort: returns `[]` on any fetch failure rather than rejecting, since
 * this is auxiliary identity data, not a hard dependency for its callers.
 * Successful results are cached per `orgId` for `CACHE_TTL_MS` with in-flight
 * de-duplication, mirroring `fetchCustomGuideRepository` in
 * `custom-guide-repository-client.ts`; failures are not cached so a
 * transient error doesn't stick for the whole TTL.
 */
export async function getCurrentUserTeams(orgId: number): Promise<CurrentUserTeam[]> {
  const cached = cache.get(orgId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.teams;
  }

  const existing = inflight.get(orgId);
  if (existing) {
    return existing;
  }

  const request = requestCurrentUserTeams()
    .then((teams) => {
      cache.set(orgId, { teams, at: Date.now() });
      return teams;
    })
    .catch((error: unknown) => {
      logger.warn('[current-user-teams] fetch failed', { error });
      return [] as CurrentUserTeam[];
    })
    .finally(() => {
      inflight.delete(orgId);
    });

  inflight.set(orgId, request);
  return request;
}

/** Drop cached team memberships so the next fetch re-lists (e.g. after a team-sync change, or in tests). */
export function invalidateCurrentUserTeamsCache(): void {
  cache.clear();
  inflight.clear();
}
