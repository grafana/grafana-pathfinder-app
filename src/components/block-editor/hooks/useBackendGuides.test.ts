/**
 * Tests for useBackendGuides' write paths. A PUT to the App Platform replaces
 * the whole object, so every write has to carry through the parts of the
 * resource the block editor has no model for — `spec.manifest` (what makes a
 * learning path a path) and `metadata.annotations` (upload-script provenance).
 */
import { renderHook, waitFor, act } from '@testing-library/react';

const mockUser: { name?: string; login?: string; email: string } = {
  name: 'Sam Rivera',
  login: 'sam',
  email: 'sam@example.com',
};

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
  config: {
    namespace: 'stacks-1',
    get bootData() {
      return { user: mockUser };
    },
  },
}));

jest.mock('../../../lib/custom-guide-repository-client', () => ({
  fetchCustomGuideCatalogue: jest.fn(),
}));

jest.mock('../../../lib/analytics', () => ({
  ...jest.requireActual('../../../lib/analytics'),
  reportAppInteraction: jest.fn(),
}));

jest.mock('../../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { getBackendSrv } from '@grafana/runtime';
import { of, throwError } from 'rxjs';

import { fetchCustomGuideCatalogue } from '../../../lib/custom-guide-repository-client';
import { logger } from '../../../lib/logging';
import { reportAppInteraction } from '../../../lib/analytics';
import { CURRENT_SCHEMA_VERSION } from '../../../types/json-guide.schema';
import { PERSISTED_DIVIDER_MARKDOWN } from '../../../types/app-platform-guide-compat';
import { guideReadUrl } from '../../../utils/interactive-guides-api';
import type { JsonGuide } from '../types';
import { hasManageableBackendGuides, useBackendGuides } from './useBackendGuides';

const mockFetch = jest.fn();

// `type` is deliberately not one of the CRD's three values: it proves the editor passes an inherited
// type through rather than recognising a whitelist, and that an unrecognised type gets no stats stamp.
const MANIFEST: Record<string, unknown> = {
  id: 'alerting-path',
  type: 'learning-journey',
  // The CRD defaults `repository` on write, so a manifest read back off a resource always carries
  // one. Modelling that is what keeps the byte-identical replay below honest.
  repository: 'app-platform',
  author: { name: 'Enablement', team: 'Docs' },
  milestones: [
    { id: 'alerting-intro', title: 'Intro' },
    { id: 'alerting-rules', title: 'Rules' },
  ],
};

const ANNOTATIONS = {
  'pathfinderbackend.ext.grafana.app/managed-by': 'upsert-learning-path.sh',
  'pathfinderbackend.ext.grafana.app/source-package': 'alerting-enablement',
};

interface StoredGuide {
  metadata: Record<string, unknown> & { name: string; namespace: string };
  spec: {
    id: string;
    title: string;
    schemaVersion: string;
    blocks: Array<{ id: string; type: string; content: string }>;
    status: 'draft' | 'published';
    manifest?: Record<string, unknown>;
  };
}

/** A path cover page as the upload script leaves it on the backend. */
function pathCoverPage(): StoredGuide {
  return {
    metadata: {
      name: 'alerting-path',
      namespace: 'stacks-1',
      uid: 'uid-1',
      resourceVersion: '42',
      creationTimestamp: '2026-01-01T00:00:00Z',
      annotations: { ...ANNOTATIONS },
      labels: { tier: 'gold' },
    },
    spec: {
      id: 'alerting-path',
      title: 'Alerting enablement',
      schemaVersion: '1.0',
      blocks: [{ id: 'b1', type: 'markdown', content: 'Welcome' }],
      status: 'published' as const,
      manifest: MANIFEST,
    },
  };
}

/** The JsonGuide the guide library builds from a backend resource on load. */
function loadedGuide(resource: StoredGuide): JsonGuide {
  return {
    id: resource.spec.id,
    title: resource.spec.title,
    schemaVersion: resource.spec.schemaVersion || '1.0',
    blocks: resource.spec.blocks,
  } as JsonGuide;
}

/** What the single-guide read proxy serves; independent of the list so the two can disagree. */
let serverGuides: StoredGuide[] = [];

function serveFetch(request: { url: string; method: string }) {
  if (request.method !== 'GET') {
    return of({ data: {} });
  }
  const name = new URL(request.url, 'http://localhost').searchParams.get('name');
  const found = serverGuides.find((g) => g.metadata.name === name);
  return found ? of({ data: found }) : throwError(() => ({ status: 404, data: { message: 'not found' } }));
}

function writes() {
  return mockFetch.mock.calls.map(([request]) => request).filter((request) => request.method !== 'GET');
}

/** The slim catalogue entry the library lists for a stored guide: no blocks, no resourceVersion. */
function catalogueEntry(guide: StoredGuide) {
  return { id: guide.spec.id, name: guide.metadata.name, title: guide.spec.title, status: guide.spec.status };
}

function serveCatalogue(items: StoredGuide[]) {
  (fetchCustomGuideCatalogue as jest.Mock).mockResolvedValue({ available: true, entries: items.map(catalogueEntry) });
}

async function renderLoaded(items: StoredGuide[], server: StoredGuide[] = items) {
  serverGuides = server;
  serveCatalogue(items);
  const { result } = renderHook(() => useBackendGuides());
  await waitFor(() => expect(result.current.hasLoaded).toBe(true));
  return result;
}

function lastRequest() {
  return mockFetch.mock.calls[mockFetch.mock.calls.length - 1]![0];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser.name = 'Sam Rivera';
  mockUser.login = 'sam';
  serverGuides = [];
  mockFetch.mockImplementation(serveFetch);
  (getBackendSrv as jest.Mock).mockReturnValue({ fetch: mockFetch });
});

