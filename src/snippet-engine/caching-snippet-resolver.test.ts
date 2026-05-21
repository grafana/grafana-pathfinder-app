import { CachingSnippetResolver } from './caching-snippet-resolver';
import type { JsonSnippet, SnippetCatalog } from '../types/json-snippet.types';
import type { SnippetCatalogProvider, SnippetResolution, SnippetResolver } from './types';

function snippet(id: string): JsonSnippet {
  return { id, title: id, description: `desc for ${id}`, blocks: [{ type: 'markdown', content: 'x' }] };
}

class StubResolver implements SnippetResolver, SnippetCatalogProvider {
  public resolveCalls = 0;
  public listCalls = 0;
  constructor(
    private readonly resolveImpl: (id: string) => Promise<SnippetResolution> | SnippetResolution,
    private readonly catalog: SnippetCatalog = {}
  ) {}
  async resolve(id: string) {
    this.resolveCalls += 1;
    return this.resolveImpl(id);
  }
  async list() {
    this.listCalls += 1;
    return this.catalog;
  }
}

describe('CachingSnippetResolver', () => {
  it('passes resolutions through from the inner resolver', async () => {
    const inner = new StubResolver((id) => ({ ok: true, id, source: 'online-cdn', snippet: snippet(id) }));
    const cache = new CachingSnippetResolver(inner);

    const result = await cache.resolve('foo');

    expect(result.ok).toBe(true);
    expect(inner.resolveCalls).toBe(1);
  });

  it('caches successful resolutions within the TTL', async () => {
    const inner = new StubResolver((id) => ({ ok: true, id, source: 'online-cdn', snippet: snippet(id) }));
    let now = 0;
    const cache = new CachingSnippetResolver(inner, { ttlMs: 1000, now: () => now });

    await cache.resolve('foo');
    await cache.resolve('foo');
    expect(inner.resolveCalls).toBe(1);

    now = 1500;
    await cache.resolve('foo');
    expect(inner.resolveCalls).toBe(2);
  });

  it('does not cache failures', async () => {
    const inner = new StubResolver((id) => ({ ok: false, id, error: { code: 'network-error', message: 'down' } }));
    const cache = new CachingSnippetResolver(inner, { ttlMs: 1000, now: () => 0 });

    await cache.resolve('foo');
    await cache.resolve('foo');

    expect(inner.resolveCalls).toBe(2);
  });

  it('dedupes concurrent in-flight requests for the same id', async () => {
    let resolveSlowFetch: ((value: SnippetResolution) => void) | undefined;
    const inner = new StubResolver(
      () =>
        new Promise<SnippetResolution>((resolve) => {
          resolveSlowFetch = resolve;
        })
    );
    const cache = new CachingSnippetResolver(inner);

    const a = cache.resolve('foo');
    const b = cache.resolve('foo');
    expect(inner.resolveCalls).toBe(1);

    resolveSlowFetch!({ ok: true, id: 'foo', source: 'online-cdn', snippet: snippet('foo') });
    const [resA, resB] = await Promise.all([a, b]);
    expect(resA).toBe(resB);
  });

  it('delegates list() to the inner resolver', async () => {
    const inner = new StubResolver(() => ({ ok: false, id: 'x', error: { code: 'not-found', message: '' } }), {
      foo: { id: 'foo', title: 'Foo', description: 'foo desc' },
    });
    const cache = new CachingSnippetResolver(inner);

    const catalog = await cache.list();

    expect(catalog.foo?.title).toBe('Foo');
    expect(inner.listCalls).toBe(1);
  });
});
