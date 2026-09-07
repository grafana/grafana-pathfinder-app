import { OutcomeEvidenceSchema, OutcomeScopeSchema } from '../../types/outcome.schema';
import type { OutcomeEvidence, OutcomeScope } from '../../types/outcome.types';
import type { CheckResultError } from '../../types/requirements.types';
import type { UserStorage } from '../../types/storage.types';

const MAX_RECORDS = 200;

export function outcomeScopeKey(scope: OutcomeScope): string {
  return JSON.stringify([scope.userId, scope.orgId, scope.guideId, scope.guideRevision]);
}

export function createOutcomeEvidence(
  scope: OutcomeScope,
  outcomeId: string,
  resourceUid: string,
  checks: readonly CheckResultError[],
  verifiedAt: number
): OutcomeEvidence | null {
  if (checks.length === 0 || checks.some((check) => !check.pass || check.verdict !== 'satisfied')) {
    return null;
  }
  const result = OutcomeEvidenceSchema.safeParse({ schemaVersion: 1, scope, outcomeId, resourceUid, verifiedAt });
  return result.success ? result.data : null;
}

export interface OutcomeEvidenceStore {
  read(scope: OutcomeScope): Promise<OutcomeEvidence[]>;
  record(
    scope: OutcomeScope,
    outcomeId: string,
    resourceUid: string,
    checks: readonly CheckResultError[]
  ): Promise<OutcomeEvidence | null>;
}

export function createOutcomeEvidenceStore(
  storage: Pick<UserStorage, 'getItem' | 'setItem'>,
  now: () => number = Date.now
): OutcomeEvidenceStore {
  let pending: Promise<unknown> = Promise.resolve();
  const key = (scope: OutcomeScope) => `pathfinder-outcome-evidence:${JSON.stringify([scope.userId, scope.orgId])}`;
  const readAll = async (scope: OutcomeScope): Promise<OutcomeEvidence[]> => {
    OutcomeScopeSchema.parse(scope);
    const raw = await storage.getItem<unknown>(key(scope));
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.slice(-MAX_RECORDS).flatMap((entry) => {
      const parsed = OutcomeEvidenceSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  };
  return {
    async read(scope) {
      return (await readAll(scope)).filter((entry) => outcomeScopeKey(entry.scope) === outcomeScopeKey(scope));
    },
    record(scope, outcomeId, resourceUid, checks) {
      const evidence = createOutcomeEvidence(scope, outcomeId, resourceUid, checks, now());
      if (!evidence) {
        return Promise.resolve(null);
      }
      const write = async () => {
        const previous = await readAll(scope);
        const retained = previous.filter(
          (entry) =>
            !(
              outcomeScopeKey(entry.scope) === outcomeScopeKey(scope) &&
              entry.outcomeId === outcomeId &&
              entry.resourceUid === resourceUid
            )
        );
        await storage.setItem(key(scope), [...retained, evidence].slice(-MAX_RECORDS));
        return evidence;
      };
      const result = pending.then(write, write);
      pending = result;
      return result;
    },
  };
}