describe('saveGuide — round-trip of fields the editor does not own', () => {
  it('replays a loaded path cover page byte-identically when nothing was edited', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource]);

    await act(async () => {
      await result.current.saveGuide(loadedGuide(resource), 'alerting-path', resource.metadata, 'published');
    });

    const request = lastRequest();
    expect(request.method).toBe('PUT');
    // Byte-identical: the derived manifest owns nothing on a metapackage cover page, so a save that
    // changed no content replays the stored spec exactly.
    expect(request.data.spec).toEqual(resource.spec);
    expect(request.data.metadata).toEqual({
      name: 'alerting-path',
      namespace: 'stacks-1',
      resourceVersion: '42',
      annotations: ANNOTATIONS,
      labels: { tier: 'gold' },
    });
  });

  it('keeps spec.manifest while applying the edit the author made', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource]);

    const edited = { ...loadedGuide(resource), title: 'Alerting enablement, revised' };
    await act(async () => {
      await result.current.saveGuide(edited, 'alerting-path', resource.metadata, 'draft');
    });

    const { spec } = lastRequest().data;
    expect(spec.manifest).toEqual(MANIFEST);
    expect(spec.title).toBe('Alerting enablement, revised');
    expect(spec.status).toBe('draft');
  });

  it('preserves annotations when the caller passes no metadata for a known resource', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource]);

    await act(async () => {
      await result.current.saveGuide(loadedGuide(resource), 'alerting-path');
    });

    expect(lastRequest().data.metadata.annotations).toEqual(ANNOTATIONS);
  });

  it('does not inherit a foreign manifest when overwriting a name collision', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource]);

    const unrelated = {
      id: 'alerting-path',
      title: 'Alerting path',
      blocks: [{ id: 'b1', type: 'markdown', content: 'my own notes' }],
    } as JsonGuide;
    await act(async () => {
      await result.current.saveGuide(unrelated, 'alerting-path', resource.metadata, 'draft', true);
    });

    const { spec, metadata } = lastRequest().data;
    // Inheriting would render this flat guide as the old path, with the old milestones. It gets a
    // freshly derived guide manifest instead — the point is that nothing comes from the old resource.
    expect(spec.manifest.type).toBe('guide');
    expect(spec.manifest.milestones).toBeUndefined();
    expect(spec.manifest.id).toBeUndefined();
    // Nor does it inherit the old resource's author: the overwriting guide is the signed-in user's.
    expect(spec.manifest.author).toEqual({ name: 'Sam Rivera' });
    // Inheriting would let the upload script's ownership guard pass on content it never wrote.
    expect(metadata.annotations).toBeUndefined();
    expect(metadata.labels).toBeUndefined();
    // The concurrency guard still applies — the overwrite is of a real, versioned resource.
    expect(metadata.resourceVersion).toBe('42');
  });

  it('saves a guide that is missing from the loaded list, reading it through the single-guide proxy', async () => {
    const resource = pathCoverPage();
    // The list truncates silently on large instances, so the stored guide can be absent from it.
    const result = await renderLoaded([], [resource]);

    await act(async () => {
      await result.current.saveGuide(loadedGuide(resource), 'alerting-path', undefined, 'draft');
    });

    expect(mockFetch.mock.calls[0]![0]).toMatchObject({ url: guideReadUrl('alerting-path'), method: 'GET' });
    expect(lastRequest().method).toBe('PUT');
    expect(lastRequest().data.spec.manifest).toEqual(MANIFEST);
    expect(lastRequest().data.metadata.resourceVersion).toBe('42');
  });

  it('takes resourceVersion from the read, not from a stale loaded list', async () => {
    const listed = pathCoverPage();
    const stored = pathCoverPage();
    stored.metadata.resourceVersion = '43';
    const result = await renderLoaded([listed], [stored]);

    await act(async () => {
      await result.current.saveGuide(loadedGuide(stored), 'alerting-path', { name: 'alerting-path' }, 'draft');
    });

    expect(lastRequest().data.metadata.resourceVersion).toBe('43');
  });

  it('refuses to update a resource the server reports missing', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource], []);

    await act(async () => {
      await expect(
        result.current.saveGuide(loadedGuide(resource), 'alerting-path', undefined, 'draft')
      ).rejects.toThrow(`Could not read the saved guide "alerting-path"`);
    });
    expect(writes()).toHaveLength(0);
  });

  it('refuses without touching the catalogue, so a live error and the guide-library entry both survive', async () => {
    const resource = pathCoverPage();
    (fetchCustomGuideCatalogue as jest.Mock).mockResolvedValueOnce({
      available: false,
      reason: 'obo-unavailable',
      entries: [],
    });
    const { result } = renderHook(() => useBackendGuides());
    await waitFor(() => expect(result.current.hasLoaded).toBe(true));
    // The failed initial list is what keeps the guide-library entry visible.
    expect(hasManageableBackendGuides(result.current)).toBe(true);

    await act(async () => {
      await expect(
        result.current.saveGuide(loadedGuide(resource), 'alerting-path', undefined, 'draft')
      ).rejects.toThrow('Could not read the saved guide');
    });

    expect(result.current.error).toBe('The guide library is unavailable (obo-unavailable).');
    expect(hasManageableBackendGuides(result.current)).toBe(true);
  });

  it('surfaces a failed read as an error carrying its status and message, not as an absent resource', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource]);
    mockFetch.mockImplementation((request) =>
      request.method === 'GET'
        ? throwError(() => ({ status: 503, data: { error: 'app platform read failed' } }))
        : serveFetch(request)
    );

    for (const write of [
      () => result.current.saveGuide(loadedGuide(resource), 'alerting-path', undefined, 'draft'),
      () => result.current.publishGuide('alerting-path'),
      () => result.current.unpublishGuide('alerting-path'),
    ]) {
      await act(async () => {
        const failure = await write().catch((err: unknown) => err);
        // The save flow shows `message` only for Error instances; anything else toasts "Unknown error".
        expect(failure).toBeInstanceOf(Error);
        expect(failure).toMatchObject({
          status: 503,
          message: 'Could not read the saved guide "alerting-path": app platform read failed (HTTP 503)',
        });
      });
    }
    expect(writes()).toHaveLength(0);
  });

  it("keeps the caller's stale resourceVersion over the read, so a concurrent write still conflicts", async () => {
    const listed = pathCoverPage();
    const stored = pathCoverPage();
    stored.metadata.resourceVersion = '43';
    const result = await renderLoaded([listed], [stored]);

    await act(async () => {
      await result.current.saveGuide(loadedGuide(listed), 'alerting-path', listed.metadata, 'draft');
    });

    expect(lastRequest().data.metadata.resourceVersion).toBe('42');
  });

  it("falls back to the read's resourceVersion when caller metadata omits it", async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource]);

    await act(async () => {
      // A caller handing over partial metadata must not silently drop the conflict check.
      await result.current.saveGuide(loadedGuide(resource), 'alerting-path', { name: 'alerting-path' }, 'draft');
    });

    expect(lastRequest().data.metadata.resourceVersion).toBe('42');
  });

  it('publish and unpublish write the metadata they read, not a stale loaded list', async () => {
    const listed = pathCoverPage();
    const stored = pathCoverPage();
    stored.metadata.resourceVersion = '43';
    stored.metadata.annotations = { ...ANNOTATIONS, 'pathfinderbackend.ext.grafana.app/source-package': 'renamed' };
    const result = await renderLoaded([listed], [stored]);

    for (const write of [result.current.publishGuide, result.current.unpublishGuide]) {
      await act(async () => {
        await write('alerting-path');
      });
      expect(lastRequest().data.metadata.resourceVersion).toBe('43');
      expect(lastRequest().data.metadata.annotations).toEqual(stored.metadata.annotations);
    }
  });

  it('creates a brand-new guide as a complete package, with no inherited annotations', async () => {
    const result = await renderLoaded([]);

    const guide = { id: 'fresh', title: 'Fresh guide', blocks: [{ id: 'b1', type: 'markdown', content: 'hi' }] };
    await act(async () => {
      await result.current.saveGuide(guide as JsonGuide);
    });

    const request = lastRequest();
    expect(request.method).toBe('POST');
    expect(request.data.spec).toEqual({
      id: 'fresh',
      title: 'Fresh guide',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      blocks: guide.blocks,
      status: 'draft',
      manifest: {
        type: 'guide',
        repository: 'app-platform',
        additionalFields: {
          stats: { version: 2, blockCount: 1, sectionCount: 0, completableBlockCount: 0, finalCompletablePosition: 0 },
        },
        author: { name: 'Sam Rivera' },
      },
    });
    expect(request.data.metadata).toEqual({ name: 'fresh', namespace: 'stacks-1' });
  });

  it('stamps the schema version the editor emits, not a stale literal', async () => {
    const result = await renderLoaded([]);

    // getGuide() never returns a schemaVersion, so every editor save takes the fallback.
    const guide = { id: 'fresh', title: 'Fresh guide', blocks: [] };
    await act(async () => {
      await result.current.saveGuide(guide as JsonGuide);
    });

    expect(lastRequest().data.spec.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(lastRequest().data.spec.schemaVersion).not.toBe('1.0');
  });

  it('persists dividers in the rollback-compatible markdown representation', async () => {
    const result = await renderLoaded([]);
    const guide = {
      id: 'divider-guide',
      title: 'Divider guide',
      blocks: [{ id: 'divider-1', type: 'divider' }],
    } as JsonGuide;

    await act(async () => {
      await result.current.saveGuide(guide);
    });

    expect(lastRequest().data.spec.blocks).toEqual([
      { id: 'divider-1', type: 'markdown', content: PERSISTED_DIVIDER_MARKDOWN },
    ]);
  });

  it('does not borrow a manifest from an unrelated resource in the loaded list', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource]);

    const guide = { id: 'other', title: 'Other', blocks: [{ id: 'b1', type: 'markdown', content: 'hi' }] };
    await act(async () => {
      await result.current.saveGuide(guide as JsonGuide);
    });

    // A freshly derived guide manifest, carrying nothing from the path in the list.
    const { manifest } = lastRequest().data.spec;
    expect(manifest.type).toBe('guide');
    expect(manifest.milestones).toBeUndefined();
    expect(manifest.id).toBeUndefined();
  });
});

