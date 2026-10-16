import { createCloudAuthPolicy } from './cloud-auth';
import { unsafeCloudGuidesInChain, unsafeSharedStackMessage, unsafeSharedStackSkipResults } from './cloud-routing';
import { ExitCode } from './exit-codes';
import type { PackageMeta } from './e2e-results';

describe('unsafeCloudGuidesInChain', () => {
  it('returns cloud guides with unsafe or missing side-effect classifications', () => {
    const packageMetaById = new Map<string, PackageMeta>([
      [
        'readonly-cloud',
        { packageId: 'readonly-cloud', tier: 'cloud', sideEffects: { level: 'readonly', reasons: [] } },
      ],
      [
        'mutating-cloud',
        {
          packageId: 'mutating-cloud',
          tier: 'cloud',
          sideEffects: {
            level: 'mutating',
            reasons: [{ level: 'mutating', path: 'blocks[0]', message: 'Button target looks state-changing: Save' }],
          },
        },
      ],
      ['unknown-cloud', { packageId: 'unknown-cloud', tier: 'cloud' }],
      [
        'local-mutating',
        { packageId: 'local-mutating', tier: 'local', sideEffects: { level: 'mutating', reasons: [] } },
      ],
    ]);

    expect(
      unsafeCloudGuidesInChain(
        [{ id: 'readonly-cloud' }, { id: 'mutating-cloud' }, { id: 'unknown-cloud' }, { id: 'local-mutating' }],
        packageMetaById
      ).map((guide) => guide.id)
    ).toEqual(['mutating-cloud', 'unknown-cloud']);
  });

  it('formats the shared-stack skip message', () => {
    expect(unsafeSharedStackMessage(['mutating-cloud', 'unknown-cloud'])).toBe(
      'Cloud chain contains unsafe guide(s) mutating-cloud, unknown-cloud and requires an isolated stack path'
    );
  });

  it('builds the skip result contract used by unsafe shared-stack routing', () => {
    const sideEffects = {
      level: 'mutating' as const,
      reasons: [{ level: 'mutating' as const, path: 'blocks[0]', message: 'Button target looks state-changing: Save' }],
    };
    const packageMetaById = new Map<string, PackageMeta>([
      [
        'mutating-cloud',
        { packageId: 'mutating-cloud', tier: 'cloud', targetUrl: 'https://learn.grafana.net/', sideEffects },
      ],
    ]);
    const message = unsafeSharedStackMessage(['mutating-cloud']);

    expect(
      unsafeSharedStackSkipResults(
        [
          {
            id: 'mutating-cloud',
            guide: { path: 'https://cdn.test/mutating-cloud/content.json' },
            autoIncluded: true,
          },
        ],
        packageMetaById,
        message
      )
    ).toEqual([
      {
        guide: 'https://cdn.test/mutating-cloud/content.json',
        id: 'mutating-cloud',
        status: 'skipped_unsafe_shared_stack',
        exitCode: ExitCode.SUCCESS,
        autoIncluded: true,
        abortMessage: message,
        tier: 'cloud',
        sideEffects,
      },
    ]);
  });
});

describe('exact-host mutation chain gate', () => {
  const auth = createCloudAuthPolicy({
    cloudInstanceAdminTokenSpecs: ['docs.example=DOCS', 'play.grafana.org=PLAY'],
    allowCloudInstanceMutations: ['docs.example'],
    env: { DOCS: 'docs-admin', PLAY: 'play-admin' },
  });

  it.each(['mutating', 'possibly_mutating', 'unknown', undefined] as const)(
    'permits %s only on its own authorized target',
    (level) => {
      const meta = (targetUrl?: string): PackageMeta => ({
        packageId: 'guide',
        tier: 'cloud',
        targetUrl,
        ...(level ? { sideEffects: { level, reasons: [] } } : {}),
      });
      const chain = [{ id: 'authorized' }, { id: 'wrong-host' }, { id: 'missing-target' }];
      const metadata = new Map([
        ['authorized', meta('https://docs.example/')],
        ['wrong-host', meta('https://play.grafana.org/')],
        ['missing-target', meta()],
      ]);
      expect(unsafeCloudGuidesInChain(chain, metadata, auth).map((guide) => guide.id)).toEqual([
        'wrong-host',
        'missing-target',
      ]);
      expect(unsafeCloudGuidesInChain(chain, metadata).map((guide) => guide.id)).toEqual(
        chain.map((guide) => guide.id)
      );
      expect(metadata.get('authorized')?.sideEffects?.level).toBe(level);
    }
  );

  it('keeps readonly chains unchanged without mutation permission', () => {
    const metadata = new Map<string, PackageMeta>([
      ['guide', { packageId: 'guide', tier: 'cloud', sideEffects: { level: 'readonly', reasons: [] } }],
    ]);
    expect(unsafeCloudGuidesInChain([{ id: 'guide' }], metadata)).toEqual([]);
  });
});
