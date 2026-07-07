export type CloudChainEnvironmentKind = 'shared' | 'pool';

export type CloudChainRetireOutcome = 'passed' | 'failed' | 'provisioning_failed' | 'cancelled' | 'runner_error';

export interface ProvisionedCloudTarget {
  kind: CloudChainEnvironmentKind;
  targetUrl: string;
  token: string;
  stackSlug?: string;
}

export interface ProvisionedCloudStack extends ProvisionedCloudTarget {
  kind: 'pool';
  stackSlug: string;
}
export interface CloudChainTeardownContext {
  outcome?: CloudChainRetireOutcome;
  used?: boolean;
  summary?: string;
}

export interface CloudChainTeardownTarget {
  teardownChain(context?: CloudChainTeardownContext): Promise<string[]>;
}

export interface CloudChainEnvironment extends CloudChainTeardownTarget {
  provisionChain(): Promise<ProvisionedCloudTarget>;
}
