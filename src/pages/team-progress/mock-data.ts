import { GuideCompletionResource } from '../../types/guide-completion.types';

const USERS = [
  { login: 'alice', displayName: 'Alice Chen' },
  { login: 'bob', displayName: 'Bob Martinez' },
  { login: 'carol', displayName: 'Carol Davis' },
  { login: 'dave', displayName: 'Dave Johnson' },
  { login: 'eve', displayName: 'Eve Williams' },
  { login: 'frank', displayName: 'Frank Brown' },
  { login: 'grace', displayName: 'Grace Lee' },
];

const GUIDES: Array<{
  id: string;
  title: string;
  category: 'interactive' | 'documentation' | 'learning-journey';
  pathId: string;
}> = [
  { id: 'explore-logs', title: 'Explore logs in Grafana', category: 'interactive', pathId: 'observability-basics' },
  { id: 'first-dashboard', title: 'Build your first dashboard', category: 'interactive', pathId: 'getting-started' },
  { id: 'alerting-basics', title: 'Set up alerting', category: 'interactive', pathId: 'observability-basics' },
  { id: 'loki-logql', title: 'LogQL fundamentals', category: 'documentation', pathId: 'observability-basics' },
  { id: 'prometheus-basics', title: 'PromQL basics', category: 'documentation', pathId: '' },
  { id: 'tempo-traces', title: 'Tracing with Tempo', category: 'interactive', pathId: 'observability-basics' },
  {
    id: 'data-source-setup',
    title: 'Connect your first data source',
    category: 'interactive',
    pathId: 'getting-started',
  },
  {
    id: 'grafana-cloud-onboarding',
    title: 'Grafana Cloud onboarding',
    category: 'learning-journey',
    pathId: 'getting-started',
  },
  { id: 'panel-transformations', title: 'Panel transformations', category: 'documentation', pathId: '' },
  { id: 'slo-setup', title: 'Define SLOs in Grafana', category: 'interactive', pathId: '' },
];

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

function generateCompletions(): GuideCompletionResource[] {
  const rand = seededRandom(42);
  const completions: GuideCompletionResource[] = [];
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  for (let i = 0; i < 45; i++) {
    const user = USERS[Math.floor(rand() * USERS.length)]!;
    const guide = GUIDES[Math.floor(rand() * GUIDES.length)]!;
    const completedAt = new Date(now - Math.floor(rand() * thirtyDaysMs));
    const durationSeconds = 120 + Math.floor(rand() * 1680); // 2-30 minutes
    const completionPercent = rand() > 0.15 ? 100 : 40 + Math.floor(rand() * 55);
    const ts = completedAt.getTime();

    completions.push({
      apiVersion: 'pathfinderbackend.ext.grafana.com/v1alpha1',
      kind: 'GuideCompletion',
      metadata: {
        name: `${user.login}-${guide.id}-${ts}`,
        namespace: 'default',
        creationTimestamp: completedAt.toISOString(),
      },
      spec: {
        userLogin: user.login,
        userDisplayName: user.displayName,
        guideId: guide.id,
        guideTitle: guide.title,
        pathId: guide.pathId,
        completedAt: completedAt.toISOString(),
        durationSeconds,
        completionPercent,
        guideCategory: guide.category,
        platform: rand() > 0.3 ? 'cloud' : 'oss',
      },
    });
  }

  return completions.sort((a, b) => new Date(b.spec.completedAt).getTime() - new Date(a.spec.completedAt).getTime());
}

export const MOCK_COMPLETIONS = generateCompletions();
