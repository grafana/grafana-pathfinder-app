/**
 * Tests for useBackendGuides' write paths. A PUT to the App Platform replaces
 * the whole object, so every write has to carry through the parts of the
 * resource the block editor has no model for — `spec.manifest` (what makes a
 * learning path a path) and `metadata.annotations` (upload-script provenance).
 */
import { renderHook, waitFor, act } from '@testing-library/react';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
  config: { namespace: 'stacks-1' },
}));

jest.mock('../../../utils/fetchBackendGuides', () => ({
  fetchBackendGuides: jest.fn(),
}));

jest.mock('../../../lib/logging', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { getBackendSrv } from '@grafana/runtime';
import { of } from 'rxjs';

import { fetchBackendGuides } from '../../../utils/fetchBackendGuides';
import { CURRENT_SCHEMA_VERSION } from '../../../types/json-guide.schema';
import type { JsonGuide } from '../types';
import { hasManageableBackendGuides, useBackendGuides } from './useBackendGuides';

const mockFetch = jest.fn();

// `type` is deliberately not one of the CRD's three values: it proves the editor passes an inherited
// type through rather than recognising a whitelist, and that an unrecognised type gets no stats stamp.
const MANIFEST = {
  id: 'alerting-path',
  type: 'learning-journey',
  // The CRD defaults `repository` on write, so a manifest read back off a resource always carries
  // one. Modelling that is what keeps the byte-identical replay below honest.
  repository: 'app-platform',
  milestones: [
    { id: 'alerting-intro', title: 'Intro' },
    { id: 'alerting-rules', title: 'Rules' },
  ],
};

const ANNOTATIONS = {
  'pathfinderbackend.ext.grafana.app/managed-by': 'upsert-learning-path.sh',
  'pathfinderbackend.ext.grafana.app/source-package': 'alerting-enablement',
};

/** A path cover page as the upload script leaves it on the backend. */
function pathCoverPage() {
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
function loadedGuide(resource: ReturnType<typeof pathCoverPage>): JsonGuide {
  return {
    id: resource.spec.id,
    title: resource.spec.title,
    schemaVersion: resource.spec.schemaVersion || '1.0',
    blocks: resource.spec.blocks,
  } as JsonGuide;
}

async function renderLoaded(items: Array<ReturnType<typeof pathCoverPage>>) {
  (fetchBackendGuides as jest.Mock).mockResolvedValue(items);
  const { result } = renderHook(() => useBackendGuides());
  await waitFor(() => expect(result.current.hasLoaded).toBe(true));
  return result;
}

function lastRequest() {
  return mockFetch.mock.calls[mockFetch.mock.calls.length - 1]![0];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockReturnValue(of({ data: {} }));
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
    // Inheriting would let the upload script's ownership guard pass on content it never wrote.
    expect(metadata.annotations).toBeUndefined();
    expect(metadata.labels).toBeUndefined();
    // The concurrency guard still applies — the overwrite is of a real, versioned resource.
    expect(metadata.resourceVersion).toBe('42');
  });

  it('re-reads the list before refusing, so a transient list failure does not block the save', async () => {
    const resource = pathCoverPage();
    // A LIST that failed with an unavailable status resolves to [] rather than an error, so the
    // snapshot is empty while the resource is very much there.
    const result = await renderLoaded([]);
    (fetchBackendGuides as jest.Mock).mockResolvedValue([resource]);

    await act(async () => {
      await result.current.saveGuide(loadedGuide(resource), 'alerting-path', undefined, 'draft');
    });

    expect(lastRequest().method).toBe('PUT');
    expect(lastRequest().data.spec.manifest).toEqual(MANIFEST);
    expect(lastRequest().data.metadata.resourceVersion).toBe('42');
  });

  it('refuses to update a resource the server cannot confirm either', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([]);

    await expect(result.current.saveGuide(loadedGuide(resource), 'alerting-path', undefined, 'draft')).rejects.toThrow(
      'Could not read the saved guide'
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('probes without committing, so a live error and the guide-library entry both survive a refusal', async () => {
    const resource = pathCoverPage();
    (fetchBackendGuides as jest.Mock).mockRejectedValueOnce(new Error('list unavailable'));
    const { result } = renderHook(() => useBackendGuides());
    await waitFor(() => expect(result.current.hasLoaded).toBe(true));
    // The failed initial list is what keeps the guide-library entry visible.
    expect(hasManageableBackendGuides(result.current)).toBe(true);

    (fetchBackendGuides as jest.Mock).mockResolvedValue([]);
    await act(async () => {
      await expect(
        result.current.saveGuide(loadedGuide(resource), 'alerting-path', undefined, 'draft')
      ).rejects.toThrow('Could not read the saved guide');
    });

    // Committing the probe would clear the error and store an empty catalogue, hiding the only
    // affordance that could refresh the list — while the save still refuses.
    expect(result.current.error).toBe('list unavailable');
    expect(hasManageableBackendGuides(result.current)).toBe(true);
  });

  it('surfaces a failed probe as itself rather than as an absent resource', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([]);
    (fetchBackendGuides as jest.Mock).mockRejectedValue(new Error('list unavailable'));

    await act(async () => {
      await expect(
        result.current.saveGuide(loadedGuide(resource), 'alerting-path', undefined, 'draft')
      ).rejects.toThrow('list unavailable');
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('falls back to the snapshot resourceVersion when caller metadata omits it', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource]);

    await act(async () => {
      // A caller handing over partial metadata must not silently drop the conflict check.
      await result.current.saveGuide(loadedGuide(resource), 'alerting-path', { name: 'alerting-path' }, 'draft');
    });

    expect(lastRequest().data.metadata.resourceVersion).toBe('42');
  });

  it('publishGuide keeps annotations and resourceVersion when caller metadata is partial', async () => {
    const resource = pathCoverPage();
    const result = await renderLoaded([resource]);

    await act(async () => {
      await result.current.publishGuide('alerting-path', { name: 'alerting-path' });
    });

    const { metadata } = lastRequest().data;
    expect(metadata.resourceVersion).toBe('42');
    expect(metadata.annotations).toEqual(ANNOTATIONS);
    expect(metadata.labels).toEqual({ tier: 'gold' });
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
          stats: { version: 1, blockCount: 1, sectionCount: 0, completableBlockCount: 0, finalCompletablePosition: 0 },
        },
      },
    });
    expect(request.data.metadata).toEqual({ name: 'fresh', namespace: 'stacks-1' });
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
      await result.current.publishGuide('alerting-path', resource.metadata);
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
      await result.current.unpublishGuide('alerting-path', resource.metadata);
    });

    const { metadata, spec } = lastRequest().data;
    expect(metadata.annotations).toEqual(ANNOTATIONS);
    expect(spec.manifest).toEqual(MANIFEST);
    expect(spec.status).toBe('draft');
  });
});
