/**
 * Tests for useDiscoverMore: mapping the upstream package index into
 * path-shaped items, skipping entries with no usable content URL, honoring
 * excludeTitles, and capping to `count`.
 */

import { renderHook, waitFor } from '@testing-library/react';

import { useDiscoverMore } from './useDiscoverMore';
import {
  fetchOnlinePackageRecommendations,
  type PackageRecommendationsResponse,
} from '../lib/package-recommendations-client';

jest.mock('../lib/package-recommendations-client', () => {
  const actual = jest.requireActual('../lib/package-recommendations-client');
  return {
    ...actual,
    fetchOnlinePackageRecommendations: jest.fn(),
  };
});

const fetchMock = fetchOnlinePackageRecommendations as jest.MockedFunction<typeof fetchOnlinePackageRecommendations>;

const response: PackageRecommendationsResponse = {
  baseUrl: 'https://cdn.example/base/',
  packages: [
    {
      id: 'a',
      path: 'packages/a',
      title: 'A',
      type: 'path',
      description: 'first',
      manifest: { id: 'a', type: 'path', milestones: ['m1', 'm2'] },
    },
    { id: 'b', path: 'packages/b', title: 'B', type: 'path' },
    // Individual guide, not a whole path → filtered out.
    { id: 'g', path: 'packages/g', title: 'G', type: 'guide' },
    // No usable path → buildPackageFileUrl fails closed and the entry is skipped.
    { id: 'c', path: '', title: 'C', type: 'path' },
  ],
};

describe('useDiscoverMore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockResolvedValue(response);
  });

  it('maps path-typed entries, skips guides and those without a content URL', async () => {
    const { result } = renderHook(() => useDiscoverMore());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The 'guide'-typed entry is excluded; only whole paths surface.
    expect(result.current.items.map((i) => i.id)).not.toContain('g');
    // toMatchObject, not toEqual: a schema-valid manifest parses with its
    // .default() fields applied, so the parsed object has more keys than the
    // raw fixture — only the fields under test need to match.
    expect(result.current.items).toMatchObject([
      {
        id: 'a',
        title: 'A',
        description: 'first',
        contentUrl: 'https://cdn.example/base/packages/a/content.json',
        milestoneCount: 2,
        manifest: { milestones: ['m1', 'm2'] },
      },
      {
        id: 'b',
        title: 'B',
        description: undefined,
        contentUrl: 'https://cdn.example/base/packages/b/content.json',
        milestoneCount: undefined,
        manifest: undefined,
      },
    ]);
  });

  it('threads the inlined manifest through so launch can build packageInfo from it', async () => {
    const { result } = renderHook(() => useDiscoverMore());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items.find((i) => i.id === 'a')?.manifest).toMatchObject({ milestones: ['m1', 'm2'] });
  });

  it('excludes items whose title is already shown elsewhere', async () => {
    const { result } = renderHook(() => useDiscoverMore({ excludeTitles: new Set(['A']) }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items.map((i) => i.id)).toEqual(['b']);
  });

  it('caps the number of items to count', async () => {
    const { result } = renderHook(() => useDiscoverMore({ count: 1 }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]!.id).toBe('a');
  });
});