describe('saveGuide — startingLocation provenance', () => {
  const highlight = (requirements?: string[]) => ({
    id: 'b2',
    type: 'interactive',
    action: 'highlight',
    reftarget: 'a[href="/explore"]',
    content: 'Click it',
    ...(requirements ? { requirements } : {}),
  });

  /** A plain guide as some other tool left it on the backend. */
  function uploadedGuide(manifest: Record<string, unknown>, blocks: unknown[]) {
    return {
      metadata: { name: 'my-guide', namespace: 'stacks-1', uid: 'uid-2', resourceVersion: '7' },
      spec: {
        id: 'my-guide',
        title: 'My guide',
        schemaVersion: '1.0',
        blocks,
        status: 'draft' as const,
        manifest,
      },
    };
  }

  function editedTitle(resource: ReturnType<typeof uploadedGuide>): JsonGuide {
    return {
      id: resource.spec.id,
      title: 'My guide, renamed',
      schemaVersion: resource.spec.schemaVersion,
      blocks: resource.spec.blocks,
    } as JsonGuide;
  }

  // The data-loss case: an uploaded package declares its own starting location,
  // nothing in the content derives one, and someone opens it in the editor to fix
  // a typo in the title. The metadata has to survive that.
  it('keeps an uploaded startingLocation through a title-only edit', async () => {
    const resource = uploadedGuide(
      { type: 'guide', repository: 'app-platform', additionalFields: { startingLocation: '/d/abc/uploaded' } },
      [{ id: 'b1', type: 'markdown', content: 'Welcome' }]
    );
    const result = await renderLoaded([resource as never]);

    await act(async () => {
      await result.current.saveGuide(editedTitle(resource), 'my-guide', resource.metadata, 'draft');
    });

    const { spec } = lastRequest().data;
    expect(spec.title).toBe('My guide, renamed');
    expect(spec.manifest.additionalFields.startingLocation).toBe('/d/abc/uploaded');
  });

  it('does not overwrite an uploaded startingLocation with one the content declares', async () => {
    const resource = uploadedGuide(
      { type: 'guide', repository: 'app-platform', additionalFields: { startingLocation: '/d/abc/uploaded' } },
      [highlight(['on-page:/explore'])]
    );
    const result = await renderLoaded([resource as never]);

    await act(async () => {
      await result.current.saveGuide(editedTitle(resource), 'my-guide', resource.metadata, 'draft');
    });

    expect(lastRequest().data.spec.manifest.additionalFields.startingLocation).toBe('/d/abc/uploaded');
  });

  // The other half of the same rule: what the editor derived, the editor clears.
  it('clears its own startingLocation when the author removes the requirement', async () => {
    const resource = uploadedGuide(
      { type: 'guide', repository: 'app-platform', additionalFields: { startingLocation: '/explore' } },
      [highlight(['on-page:/explore'])]
    );
    const result = await renderLoaded([resource as never]);

    const withoutRequirement = {
      id: 'my-guide',
      title: 'My guide',
      schemaVersion: '1.0',
      blocks: [highlight()],
    } as unknown as JsonGuide;

    await act(async () => {
      await result.current.saveGuide(withoutRequirement, 'my-guide', resource.metadata, 'draft');
    });

    const { additionalFields } = lastRequest().data.spec.manifest;
    expect(additionalFields.startingLocation).toBeUndefined();
    expect(additionalFields.stats).toBeDefined();
  });

  it('updates its own startingLocation when the author moves the requirement', async () => {
    const resource = uploadedGuide(
      { type: 'guide', repository: 'app-platform', additionalFields: { startingLocation: '/explore' } },
      [highlight(['on-page:/explore'])]
    );
    const result = await renderLoaded([resource as never]);

    const moved = {
      id: 'my-guide',
      title: 'My guide',
      schemaVersion: '1.0',
      blocks: [highlight(['on-page:/alerting/list'])],
    } as unknown as JsonGuide;

    await act(async () => {
      await result.current.saveGuide(moved, 'my-guide', resource.metadata, 'draft');
    });

    expect(lastRequest().data.spec.manifest.additionalFields.startingLocation).toBe('/alerting/list');
  });
});

