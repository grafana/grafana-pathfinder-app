import { cloudInstanceUrl, sameOrigin, type CloudTargetCapabilities } from './e2e-targets';

export interface CloudAuthConfigInput {
  cloudInstanceAdminTokenSpecs?: string[];
  env?: NodeJS.ProcessEnv;
}

export interface RunnerAuth {
  token?: string;
}

export interface CloudAuthPolicy {
  targets: CloudTargetCapabilities;
  adminTokenFor(targetUrl: string | undefined): string | undefined;
  needsProvisioningFor(targetUrl: string | undefined): boolean;
  runnerAuthFor(targetUrl: string | undefined, provisionedToken?: string): RunnerAuth;
}

interface CloudInstanceAdminTokenConfig {
  adminTokensByOrigin: Map<string, string>;
  targetUrls: string[];
}

function parseCloudInstanceAdminTokenSpecs(
  specs: string[] | undefined,
  env: NodeJS.ProcessEnv
): CloudInstanceAdminTokenConfig {
  const adminTokensByOrigin = new Map<string, string>();
  const targetUrls: string[] = [];

  for (const spec of specs ?? []) {
    const separator = spec.indexOf('=');
    if (separator <= 0 || separator === spec.length - 1) {
      throw new Error(`Invalid --cloud-instance-admin-token value "${spec}". Expected host=ENV_VAR_NAME.`);
    }

    const host = spec.slice(0, separator);
    const envName = spec.slice(separator + 1);
    const targetUrl = cloudInstanceUrl(host);
    if (!targetUrl) {
      throw new Error(`Invalid --cloud-instance-admin-token host "${host}". Expected a bare hostname.`);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) {
      throw new Error(`Invalid --cloud-instance-admin-token env var "${envName}" for ${host}.`);
    }

    const token = env[envName];
    if (!token) {
      throw new Error(
        `--cloud-instance-admin-token ${host} references unset or empty environment variable ${envName}.`
      );
    }

    const origin = new URL(targetUrl).origin;
    if (adminTokensByOrigin.has(origin)) {
      throw new Error(`Duplicate --cloud-instance-admin-token entry for ${host}.`);
    }
    adminTokensByOrigin.set(origin, token);
    targetUrls.push(targetUrl);
  }

  return { adminTokensByOrigin, targetUrls };
}

function tokenForTarget(tokensByOrigin: Map<string, string>, targetUrl: string | undefined): string | undefined {
  if (!targetUrl) {
    return undefined;
  }
  for (const [origin, token] of tokensByOrigin) {
    if (sameOrigin(origin, targetUrl)) {
      return token;
    }
  }
  return undefined;
}

export function createCloudAuthPolicy(input: CloudAuthConfigInput): CloudAuthPolicy {
  const env = input.env ?? process.env;
  const adminTokenConfig = parseCloudInstanceAdminTokenSpecs(input.cloudInstanceAdminTokenSpecs, env);

  return {
    targets: {
      sharedStackUrls: adminTokenConfig.targetUrls,
    },
    adminTokenFor(targetUrl) {
      return tokenForTarget(adminTokenConfig.adminTokensByOrigin, targetUrl);
    },
    needsProvisioningFor(targetUrl) {
      return Boolean(this.adminTokenFor(targetUrl));
    },
    runnerAuthFor(targetUrl, provisionedToken) {
      if (provisionedToken && this.needsProvisioningFor(targetUrl)) {
        return { token: provisionedToken };
      }
      return {};
    },
  };
}
