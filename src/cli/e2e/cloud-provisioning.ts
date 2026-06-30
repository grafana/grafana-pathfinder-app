import { sameOrigin } from './e2e-targets';
import { SharedCloudStackEnvironment } from './shared-cloud-stack-environment';
import type { CloudAuthPolicy } from './cloud-auth';
import type { PackageMeta } from './e2e-results';

interface PlannedGuideRef {
  id: string;
}

interface ProvisionedCloudTarget {
  env: SharedCloudStackEnvironment;
  token: string;
}

export class ProvisionedCloudTargets {
  private readonly targets = new Map<string, ProvisionedCloudTarget>();

  add(targetUrl: string, provisioned: ProvisionedCloudTarget): void {
    this.targets.set(new URL(targetUrl).origin, provisioned);
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
    for (const { env } of this.targets.values()) {
      await env.teardownChain();
    }
  }
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
  verbose: boolean;
}): Promise<ProvisionedCloudTargets> {
  const provisionedTargets = new ProvisionedCloudTargets();
  try {
    for (const targetUrl of options.targetUrls) {
      const adminToken = options.cloudAuth?.adminTokenFor(targetUrl);
      if (!adminToken) {
        continue;
      }
      console.log(`\n🔑 Provisioning a service account for ${new URL(targetUrl).origin}...`);
      const env = new SharedCloudStackEnvironment(adminToken, targetUrl, options.verbose);
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
      await new SharedCloudStackEnvironment(adminToken, targetUrl, options.verbose).sweepOrphans();
    }
  }
}