describe('publishGuide / unpublishGuide — annotation passthrough', () => {
  it('publishGuide keeps annotations, labels and manifest', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource]);

    await act(async () => {
      await result.current.publishGuide('alerting-path');
    });

    const { metadata, spec } = lastRequest().data;
    expect(metadata.annotations).toEqual(ANNOTATIONS);
    expect(metadata.labels).toEqual({ tier: 'gold' });
    expect(metadata.resourceVersion).toBe('42');
    expect(spec.manifest).toEqual(MANIFEST);
    expect(spec.status).toBe('published');
  });

  it('unpublishGuide keeps annotations and manifest', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource]);

    await act(async () => {
      await result.current.unpublishGuide('alerting-path');
    });

    const { metadata, spec } = lastRequest().data;
    expect(metadata.annotations).toEqual(ANNOTATIONS);
    expect(spec.manifest).toEqual(MANIFEST);
    expect(spec.status).toBe('draft');
  });

  it('publishes and unpublishes a guide that is missing from the loaded list', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([], [resource]);

    await act(async () => {
      await result.current.publishGuide('alerting-path');
    });
    expect(lastRequest().data.spec.status).toBe('published');
    expect(lastRequest().data.spec.manifest).toEqual(MANIFEST);
    expect(lastRequest().data.metadata.resourceVersion).toBe('42');

    await act(async () => {
      await result.current.unpublishGuide('alerting-path');
    });
    expect(lastRequest().data.spec.status).toBe('draft');
    expect(lastRequest().data.metadata.annotations).toEqual(ANNOTATIONS);
  });

  it('publish and unpublish refuse a guide the server reports missing', async () => {
    const result = await renderLoaded([pathCoverPage()], []);

    await act(async () => {
      await expect(result.current.publishGuide('alerting-path')).rejects.toThrow(
        'Guide "alerting-path" was not found on the server'
      );
      await expect(result.current.unpublishGuide('alerting-path')).rejects.toThrow(
        'Guide "alerting-path" was not found on the server'
      );
    });
    expect(writes()).toHaveLength(0);
  });
});

