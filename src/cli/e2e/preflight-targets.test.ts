import type { CloudAuthPolicy } from './cloud-auth';
import type { CloudStackPoolManagerConfig } from './cloud-stack-pool-manager';
import type { PackageMeta } from './e2e-results';
import type { ExecutionPlan, PlannedGuide } from './guide-chains';
import { assertTierHomogeneousChains, preflightTargetUrlsForPlan } from './preflight-targets';

const GLOBAL_URL = 'http://localhost:3000';
const READONLY_SHARED_URL = 'https://learn.grafana.net/';
const MUTATING_SHARED_URL = 'https://mutating.grafana.net/';
const DEPENDENT_SHARED_URL = 'https://dependent.grafana.net/';
const NO_AUTH_SHARED_URL = 'https://no-auth.grafana.net/';

const cloudAuth: CloudAuthPolicy = {
  targets: { sharedStackUrls: [READONLY_SHARED_URL, MUTATING_SHARED_URL, DEPENDENT_SHARED_URL] },
  adminTokenFor: (targetUrl) => {
    if (targetUrl === READONLY_SHARED_URL || targetUrl === MUTATING_SHARED_URL || targetUrl === DEPENDENT_SHARED_URL) {
      return 'admin-token';
    }
    return undefined;
  },
  needsProvisioningFor(targetUrl) {
    return Boolean(this.adminTokenFor(targetUrl));
  },
};

const cloudStackPoolManagerConfig: CloudStackPoolManagerConfig = {
  managerUrl: 'https://pool.example/',
  tokenEnvVar: 'POOL_MANAGER_TOKEN',
  token: 'manager-token',
  poolId: 'nightly',
};

function plannedGuide(id: string, dependencies: string[] = []): PlannedGuide {
  return {
    id,
    guide: {
      path: `${id}/content.json`,
      content: JSON.stringify({ id, title: id, schemaVersion: '1.1.0', type: 'guide', blocks: [] }),
    },
    dependencies,
    autoIncluded: false,
  };
}

function planWithMutatingCloudChain(): ExecutionPlan {
  return {
    chains: [
      [plannedGuide('local')],
      [plannedGuide('readonly-cloud')],
      [plannedGuide('mutating-cloud'), plannedGuide('dependent-cloud', ['mutating-cloud'])],
    ],
    autoIncludedIds: [],
    errors: [],
  };
}

function packageMetaWithMutatingCloudChain(): Map<string, PackageMeta> {
  return new Map<string, PackageMeta>([
    ['local', { packageId: 'local', tier: 'local' }],
    [
      'readonly-cloud',
      {
        packageId: 'readonly-cloud',
        tier: 'cloud',
        targetUrl: READONLY_SHARED_URL,
        sideEffects: { level: 'readonly', reasons: [] },
      },
    ],
    [
      'mutating-cloud',
      {
        packageId: 'mutating-cloud',
        tier: 'cloud',
        targetUrl: MUTATING_SHARED_URL,
        sideEffects: { level: 'mutating', reasons: [] },
      },
    ],
    [
      'dependent-cloud',
      {
        packageId: 'dependent-cloud',
        tier: 'cloud',
        targetUrl: DEPENDENT_SHARED_URL,
        sideEffects: { level: 'readonly', reasons: [] },
      },
    ],
  ]);
}

describe('e2e preflight targets', () => {
  it('rejects mixed-tier dependency chains before target selection', () => {
    const plan: ExecutionPlan = {
      chains: [[plannedGuide('local'), plannedGuide('mutating-cloud', ['local'])]],
      autoIncludedIds: [],
      errors: [],
    };
    const packageMetaById = new Map<string, PackageMeta>([
      ['local', { packageId: 'local', tier: 'local' }],
      ['mutating-cloud', { packageId: 'mutating-cloud', tier: 'cloud' }],
    ]);

    expect(() => assertTierHomogeneousChains(plan, packageMetaById)).toThrow(
      'Invalid E2E execution plan: dependency chain mixes test environment tiers (local:local → mutating-cloud:cloud).'
    );
  });

  it('allows homogeneous chains and defaults unmanaged guides to local tier', () => {
    const plan: ExecutionPlan = {
      chains: [[plannedGuide('local'), plannedGuide('unmanaged', ['local'])], [plannedGuide('mutating-cloud')]],
      autoIncludedIds: [],
      errors: [],
    };
    const packageMetaById = new Map<string, PackageMeta>([
      ['local', { packageId: 'local', tier: 'local' }],
      ['mutating-cloud', { packageId: 'mutating-cloud', tier: 'cloud' }],
    ]);

    expect(() => assertTierHomogeneousChains(plan, packageMetaById)).not.toThrow();
  });
  it('excludes guides routed through manager cloud stacks from original target preflight checks', () => {
    const targets = preflightTargetUrlsForPlan({
      plan: planWithMutatingCloudChain(),
      packageMetaById: packageMetaWithMutatingCloudChain(),
      cloudAuth,
      cloudStackPoolManagerConfig,
      globalUrl: GLOBAL_URL,
    });

    expect(targets).toEqual([GLOBAL_URL, READONLY_SHARED_URL]);
  });

  it('excludes unsafe cloud chains when no manager cloud stack is configured', () => {
    const targets = preflightTargetUrlsForPlan({
      plan: planWithMutatingCloudChain(),
      packageMetaById: packageMetaWithMutatingCloudChain(),
      cloudAuth,
      cloudStackPoolManagerConfig: undefined,
      globalUrl: GLOBAL_URL,
    });

    expect(targets).toEqual([GLOBAL_URL, READONLY_SHARED_URL]);
  });

  it('excludes readonly cloud guides that lack shared stack auth when manager stacks are available', () => {
    const plan: ExecutionPlan = {
      chains: [[plannedGuide('local')], [plannedGuide('readonly-no-auth-cloud')]],
      autoIncludedIds: [],
      errors: [],
    };
    const packageMetaById = new Map<string, PackageMeta>([
      ['local', { packageId: 'local', tier: 'local' }],
      [
        'readonly-no-auth-cloud',
        {
          packageId: 'readonly-no-auth-cloud',
          tier: 'cloud',
          targetUrl: NO_AUTH_SHARED_URL,
          sideEffects: { level: 'readonly', reasons: [] },
        },
      ],
    ]);

    const targets = preflightTargetUrlsForPlan({
      plan,
      packageMetaById,
      cloudAuth,
      cloudStackPoolManagerConfig,
      globalUrl: GLOBAL_URL,
    });

    expect(targets).toEqual([GLOBAL_URL]);
  });

  it('excludes guides routed through pool-manager cloud stacks from original target preflight checks', () => {
    const targets = preflightTargetUrlsForPlan({
      plan: planWithMutatingCloudChain(),
      packageMetaById: packageMetaWithMutatingCloudChain(),
      cloudAuth,
      cloudStackPoolManagerConfig,
      globalUrl: GLOBAL_URL,
    });

    expect(targets).toEqual([GLOBAL_URL, READONLY_SHARED_URL]);
  });
});
