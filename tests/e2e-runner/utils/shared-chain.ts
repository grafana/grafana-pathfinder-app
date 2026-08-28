import type { TestResultsData } from '../../../src/cli/e2e/e2e-reporter';
import { contentDigest, createMinimalResultsData } from '../../../src/cli/e2e/e2e-reporter';
import type { E2EChainGuide, E2EChainInput, E2EChainPackageMetadata } from '../../../src/cli/e2e/e2e-runner-contract';

export interface MilestoneTransition {
  startingLocation: string;
  navigateToStartingLocation: boolean;
}

export interface SharedChainResult {
  results: TestResultsData[];
  authExpired: boolean;
}

interface SharedChainExecutor {
  currentUrl(): string;
  runGuide(guide: E2EChainGuide, index: number, transition: MilestoneTransition): Promise<TestResultsData>;
  onPrerequisiteSkipped?(guide: E2EChainGuide, failedPrerequisite: string): Promise<void>;
  publish(results: TestResultsData[]): void;
}

function sameOriginPath(targetUrl: string, value: string): string {
  const target = new URL(targetUrl);
  const current = new URL(value, target);
  if (
    (target.protocol !== 'http:' && target.protocol !== 'https:') ||
    (current.protocol !== 'http:' && current.protocol !== 'https:') ||
    current.origin !== target.origin
  ) {
    throw new Error(`Milestone location must use the same HTTP or HTTPS origin as ${target.origin}`);
  }
  return `${current.pathname}${current.search}${current.hash}`;
}

export function resolveMilestoneTransition(
  targetUrl: string,
  currentUrl: string,
  authoredStartingLocation: string | undefined,
  isFirstRunnable: boolean
): MilestoneTransition {
  const currentPath = sameOriginPath(targetUrl, currentUrl);
  if (authoredStartingLocation === undefined && !isFirstRunnable) {
    return { startingLocation: currentPath, navigateToStartingLocation: false };
  }
  const startingLocation = sameOriginPath(targetUrl, authoredStartingLocation ?? '/');
  return {
    startingLocation,
    navigateToStartingLocation: isFirstRunnable || currentPath !== startingLocation,
  };
}

function guideTitle(guide: E2EChainGuide): string {
  try {
    const parsed = JSON.parse(guide.content) as { title?: unknown };
    return typeof parsed.title === 'string' && parsed.title ? parsed.title : guide.id;
  } catch {
    return guide.id;
  }
}

function packageGuideMetadata(
  guide: E2EChainGuide,
  metadata: E2EChainPackageMetadata | undefined,
  targetUrl: string,
  startingLocation?: string
): TestResultsData['guide'] {
  return {
    id: guide.id,
    title: guideTitle(guide),
    path: guide.path,
    targetUrl,
    contentDigest: contentDigest(guide.content),
    ...(metadata?.packageId ? { packageId: metadata.packageId } : {}),
    ...(metadata?.tier ? { tier: metadata.tier } : {}),
    ...(metadata?.instance ? { instance: metadata.instance } : {}),
    ...(metadata?.sourceUrl ? { sourceUrl: metadata.sourceUrl } : {}),
    ...(startingLocation ? { startingLocation } : {}),
    ...(metadata?.sideEffects ? { sideEffects: metadata.sideEffects } : {}),
  };
}

function skippedPrerequisiteResult(
  guide: E2EChainGuide,
  targetUrl: string,
  failedPrerequisite: string
): TestResultsData {
  return createMinimalResultsData({
    guide: packageGuideMetadata(guide, guide.packageMetadata, targetUrl),
    outcome: 'skipped',
    errorCode: 'SKIPPED_PREREQ',
    errorMessage: `Prerequisite "${failedPrerequisite}" did not pass`,
    abortReason: 'SKIPPED_PREREQ',
  });
}

export function unrunSharedSessionResult(
  guide: E2EChainGuide,
  targetUrl: string,
  activeResult: TestResultsData
): TestResultsData {
  const authExpired = activeResult.abortReason === 'AUTH_EXPIRED' || activeResult.errorCode === 'AUTH_EXPIRED';
  const errorMessage = authExpired
    ? 'The shared browser session authentication expired before this milestone started.'
    : 'The shared browser session ended before this milestone started.';
  return createMinimalResultsData({
    guide: packageGuideMetadata(guide, guide.packageMetadata, targetUrl),
    outcome: authExpired ? 'aborted' : 'infrastructure_error',
    errorCode: authExpired ? 'AUTH_EXPIRED' : 'REPORT_MISSING',
    errorMessage,
    ...(authExpired ? { abortReason: 'AUTH_EXPIRED' as const } : {}),
  });
}

function endsSharedSession(result: TestResultsData): boolean {
  return (
    result.outcome === 'infrastructure_error' ||
    result.outcome === 'configuration_error' ||
    result.abortReason === 'AUTH_EXPIRED' ||
    result.errorCode === 'AUTH_EXPIRED'
  );
}

export async function runSharedGuideChain(
  input: E2EChainInput,
  executor: SharedChainExecutor
): Promise<SharedChainResult> {
  const results: TestResultsData[] = [];
  const blocked = new Set<string>();
  let firstRunnable = true;
  let authExpired = false;

  for (const [index, guide] of input.guides.entries()) {
    const failedPrerequisite = guide.dependencies.find((dependency) => blocked.has(dependency));
    if (failedPrerequisite) {
      await executor.onPrerequisiteSkipped?.(guide, failedPrerequisite);
      blocked.add(guide.id);
      results.push(skippedPrerequisiteResult(guide, input.targetUrl, failedPrerequisite));
      executor.publish(results);
      continue;
    }

    const transition = resolveMilestoneTransition(
      input.targetUrl,
      executor.currentUrl(),
      guide.authoredStartingLocation,
      firstRunnable
    );
    firstRunnable = false;
    let result: TestResultsData;
    try {
      result = await executor.runGuide(guide, index, transition);
    } catch (error) {
      result = createMinimalResultsData({
        guide: packageGuideMetadata(guide, guide.packageMetadata, input.targetUrl, transition.startingLocation),
        outcome: 'infrastructure_error',
        errorCode: 'REPORT_MISSING',
        errorMessage: `Shared runner failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
    results.push(result);
    executor.publish(results);

    if (result.outcome !== 'passed') {
      blocked.add(guide.id);
    }
    if (!endsSharedSession(result)) {
      continue;
    }

    authExpired = result.abortReason === 'AUTH_EXPIRED' || result.errorCode === 'AUTH_EXPIRED';
    for (const unrun of input.guides.slice(index + 1)) {
      results.push(unrunSharedSessionResult(unrun, input.targetUrl, result));
      executor.publish(results);
    }
    break;
  }

  return { results, authExpired };
}
