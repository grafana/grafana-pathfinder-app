import { sameOrigin } from './e2e-targets';
import { CloudEnvironment } from './cloud-environment';
import type { CloudAuthPolicy } from './cloud-auth';
import type { PackageMeta } from './e2e-results';
import { CloudStackEnvironment, type CloudStackProvisioningConfig } from './cloud-stack-environment';
import type { CloudStackPool } from './cloud-stack-pool';

interface PlannedGuideRef {
  id: string;
}

interface ProvisionedCloudTarget {
  env: { teardownChain(): Promise<void> };
  token: string;
  targetUrl?: string;
}

export class ProvisionedCloudTargets {
  private readonly targets = new Map<string, ProvisionedCloudTarget>();
  private readonly guideTargets = new Map<string, ProvisionedCloudTarget>();

  add(targetUrl: string, provisioned: ProvisionedCloudTarget): void {
    this.targets.set(new URL(targetUrl).origin, provisioned);
  }
  addForGuides(guideIds: string[], provisioned: ProvisionedCloudTarget & { targetUrl: string }): void {
    for (const guideId of guideIds) {
      this.guideTargets.set(guideId, provisioned);
    }
  }

  targetUrlForGuide(guideId: string, fallbackTargetUrl: string): string {
    return this.guideTargets.get(guideId)?.targetUrl ?? fallbackTargetUrl;
  }

  tokenForGuide(guideId: string, fallbackTargetUrl: string | undefined): string | undefined {
    const guideTarget = this.guideTargets.get(guideId);
    if (guideTarget) {
      return guideTarget.token;
    }
    return this.tokenFor(fallbackTargetUrl);
  }

  tokenFor(targetUrl: string | undefined): string | undefined {
    if (!targetUrl) {
      return undefined;
    }
    for (const [origin, provisioned] of this.targets) {
      if (sameOrigin(origin, targetUrl)) {
        return provisioned.token;
      }
    }
    return undefined;
  }

  async teardownAll(): Promise<void> {
    const tornDown = new Set<ProvisionedCloudTarget>();
    for (const provisioned of this.guideTargets.values()) {
      if (!tornDown.has(provisioned)) {
        tornDown.add(provisioned);
        await provisioned.env.teardownChain();
      }
    }
    for (const { env } of this.targets.values()) {
      await env.teardownChain();
    }
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
  cloudStack: CloudStackProvisioningConfig | undefined;
  cloudStackPool?: CloudStackPool | undefined;
}): boolean {
  if (!options.cloudStack && !options.cloudStackPool) {
    return false;
  }
  return options.chain.some((planned) => {
    const meta = options.packageMetaById.get(planned.id);
    return hasUnsafeSideEffects(meta) || lacksSharedAuth(meta, options.cloudAuth);
  });
}

export function unsafeCloudGuidesWithoutStack(
  chain: PlannedGuideRef[],
  packageMetaById: Map<string, PackageMeta>,
  cloudStack: CloudStackProvisioningConfig | undefined,
  cloudStackPool?: CloudStackPool | undefined
): PlannedGuideRef[] {
  if (cloudStack || cloudStackPool) {
    return [];
  }
  return chain.filter((planned) => hasUnsafeSideEffects(packageMetaById.get(planned.id)));
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
  chain?: PlannedGuideRef[];
  packageMetaById?: Map<string, PackageMeta>;
  cloudStack?: CloudStackProvisioningConfig;
  cloudStackPool?: CloudStackPool;
  verbose: boolean;
}): Promise<ProvisionedCloudTargets> {
  const provisionedTargets = new ProvisionedCloudTargets();
  try {
    if (
      options.chain &&
      options.packageMetaById &&
      chainNeedsCloudStack({
        chain: options.chain,
        packageMetaById: options.packageMetaById,
        cloudAuth: options.cloudAuth,
        cloudStack: options.cloudStack,
        cloudStackPool: options.cloudStackPool,
      })
    ) {
      const ids = cloudGuideIds(options.chain, options.packageMetaById);
      const firstTargetUrl = ids.map((id) => options.packageMetaById?.get(id)?.targetUrl).find(Boolean);
      const lease = options.cloudStackPool ? await options.cloudStackPool.lease(firstTargetUrl) : undefined;
      if (lease) {
        const stack = lease.provisionChain();
        console.log(`\n☁️  Leased hot-pool Grafana Cloud stack ${stack.stackSlug} for ${ids.length} guide(s)...`);
        provisionedTargets.addForGuides(ids, {
          env: { teardownChain: () => lease.teardownChain() },
          token: stack.token,
          targetUrl: stack.targetUrl,
        });
        return provisionedTargets;
      }
      if (!options.cloudStack) {
        const diagnostics = options.cloudStackPool?.diagnostics();
        throw new Error(
          `Cloud stack pool is exhausted and no --cloud-stack-region cold-provision fallback is configured.${diagnostics ? ` ${diagnostics}` : ''}`
        );
      }
      console.log(`\n☁️  Provisioning an ephemeral Grafana Cloud stack for ${ids.length} guide(s)...`);
      const env = new CloudStackEnvironment(options.cloudStack!, options.verbose);
      const stack = await env.provisionChain();
      provisionedTargets.addForGuides(ids, { env, token: stack.token, targetUrl: stack.targetUrl });
      return provisionedTargets;
    }
    for (const targetUrl of options.targetUrls) {
      const adminToken = options.cloudAuth?.adminTokenFor(targetUrl);
      if (!adminToken) {
        continue;
      }
      console.log(`\n🔑 Provisioning a service account for ${new URL(targetUrl).origin}...`);
      const env = new CloudEnvironment(adminToken, targetUrl, options.verbose);
      provisionedTargets.add(targetUrl, { env, token: await env.provisionChain() });
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
      await new CloudEnvironment(adminToken, targetUrl, options.verbose).sweepOrphans();
    }
  }
}
