export interface OutcomeScope {
  userId: string;
  orgId: string;
  guideId: string;
  guideRevision: string;
}

export interface OutcomeEvidence {
  schemaVersion: 1;
  scope: OutcomeScope;
  outcomeId: string;
  resourceUid: string;
  verifiedAt: number;
}