describe('author attribution', () => {
  const unauthored = () => {
    const resource = pathCoverPage();
    const { author: _author, ...manifest } = MANIFEST;
    return { ...resource, spec: { ...resource.spec, manifest } };
  };

  const fresh = () =>
    ({ id: 'fresh', title: 'Fresh guide', blocks: [{ id: 'b1', type: 'markdown', content: 'hi' }] }) as JsonGuide;

  it('attributes a guide with no author to the signed-in user, never writing email', async () => {
    const result = await renderLoaded([]);

    await act(async () => {
      await result.current.saveGuide(fresh());
    });

    expect(lastRequest().data.spec.manifest.author).toEqual({ name: 'Sam Rivera' });
    expect(JSON.stringify(lastRequest().data)).not.toContain('sam@example.com');
  });

  it('falls back to the login, then to the editor placeholder', async () => {
    const result = await renderLoaded([]);

    mockUser.name = '';
    await act(async () => {
      await result.current.saveGuide(fresh());
    });
    expect(lastRequest().data.spec.manifest.author).toEqual({ name: 'sam' });

    mockUser.login = undefined;
    await act(async () => {
      await result.current.saveGuide(fresh());
    });
    expect(lastRequest().data.spec.manifest.author).toEqual({ name: 'pathfinder-block-editor' });
  });

  it('reports the name it chose so the editor can say so', async () => {
    const result = await renderLoaded([]);

    let saved: Awaited<ReturnType<typeof result.current.saveGuide>> | undefined;
    await act(async () => {
      saved = await result.current.saveGuide(fresh());
    });

    expect(saved).toEqual({ defaultedAuthor: { name: 'Sam Rivera' } });
  });

  it('reports nothing when the guide already had an author', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource]);

    let saved: Awaited<ReturnType<typeof result.current.saveGuide>> | undefined;
    await act(async () => {
      saved = await result.current.saveGuide(loadedGuide(resource), 'alerting-path', resource.metadata, 'draft');
    });

    expect(saved?.defaultedAuthor).toBeUndefined();
  });

  it('fills an authorless stored guide on its next save', async () => {
    const resource = unauthored();
    const result = await renderLoaded([resource]);

    await act(async () => {
      await result.current.saveGuide(loadedGuide(resource), 'alerting-path', resource.metadata, 'draft');
    });

    expect(lastRequest().data.spec.manifest).toEqual({ ...resource.spec.manifest, author: { name: 'Sam Rivera' } });
  });

  it('keeps a real stored author, even for a different signed-in user', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource]);

    await act(async () => {
      await result.current.saveGuide(loadedGuide(resource), 'alerting-path', resource.metadata, 'published');
    });

    expect(lastRequest().data.spec.manifest.author).toEqual({ name: 'Enablement', team: 'Docs' });
  });

  it('replaces a stored placeholder with a real identity', async () => {
    const resource = pathCoverPage();
    resource.spec.manifest = { ...MANIFEST, author: { name: 'pathfinder-mcp' } };
    const result = await renderLoaded([resource]);

    await act(async () => {
      await result.current.saveGuide(loadedGuide(resource), 'alerting-path', resource.metadata, 'draft');
    });

    expect(lastRequest().data.spec.manifest.author).toEqual({ name: 'Sam Rivera' });
  });

  it('reports the placeholder a real identity replaced', async () => {
    const resource = pathCoverPage();
    resource.spec.manifest = { ...MANIFEST, author: { name: 'pathfinder-mcp' } };
    const result = await renderLoaded([resource]);

    let saved: Awaited<ReturnType<typeof result.current.saveGuide>> | undefined;
    await act(async () => {
      saved = await result.current.saveGuide(loadedGuide(resource), 'alerting-path', resource.metadata, 'draft');
    });

    expect(saved).toEqual({ defaultedAuthor: { name: 'Sam Rivera', replacedName: 'pathfinder-mcp' } });
  });

  it('never sends the author name to the logger or telemetry, even when writes fail', async () => {
    const resource = unauthored();
    const result = await renderLoaded([resource]);

    await act(async () => {
      await result.current.saveGuide(loadedGuide(resource), 'alerting-path', resource.metadata, 'draft', false, {
        authorName: 'Dana',
      });
      await result.current.publishGuide('alerting-path');
      await result.current.unpublishGuide('alerting-path');
    });
    mockFetch.mockReturnValue(throwError(() => new Error('boom')));
    (fetchCustomGuideCatalogue as jest.Mock).mockResolvedValue({ available: false, reason: 'boom', entries: [] });
    await act(async () => {
      await result.current.publishGuide('alerting-path').catch(() => {});
      await result.current.deleteGuide('alerting-path').catch(() => {});
      await result.current.refreshGuides().catch(() => {});
    });

    const calls = [
      ...Object.values(logger).flatMap((fn) => (fn as jest.Mock).mock.calls),
      ...(reportAppInteraction as jest.Mock).mock.calls,
    ];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(JSON.stringify(call, (_key, value) => (value instanceof Error ? value.message : value))).not.toMatch(
        /Sam Rivera|Dana/
      );
    }
  });

  it('lets the details modal choices win over everything stored', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource]);

    await act(async () => {
      await result.current.saveGuide(loadedGuide(resource), 'alerting-path', resource.metadata, 'draft', false, {
        authorName: 'Dana',
        team: 'Observability',
      });
    });

    expect(lastRequest().data.spec.manifest.author).toEqual({ name: 'Dana', team: 'Observability' });
  });

  it('applies the signed-in default when publishing and unpublishing an authorless guide', async () => {
    const resource = unauthored();
    const result = await renderLoaded([resource]);

    await act(async () => {
      await result.current.publishGuide('alerting-path');
    });
    expect(lastRequest().data.spec.manifest.author).toEqual({ name: 'Sam Rivera' });
    expect(lastRequest().data.spec.status).toBe('published');

    await act(async () => {
      await result.current.unpublishGuide('alerting-path');
    });
    expect(lastRequest().data.spec.manifest.author).toEqual({ name: 'Sam Rivera' });
    expect(lastRequest().data.spec.status).toBe('draft');
  });

  it('gives a manifest-less legacy guide a minimal manifest to hold the author on publish', async () => {
    const resource = pathCoverPage();
    const { manifest: _manifest, ...spec } = resource.spec;
    const legacy = { ...resource, spec };
    const result = await renderLoaded([legacy]);

    await act(async () => {
      await result.current.publishGuide('alerting-path');
    });

    expect(lastRequest().data.spec.manifest).toEqual({
      type: 'guide',
      repository: 'app-platform',
      author: { name: 'Sam Rivera' },
    });
  });
});

