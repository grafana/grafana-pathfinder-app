export interface GuideCompletionResource {
  apiVersion: 'pathfinderbackend.ext.grafana.com/v1alpha1';
  kind: 'GuideCompletion';
  metadata: {
    name: string;
    namespace: string;
    resourceVersion?: string;
    creationTimestamp?: string;
    uid?: string;
  };
  spec: GuideCompletionSpec;
}

export interface GuideCompletionSpec {
  userLogin: string;
  userDisplayName: string;
  guideId: string;
  guideTitle: string;
  pathId: string;
  completedAt: string;
  durationSeconds: number;
  completionPercent: number;
  guideCategory: 'interactive' | 'documentation' | 'learning-journey';
  platform: 'oss' | 'cloud';
}

export interface GuideCompletionList {
  apiVersion: string;
  kind: string;
  metadata: { resourceVersion?: string };
  items: GuideCompletionResource[];
}
