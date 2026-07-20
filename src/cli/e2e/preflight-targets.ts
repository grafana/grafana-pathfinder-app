import { chainNeedsCloudStack } from './cloud-provisioning';
import { unsafeCloudGuidesInChain } from './cloud-routing';
import type { CloudAuthPolicy } from './cloud-auth';
import type { CloudStackPoolManagerConfig } from './cloud-stack-pool-manager';
import type { PackageMeta } from './e2e-results';
import type { ExecutionPlan } from './guide-chains';
interface PreflightTargetUrlsForPlanOptions {
  plan: ExecutionPlan;
  packageMetaById: Map<string, PackageMeta>;
  cloudAuth: CloudAuthPolicy | undefined;
  cloudStackPoolManagerConfig: CloudStackPoolManagerConfig | undefined;
  globalUrl: string;
}

function tierForGuide(id: string, packageMetaById: Map<string, PackageMeta>): string {
  return packageMetaById.get(id)?.tier ?? 'local';
}

export function assertTierHomogeneousChains(plan: ExecutionPlan, packageMetaById: Map<string, PackageMeta>): void {
  for (const chain of plan.chains) {
    const tiers = new Set(chain.map((planned) => tierForGuide(planned.id, packageMetaById)));
    if (tiers.size > 1) {
      const chainSummary = chain
        .map((planned) => `${planned.id}:${tierForGuide(planned.id, packageMetaById)}`)
        .join(' → ');
      throw new Error(`Invalid E2E execution plan: dependency chain mixes test environment tiers (${chainSummary}).`);
    }
  }
}

/** Preflight runs before manager leasing, so exclude guides that will run against isolated stacks. */
export function preflightTargetUrlsForPlan(options: PreflightTargetUrlsForPlanOptions): string[] {
  const idsToSkip = new Set([
    ...idsSkippedForUnsafeSharedStack(options.plan, options.packageMetaById, options.cloudStackPoolManagerConfig),
    ...idsUsingCloudStack(
      options.plan,
      options.packageMetaById,
      options.cloudAuth,
      options.cloudStackPoolManagerConfig
    ),
  ]);

  return targetUrlsToCheck(options.packageMetaById, options.globalUrl, idsToSkip);
}

function idsSkippedForUnsafeSharedStack(
  plan: ExecutionPlan,
  packageMetaById: Map<string, PackageMeta>,
  cloudStackPoolManagerConfig: CloudStackPoolManagerConfig | undefined
): Set<string> {
  const ids = new Set<string>();
  if (cloudStackPoolManagerConfig) {
    return ids;
  }
  for (const chain of plan.chains) {
    if (unsafeCloudGuidesInChain(chain, packageMetaById).length > 0) {
      for (const planned of chain) {
        ids.add(planned.id);
      }
    }
  }
  return ids;
}

function idsUsingCloudStack(
  plan: ExecutionPlan,
  packageMetaById: Map<string, PackageMeta>,
  cloudAuth: CloudAuthPolicy | undefined,
  cloudStackPoolManagerConfig: CloudStackPoolManagerConfig | undefined
): Set<string> {
  const ids = new Set<string>();
  for (const chain of plan.chains) {
    if (
      chainNeedsCloudStack({
        chain,
        packageMetaById,
        cloudAuth,
        hasIsolatedCloudStack: Boolean(cloudStackPoolManagerConfig),
      })
    ) {
      for (const planned of chain) {
        ids.add(planned.id);
      }
    }
  }
  return ids;
}

function targetUrlsToCheck(
  packageMetaById: Map<string, PackageMeta>,
  globalUrl: string,
  idsToSkip: Set<string>
): string[] {
  const urls = new Set<string>();
  for (const [id, meta] of packageMetaById) {
    if (idsToSkip.has(id)) {
      continue;
    }
    urls.add(meta.targetUrl ?? globalUrl);
  }
  if (packageMetaById.size === 0) {
    urls.add(globalUrl);
  }
  return [...urls];
}