describe('useBackendGuides — overlapping refreshes', () => {
  const entry = (name: string) => ({ id: name, name, title: name, status: 'draft' });
  function deferredCatalogue() {
    let resolve!: (value: unknown) => void;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
  }

  it('keeps the newer list when an older drain lands last', async () => {
    const mount = deferredCatalogue();
    (fetchCustomGuideCatalogue as jest.Mock)
      .mockReturnValueOnce(mount.promise)
      .mockResolvedValueOnce({ available: true, entries: [entry('after-save')] });
    const { result } = renderHook(() => useBackendGuides());

    await act(async () => {
      await result.current.refreshGuides();
    });
    await act(async () => mount.resolve({ available: true, entries: [entry('before-save')] }));

    expect(result.current.guides.map((g) => g.name)).toEqual(['after-save']);
    expect(result.current.isLoading).toBe(false);
  });

  it('does not let an older failed drain put an error over a newer list', async () => {
    const mount = deferredCatalogue();
    (fetchCustomGuideCatalogue as jest.Mock)
      .mockReturnValueOnce(mount.promise)
      .mockResolvedValueOnce({ available: true, entries: [entry('after-save')] });
    const { result } = renderHook(() => useBackendGuides());

    await act(async () => {
      await result.current.refreshGuides();
    });
    await act(async () => mount.resolve({ available: false, reason: 'upstream-503', entries: [] }));

    expect(result.current.error).toBeNull();
    expect(result.current.guides.map((g) => g.name)).toEqual(['after-save']);
  });

  it('stays loading until the latest drain settles', async () => {
    const latest = deferredCatalogue();
    (fetchCustomGuideCatalogue as jest.Mock)
      .mockResolvedValueOnce({ available: true, entries: [entry('mount')] })
      .mockReturnValueOnce(latest.promise);
    const { result } = renderHook(() => useBackendGuides());
    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.refreshGuides();
    });
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      latest.resolve({ available: true, entries: [entry('latest')] });
      await pending;
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.guides.map((g) => g.name)).toEqual(['latest']);
  });
});

