import { chainNeedsCloudStack } from './cloud-provisioning';
import { unsafeCloudGuidesInChain } from './cloud-routing';
import type { CloudAuthPolicy } from './cloud-auth';
import type { ColdCloudStackProvisioningConfig } from './cold-cloud-stack-environment';
import type { PackageMeta } from './e2e-results';
import type { ExecutionPlan } from './guide-chains';
interface PreflightTargetUrlsForPlanOptions {
  plan: ExecutionPlan;
  packageMetaById: Map<string, PackageMeta>;
  cloudAuth: CloudAuthPolicy | undefined;
  cloudStack: ColdCloudStackProvisioningConfig | undefined;
  globalUrl: string;
}

/** Preflight runs before cold-stack provisioning, so exclude guides that will run
 * against isolated stacks or be skipped for unsafe shared-stack access
 */
export function preflightTargetUrlsForPlan(options: PreflightTargetUrlsForPlanOptions): string[] {
  const idsToSkip = new Set([
    ...idsSkippedForUnsafeSharedStack(options.plan, options.packageMetaById, options.cloudStack),
    ...idsUsingColdCloudStack(options.plan, options.packageMetaById, options.cloudAuth, options.cloudStack),
  ]);

  return targetUrlsToCheck(options.packageMetaById, options.globalUrl, idsToSkip);
}

function idsSkippedForUnsafeSharedStack(
  plan: ExecutionPlan,
  packageMetaById: Map<string, PackageMeta>,
  cloudStack: ColdCloudStackProvisioningConfig | undefined
): Set<string> {
  const ids = new Set<string>();
  if (cloudStack) {
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

function idsUsingColdCloudStack(
  plan: ExecutionPlan,
  packageMetaById: Map<string, PackageMeta>,
  cloudAuth: CloudAuthPolicy | undefined,
  cloudStack: ColdCloudStackProvisioningConfig | undefined
): Set<string> {
  const ids = new Set<string>();
  for (const chain of plan.chains) {
    if (chainNeedsCloudStack({ chain, packageMetaById, cloudAuth, cloudStack })) {
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
