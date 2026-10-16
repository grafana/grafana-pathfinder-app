import { of } from 'rxjs';
import { loadDocsTabContentResult } from './docs-tab-loader';
import {
  fetchPackageContent,
  resolvePackageMilestones,
  setPackageResolver,
} from '../../../docs-retrieval/content-fetcher/package-content';
import type { ManifestJson, PackageResolver } from '../../../types/package.types';

const mockFetch = jest.fn();
const mockResolve = jest.fn();

jest.mock('@grafana/runtime', () => ({
  config: {
    get namespace() {
      return 'stacks-123';
    },
    bootData: { user: {} },
  },
  getBackendSrv: () => ({ fetch: mockFetch }),
}));

jest.mock('../../../validation', () => ({
  validateGuide: () => ({ isValid: true, errors: [] }),
}));

const pathManifest: ManifestJson = {
  id: 'parent-path',
  type: 'path',
  milestones: ['member-one', 'member-two'],
  prerequisites: [{ id: 'parent-only', label: 'Parent requirement' }],
};

function memberManifest(resourceId: string): ManifestJson | undefined {
  if (resourceId === 'member-one') {
    return {
      id: resourceId,
      type: 'guide',
      prerequisites: [{ id: 'member-only', label: '<em>Member</em> **requirement**' }],
    };
  }
  return undefined;
}