describe('useBackendGuides — refresh after a write', () => {
  it('does not hold a save until the catalogue has re-drained', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource]);
    (fetchCustomGuideCatalogue as jest.Mock).mockReturnValueOnce(new Promise(() => {}));

    await act(async () => {
      await result.current.saveGuide(loadedGuide(resource), 'alerting-path', resource.metadata, 'draft');
    });

    expect(result.current.isSaving).toBe(false);
    expect(fetchCustomGuideCatalogue).toHaveBeenLastCalledWith('stacks-1', { refresh: true });
  });
});

describe('useBackendGuides — written resource', () => {
  // The server answers a PUT or POST with the stored object, whose resourceVersion is what the next save
  // must echo for a concurrent write to 409.
  const answerWritesWith = (answer: (request: { data?: StoredGuide }) => unknown) =>
    mockFetch.mockImplementation((request: { method: string; url: string; data?: StoredGuide }) =>
      request.method === 'GET' ? serveFetch(request) : of({ data: answer(request) })
    );

  it('returns the resource a save wrote, with its new resourceVersion', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource]);
    answerWritesWith(({ data }) => ({ ...data, metadata: { ...data!.metadata, resourceVersion: '43' } }));

    let saved: Awaited<ReturnType<typeof result.current.saveGuide>> | undefined;
    await act(async () => {
      saved = await result.current.saveGuide(loadedGuide(resource), 'alerting-path', resource.metadata, 'draft');
    });

    expect(saved?.written?.metadata).toMatchObject({ name: 'alerting-path', resourceVersion: '43' });
  });

  it('returns the resource an unpublish wrote', async () => {
    const result = await renderLoaded([pathCoverPage()]);
    answerWritesWith(({ data }) => ({ ...data, metadata: { ...data!.metadata, resourceVersion: '44' } }));

    let written: Awaited<ReturnType<typeof result.current.unpublishGuide>> | undefined;
    await act(async () => {
      written = await result.current.unpublishGuide('alerting-path');
    });

    expect(written?.metadata.resourceVersion).toBe('44');
    expect(written?.spec.status).toBe('draft');
  });

  it.each([
    ['an empty body', () => ({})],
    ['another resource', () => ({ metadata: { name: 'other', resourceVersion: '1' }, spec: {} })],
    [
      'a resource with no version',
      ({ data }: { data?: StoredGuide }) => ({ ...data, metadata: { name: 'alerting-path' } }),
    ],
  ])('returns no written resource when the write answers with %s', async (_label, answer) => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource]);
    answerWritesWith(answer);

    let saved: Awaited<ReturnType<typeof result.current.saveGuide>> | undefined;
    await act(async () => {
      saved = await result.current.saveGuide(loadedGuide(resource), 'alerting-path', resource.metadata, 'draft');
    });

    expect(saved?.written).toBeUndefined();
  });
});

