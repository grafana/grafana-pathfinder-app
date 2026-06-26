import { cloudInstanceUrl, hasCloudAuth, sameOrigin, type CloudAuthTargets } from './e2e-targets';

export interface CloudAuthConfigInput {
  cloudUrl: string;
  username?: string;
  password?: string;
  serviceAccountToken?: string;
  cloudAdminToken?: string;
  instanceTokenSpecs?: string[];
  env?: NodeJS.ProcessEnv;
}

export interface RunnerAuth {
  username?: string;
  password?: string;
  token?: string;
}

export interface CloudAuthPolicy {
  targets: CloudAuthTargets;
  needsProvisioningFor(targetUrl: string | undefined): boolean;
  runnerAuthFor(targetUrl: string | undefined, provisionedToken?: string): RunnerAuth;
}

interface InstanceTokenConfig {
  tokensByOrigin: Map<string, string>;
  targetUrls: string[];
}

function parseInstanceTokenSpecs(specs: string[] | undefined, env: NodeJS.ProcessEnv): InstanceTokenConfig {
  const tokensByOrigin = new Map<string, string>();
  const targetUrls: string[] = [];

  for (const spec of specs ?? []) {
    const separator = spec.indexOf('=');
    if (separator <= 0 || separator === spec.length - 1) {
      throw new Error(`Invalid --instance-token value "${spec}". Expected host=ENV_VAR_NAME.`);
    }

    const host = spec.slice(0, separator);
    const envName = spec.slice(separator + 1);
    const targetUrl = cloudInstanceUrl(host);
    if (!targetUrl) {
      throw new Error(`Invalid --instance-token host "${host}". Expected a bare hostname.`);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) {
      throw new Error(`Invalid --instance-token env var "${envName}" for ${host}.`);
    }

    const token = env[envName];
    if (!token) {
      throw new Error(`--instance-token ${host} references unset or empty environment variable ${envName}.`);
    }

    const origin = new URL(targetUrl).origin;
    if (tokensByOrigin.has(origin)) {
      throw new Error(`Duplicate --instance-token entry for ${host}.`);
    }
    tokensByOrigin.set(origin, token);
    targetUrls.push(targetUrl);
  }

  return { tokensByOrigin, targetUrls };
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
  const defaultAuth = {
    username: input.username ?? env.GRAFANA_USER,
    password: input.password ?? env.GRAFANA_PASSWORD,
    token: input.serviceAccountToken ?? env.GRAFANA_TOKEN,
  };
  const instanceTokenConfig = parseInstanceTokenSpecs(input.instanceTokenSpecs, env);
  const adminToken = input.cloudAdminToken ?? env.GRAFANA_ADMIN_TOKEN;
  const hasDefaultCredentials = hasCloudAuth(defaultAuth);

  return {
    targets: {
      reusable: [...(hasDefaultCredentials ? [input.cloudUrl] : []), ...instanceTokenConfig.targetUrls],
      provisionable: adminToken ? input.cloudUrl : undefined,
    },
    needsProvisioningFor(targetUrl) {
      return Boolean(adminToken) && sameOrigin(targetUrl, input.cloudUrl);
    },
    runnerAuthFor(targetUrl, provisionedToken) {
      if (provisionedToken && sameOrigin(targetUrl, input.cloudUrl)) {
        return { token: provisionedToken };
      }
      if (sameOrigin(targetUrl, input.cloudUrl)) {
        return defaultAuth;
      }
      return { token: tokenForTarget(instanceTokenConfig.tokensByOrigin, targetUrl) };
    },
  };
}