function backendGuideResource(resourceId: string) {
  const manifest = resourceId === 'parent-path' ? pathManifest : memberManifest(resourceId);
  return of({
    data: {
      metadata: { name: resourceId },
      spec: {
        id: resourceId,
        title: resourceId,
        schemaVersion: '1.0',
        blocks: [{ type: 'markdown', content: 'Guide content' }],
        ...(manifest && { manifest }),
      },
    },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockImplementation(({ url }: { url: string }) => {
    const resourceId = new URL(url, 'http://localhost').searchParams.get('name') ?? '';
    return backendGuideResource(resourceId);
  });
  mockResolve.mockImplementation(async (packageId: string) => ({
    ok: true,
    id: packageId,
    contentUrl: `backend-guide:${packageId}`,
    manifestUrl: `backend-guide:${packageId}/manifest.json`,
    repository: 'tutorials',
    manifest: packageId === 'parent-path' ? pathManifest : memberManifest(packageId),
  }));
  const resolver: PackageResolver = { resolve: mockResolve };
  setPackageResolver(resolver);
});

async function resolvePathMilestones() {
  return resolvePackageMilestones(pathManifest.milestones ?? []);
}

describe('path milestone prerequisite metadata', () => {
  it('reuses member manifest metadata from milestone resolution without another member lookup', async () => {
    const milestones = await resolvePathMilestones();
    expect(mockResolve).toHaveBeenCalledTimes(2);
    expect(milestones[0]?.packageManifest?.prerequisites).toEqual([
      { id: 'member-only', label: '<em>Member</em> **requirement**' },
    ]);

    mockResolve.mockClear();
    mockFetch.mockClear();
    const result = await loadDocsTabContentResult('backend-guide:member-one', {
      packageInfo: {
        packageId: 'parent-path',
        packageManifest: pathManifest,
        repository: 'tutorials',
        resolvedMilestones: milestones,
      },
    });

    expect(result.content?.metadata.packageManifest).toMatchObject({
      id: 'member-one',
      type: 'guide',
      prerequisites: [{ id: 'member-only', label: '<em>Member</em> **requirement**' }],
    });
    expect(result.content?.metadata.packageManifest?.prerequisites).not.toContainEqual(pathManifest.prerequisites?.[0]);
    expect(result.content?.metadata.learningJourney).toMatchObject({
      currentMilestone: 1,
      totalMilestones: 2,
      baseUrl: 'backend-guide:parent-path',
    });
    expect(mockResolve).toHaveBeenCalledTimes(2);
    expect(mockResolve).toHaveBeenCalledWith('parent-path', { loadContent: false });
    expect(mockResolve).toHaveBeenCalledWith('parent-path', { loadContent: 'metadata-only' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps member metadata without prerequisites and does not inherit parent declarations', async () => {
    const milestones = await resolvePathMilestones();
    mockResolve.mockClear();
    mockFetch.mockClear();

    const result = await loadDocsTabContentResult('backend-guide:member-two', {
      packageInfo: {
        packageId: 'parent-path',
        packageManifest: pathManifest,
        repository: 'tutorials',
        resolvedMilestones: milestones,
      },
    });

    expect(result.content?.metadata.packageManifest).toMatchObject({ id: 'member-two', type: 'guide' });
    expect(result.content?.metadata.packageManifest?.prerequisites).toBeUndefined();
    expect(result.content?.metadata.learningJourney).toMatchObject({ currentMilestone: 2, totalMilestones: 2 });
    expect(mockResolve).toHaveBeenCalledTimes(2);
    expect(mockResolve).toHaveBeenCalledWith('parent-path', { loadContent: false });
    expect(mockResolve).toHaveBeenCalledWith('parent-path', { loadContent: 'metadata-only' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps loaded member metadata when a legacy milestone has no manifest snapshot', async () => {
    const legacyMilestones = [
      { number: 1, title: 'Member one', url: 'backend-guide:member-one', isActive: false },
      { number: 2, title: 'Member two', url: 'backend-guide:member-two', isActive: false },
    ];
    mockResolve.mockClear();
    mockFetch.mockClear();

    const result = await loadDocsTabContentResult('backend-guide:member-one', {
      packageInfo: {
        packageId: 'parent-path',
        packageManifest: pathManifest,
        repository: 'tutorials',
        resolvedMilestones: legacyMilestones,
      },
    });

    expect(result.content?.metadata.packageManifest?.prerequisites).toEqual([
      { id: 'member-only', label: '<em>Member</em> **requirement**' },
    ]);
    expect(result.content?.metadata.packageManifest?.prerequisites).not.toContainEqual(pathManifest.prerequisites?.[0]);
    expect(mockResolve).toHaveBeenCalledTimes(2);
    expect(mockResolve).toHaveBeenCalledWith('parent-path', { loadContent: false });
    expect(mockResolve).toHaveBeenCalledWith('parent-path', { loadContent: 'metadata-only' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('omits unavailable member metadata for legacy milestones without fetching or inheriting the parent', async () => {
    const legacyMilestones = [
      { number: 1, title: 'Member one', url: 'backend-guide:member-one', isActive: false },
      { number: 2, title: 'Member two', url: 'backend-guide:member-two', isActive: false },
    ];
    mockResolve.mockClear();

    const result = await fetchPackageContent('backend-guide:member-one', pathManifest, legacyMilestones, 'tutorials', {
      content: {
        content: JSON.stringify({ id: 'member-one', title: 'Member one', blocks: [] }),
        metadata: { title: 'Member one' },
        type: 'interactive',
        url: 'backend-guide:member-one',
        lastFetched: new Date().toISOString(),
      },
    });

    expect(result.content?.metadata.packageManifest).toBeUndefined();
    expect(result.content?.metadata.learningJourney).toMatchObject({ currentMilestone: 1, totalMilestones: 2 });
    expect(mockResolve).toHaveBeenCalledTimes(2);
    expect(mockResolve).toHaveBeenCalledWith('parent-path', { loadContent: false });
    expect(mockResolve).toHaveBeenCalledWith('parent-path', { loadContent: 'metadata-only' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps parent prerequisites and journey navigation on the path cover', async () => {
    const milestones = await resolvePathMilestones();
    mockResolve.mockClear();
    mockFetch.mockClear();

    const result = await loadDocsTabContentResult('backend-guide:parent-path', {
      packageInfo: {
        packageId: 'parent-path',
        packageManifest: pathManifest,
        repository: 'tutorials',
        resolvedMilestones: milestones,
      },
    });

    expect(result.content?.metadata.packageManifest?.prerequisites).toEqual(pathManifest.prerequisites);
    expect(result.content?.metadata.learningJourney).toMatchObject({ currentMilestone: 0, totalMilestones: 2 });
    expect(mockResolve).toHaveBeenCalledTimes(2);
    expect(mockResolve).toHaveBeenCalledWith('parent-path', { loadContent: false });
    expect(mockResolve).toHaveBeenCalledWith('parent-path', { loadContent: 'metadata-only' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