describe('useBackendGuides — library catalogue', () => {
  it('lists drafts and published guides from the catalogue, bypassing its cache', async () => {
    const draft = pathCoverPage();
    const result = await renderLoaded([draft]);

    expect(fetchCustomGuideCatalogue).toHaveBeenCalledWith('stacks-1', { refresh: true });
    expect(result.current.guides).toEqual([catalogueEntry(draft)]);
    expect(result.current.error).toBeNull();
  });

  it('reports an unavailable catalogue as an error, never as an empty library', async () => {
    (fetchCustomGuideCatalogue as jest.Mock).mockResolvedValue({
      available: false,
      reason: 'identity-unavailable',
      entries: [],
    });
    const { result } = renderHook(() => useBackendGuides());
    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.error).toBe('The guide library is unavailable (identity-unavailable).');
    expect(hasManageableBackendGuides(result.current)).toBe(true);
  });

  it('treats a stack without the backend API as an empty library, not an error', async () => {
    (fetchCustomGuideCatalogue as jest.Mock).mockResolvedValue({
      available: false,
      reason: 'unsupported',
      entries: [],
    });
    const { result } = renderHook(() => useBackendGuides());
    await waitFor(() => expect(result.current.hasLoaded).toBe(true));

    expect(result.current.error).toBeNull();
    expect(result.current.guides).toEqual([]);
  });

  it('re-lists with a cache bypass after a save, publish, unpublish and delete', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource]);
    (fetchCustomGuideCatalogue as jest.Mock).mockClear();

    await act(async () => {
      await result.current.saveGuide(loadedGuide(resource), 'alerting-path', resource.metadata, 'draft');
      await result.current.publishGuide('alerting-path');
      await result.current.unpublishGuide('alerting-path');
      await result.current.deleteGuide('alerting-path');
    });

    expect((fetchCustomGuideCatalogue as jest.Mock).mock.calls).toEqual(Array(4).fill(['stacks-1', { refresh: true }]));
  });

  it('reads one guide by resource name for loading', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([], [resource]);

    await expect(result.current.readGuide('alerting-path')).resolves.toEqual(resource);
    await expect(result.current.readGuide('missing')).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({ url: guideReadUrl('alerting-path'), method: 'GET' })
    );
  });
});
