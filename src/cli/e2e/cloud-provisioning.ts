import { sameOrigin } from './e2e-targets';
import { SharedCloudStackEnvironment } from './shared-cloud-stack-environment';
import type { CloudAuthPolicy } from './cloud-auth';
import type { CloudChainCleanupRegistry } from './cloud-chain-cleanup-registry';
import type {
  CloudChainTeardownContext,
  CloudChainTeardownTarget,
  ProvisionedCloudTarget,
} from './cloud-chain-environment';
import type { PackageMeta } from './e2e-results';
import type { CloudStackPoolManager } from './cloud-stack-pool-manager';

interface PlannedGuideRef {
  id: string;
}

interface TrackedCloudTarget {
  env: CloudChainTeardownTarget;
  target: ProvisionedCloudTarget;
  cleanupRegistry?: CloudChainCleanupRegistry;
}
export class ProvisionedCloudTargets {
  private readonly targets = new Map<string, TrackedCloudTarget>();
  private readonly guideTargets = new Map<string, TrackedCloudTarget>();

  add(target: ProvisionedCloudTarget, env: CloudChainTeardownTarget): void {
    this.targets.set(new URL(target.targetUrl).origin, { env, target });
  }
  addForGuides(
    guideIds: string[],
    target: ProvisionedCloudTarget,
    env: CloudChainTeardownTarget,
    cleanupRegistry?: CloudChainCleanupRegistry
  ): void {
    const tracked: TrackedCloudTarget = cleanupRegistry ? { env, target, cleanupRegistry } : { env, target };
    for (const guideId of guideIds) {
      this.guideTargets.set(guideId, tracked);
    }
  }

  targetUrlForGuide(guideId: string, fallbackTargetUrl: string): string {
    return this.guideTargets.get(guideId)?.target.targetUrl ?? fallbackTargetUrl;
  }

  tokenForGuide(guideId: string, fallbackTargetUrl: string | undefined): string | undefined {
    const guideTarget = this.guideTargets.get(guideId);
    if (guideTarget) {
      return guideTarget.target.token;
    }
    return this.tokenFor(fallbackTargetUrl);
  }

  tokenFor(targetUrl: string | undefined): string | undefined {
    if (!targetUrl) {
      return undefined;
    }
    for (const [origin, provisioned] of this.targets) {
      if (sameOrigin(origin, targetUrl)) {
        return provisioned.target.token;
      }
    }
    return undefined;
  }

  async teardownAll(context?: CloudChainTeardownContext): Promise<string[]> {
    const warnings: string[] = [];
    const tornDown = new Set<TrackedCloudTarget>();
    for (const provisioned of this.guideTargets.values()) {
      if (!tornDown.has(provisioned)) {
        tornDown.add(provisioned);
        warnings.push(...((await provisioned.env.teardownChain(context)) ?? []));
        if (provisioned.cleanupRegistry) {
          provisioned.cleanupRegistry.untrack(provisioned.env);
        }
      }
    }
    for (const { env } of this.targets.values()) {
      warnings.push(...((await env.teardownChain(context)) ?? []));
    }
    return warnings;
  }
}

function isCloudGuide(meta: PackageMeta | undefined): boolean {
  return meta?.tier === 'cloud';
}

function hasUnsafeSideEffects(meta: PackageMeta | undefined): boolean {
  const level = meta?.sideEffects?.level;
  return isCloudGuide(meta) && level !== 'readonly';
}

function lacksSharedAuth(meta: PackageMeta | undefined, cloudAuth: CloudAuthPolicy | undefined): boolean {
  return isCloudGuide(meta) && !cloudAuth?.needsProvisioningFor(meta?.targetUrl);
}

function cloudGuideIds(chain: PlannedGuideRef[], packageMetaById: Map<string, PackageMeta>): string[] {
  return chain.filter((planned) => isCloudGuide(packageMetaById.get(planned.id))).map((planned) => planned.id);
}

export function chainNeedsCloudStack(options: {
  chain: PlannedGuideRef[];
  packageMetaById: Map<string, PackageMeta>;
  cloudAuth: CloudAuthPolicy | undefined;
  hasIsolatedCloudStack: boolean;
}): boolean {
  if (!options.hasIsolatedCloudStack) {
    return false;
  }
  return options.chain.some((planned) => {
    const meta = options.packageMetaById.get(planned.id);
    return hasUnsafeSideEffects(meta) || lacksSharedAuth(meta, options.cloudAuth);
  });
}

export function cloudTargetsInChain(
  chain: PlannedGuideRef[],
  packageMetaById: Map<string, PackageMeta>,
  cloudAuth: CloudAuthPolicy | undefined
): string[] {
  const targetUrls = new Set<string>();
  for (const planned of chain) {
    const targetUrl = packageMetaById.get(planned.id)?.targetUrl;
    if (targetUrl && cloudAuth?.needsProvisioningFor(targetUrl)) {
      targetUrls.add(new URL(targetUrl).toString());
    }
  }
  return [...targetUrls];
}

export async function provisionCloudTargetsForChain(options: {
  targetUrls: string[];
  cloudAuth: CloudAuthPolicy | undefined;
  chain: PlannedGuideRef[];
  packageMetaById: Map<string, PackageMeta>;
  cloudStackPoolManager?: CloudStackPoolManager;
  cloudChainCleanup?: CloudChainCleanupRegistry;
  verbose: boolean;
}): Promise<ProvisionedCloudTargets> {
  const provisionedTargets = new ProvisionedCloudTargets();
  try {
    if (
      options.cloudStackPoolManager &&
      chainNeedsCloudStack({
        chain: options.chain,
        packageMetaById: options.packageMetaById,
        cloudAuth: options.cloudAuth,
        hasIsolatedCloudStack: true,
      })
    ) {
      const ids = cloudGuideIds(options.chain, options.packageMetaById);
      console.log(`\n☁️ Leasing a Grafana Cloud stack from the E2E pool manager for ${ids.length} guide(s)...`);
      const lease = await options.cloudStackPoolManager.leaseForChain({
        chain: options.chain,
        packageMetaById: options.packageMetaById,
      });
      options.cloudChainCleanup?.track(lease);
      try {
        const stack = await lease.provisionChain();
        provisionedTargets.addForGuides(ids, stack, lease, options.cloudChainCleanup);
      } catch (err) {
        options.cloudChainCleanup?.untrack(lease);
        throw err;
      }
      return provisionedTargets;
    }
    for (const targetUrl of options.targetUrls) {
      const adminToken = options.cloudAuth?.adminTokenFor(targetUrl);
      if (!adminToken) {
        continue;
      }
      console.log(`\n🔑 Provisioning a service account for ${new URL(targetUrl).origin}...`);
      const env = new SharedCloudStackEnvironment(adminToken, targetUrl, options.verbose);
      provisionedTargets.add(await env.provisionChain(), env);
    }
    return provisionedTargets;
  } catch (err) {
    await provisionedTargets.teardownAll();
    throw err;
  }
}

export async function sweepCloudTargets(options: {
  targetUrls: string[];
  cloudAuth: CloudAuthPolicy | undefined;
  verbose: boolean;
}): Promise<void> {
  for (const targetUrl of options.targetUrls) {
    const adminToken = options.cloudAuth?.adminTokenFor(targetUrl);
    if (adminToken) {
      await new SharedCloudStackEnvironment(adminToken, targetUrl, options.verbose).sweepOrphans();
    }
  }
}
