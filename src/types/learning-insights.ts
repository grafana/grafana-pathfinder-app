export interface LearningInsightsPerson {
  userId: string;
  userLogin: string;
  userDisplayName: string;
}

export interface LearningInsightsCompletion {
  userId: string;
  guideId: string;
  guideSource: string;
  guideTitle: string;
  completedAt: string;
  source: string;
}

export interface LearningInsightsAssignment {
  name: string;
  userId: string;
  targetType: string;
  targetId: string;
  targetSource: string;
  trackId: string;
  ruleId: string;
  assignedAt: string;
  dueAt: string;
  status: 'complete' | 'outstanding' | 'overdue' | 'unknown' | 'withdrawn';
  reason: string;
  guides: Array<{ guideId: string; guideSource: string; completed: boolean }>;
}

export interface LearningInsightsResponse {
  asOf: string;
  from: string;
  to: string;
  capability: { available: boolean; reason?: string };
  completeness: 'complete' | 'partial';
  warnings: string[];
  people: LearningInsightsPerson[];
  completions: LearningInsightsCompletion[];
  assignments: LearningInsightsAssignment[];
}
