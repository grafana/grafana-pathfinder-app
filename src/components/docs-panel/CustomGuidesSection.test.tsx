import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CustomGuidesSection } from './CustomGuidesSection';
import type { PublishedGuide } from '../../utils/usePublishedGuides';
import type { Milestone } from '../../types/content.types';
import type { PackageOpenInfo } from '../../types/content-panel.types';
import { fetchPackageContent } from '../../docs-retrieval/content-fetcher/package-content';
import { resolveDocsLoadAlignment } from './utils/docs-load-finalizer';

jest.mock('@grafana/i18n', () => ({
  t: (key: string, fallback: string, vars?: Record<string, unknown>) => {
    if (!vars) {
      return fallback;
    }
    return Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)), fallback);
  },
}));

const mockResolvePackageMilestones = jest.fn();
jest.mock('../../docs-retrieval', () => ({
  resolvePackageMilestones: (ids: string[]) => mockResolvePackageMilestones(ids),
}));

jest.mock('../../docs-retrieval/content-fetcher', () => ({
  fetchContent: jest.fn(),
}));

jest.mock('../../docs-retrieval/content-fetcher/package-resolver-registry', () => ({
  getPackageResolver: async () => ({
    resolve: async () => ({
      ok: true,
      contentUrl: 'backend-guide:fe-alerting-path',
      repository: 'app-platform',
    }),
  }),
}));

const orphanGuide: PublishedGuide = { id: 'standalone-guide', title: 'A standalone guide', status: 'published' };

const pathGuide: PublishedGuide = {
  id: 'fe-alerting-path',
  title: 'Alerting enablement',
  status: 'published',
  manifest: {
    type: 'path',
    repository: 'app-platform',
    description: 'Learn to build alert rules, contact points, and notification policies.',
    milestones: ['fe-alerting-01', 'fe-alerting-02'],
  },
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('CustomGuidesSection — no paths (flat behavior preserved, §7.3)', () => {
  it('renders the flat guide list unchanged when no path/journey manifests exist', () => {
    const openDocsPage = jest.fn();
    render(
      <CustomGuidesSection
        guides={[orphanGuide]}
        paths={[]}
        orphanGuides={[orphanGuide]}
        isLoading={false}
        expanded
        onToggleExpanded={jest.fn()}
        openDocsPage={openDocsPage}
      />
    );

    expect(screen.getByText('A standalone guide')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Start/i }));

    expect(openDocsPage).toHaveBeenCalledWith('backend-guide:standalone-guide', 'A standalone guide', undefined);
  });

  it('returns null when there are no guides and not loading', () => {
    const { container } = render(
      <CustomGuidesSection
        guides={[]}
        paths={[]}
        orphanGuides={[]}
        isLoading={false}
        expanded
        onToggleExpanded={jest.fn()}
        openDocsPage={jest.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('CustomGuidesSection — path cards (launch bridge)', () => {
  it('renders a path card and attaches packageManifest via openDocsPage on Start', () => {
    const openDocsPage = jest.fn();
    render(
      <CustomGuidesSection
        guides={[pathGuide]}
        paths={[pathGuide]}
        orphanGuides={[]}
        isLoading={false}
        expanded
        onToggleExpanded={jest.fn()}
        openDocsPage={openDocsPage}
      />
    );

    expect(screen.getByText('Alerting enablement')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Start/i }));

    expect(openDocsPage).toHaveBeenCalledWith('backend-guide:fe-alerting-path', 'Alerting enablement', {
      packageId: 'fe-alerting-path',
      // The entry id is threaded onto the slim manifest so fetchPackageContent
      // can recover the cover baseUrl.
      packageManifest: { ...pathGuide.manifest, id: 'fe-alerting-path' },
      resolvedMilestones: undefined,
      launchSource: 'custom_guide',
    });
  });

  it('drills in to show the member list, rendering locked members as disabled', async () => {
    mockResolvePackageMilestones.mockResolvedValue([
      {
        number: 1,
        title: 'Alerting module 1',
        duration: '5-10 min',
        url: 'backend-guide:fe-alerting-01',
        isActive: false,
      },
      {
        number: 2,
        title: 'fe-alerting-02',
        duration: '5-10 min',
        url: '',
        isActive: false,
        isLocked: true,
      },
    ]);
    const openDocsPage = jest.fn();

    render(
      <CustomGuidesSection
        guides={[pathGuide]}
        paths={[pathGuide]}
        orphanGuides={[]}
        isLoading={false}
        expanded
        onToggleExpanded={jest.fn()}
        openDocsPage={openDocsPage}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /View members/i }));

    await waitFor(() => expect(screen.getByText('Alerting module 1')).toBeInTheDocument());
    expect(mockResolvePackageMilestones).toHaveBeenCalledWith(['fe-alerting-01', 'fe-alerting-02']);

    // Unlocked member opens via the package pipeline.
    fireEvent.click(screen.getByRole('button', { name: /Alerting module 1/i }));
    expect(openDocsPage).toHaveBeenCalledWith(
      'backend-guide:fe-alerting-01',
      'Alerting enablement',
      expect.objectContaining({ packageId: 'fe-alerting-path', launchSource: 'custom_guide' })
    );

    // Locked member is rendered but disabled and not clickable.
    const lockedButton = screen.getByRole('button', { name: /fe-alerting-02/i });
    expect(lockedButton).toBeDisabled();
    openDocsPage.mockClear();
    fireEvent.click(lockedButton);
    expect(openDocsPage).not.toHaveBeenCalled();
  });

  it('does not re-expand members when collapsed while the resolve is in flight', async () => {
    let resolveMilestones!: (m: unknown[]) => void;
    mockResolvePackageMilestones.mockReturnValue(
      new Promise((resolve) => {
        resolveMilestones = resolve;
      })
    );

    render(
      <CustomGuidesSection
        guides={[pathGuide]}
        paths={[pathGuide]}
        orphanGuides={[]}
        isLoading={false}
        expanded
        onToggleExpanded={jest.fn()}
        openDocsPage={jest.fn()}
      />
    );

    const drillIn = screen.getByRole('button', { name: /View members/i });
    fireEvent.click(drillIn); // expand -> loading
    expect(screen.getByText('Loading members...')).toBeInTheDocument();
    fireEvent.click(drillIn); // collapse while the resolve is still in flight

    // Late resolve must not resurrect the panel.
    await act(async () => {
      resolveMilestones([
        {
          number: 1,
          title: 'Alerting module 1',
          duration: '5-10 min',
          url: 'backend-guide:fe-alerting-01',
          isActive: false,
        },
      ]);
    });

    expect(screen.queryByText('Alerting module 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading members...')).not.toBeInTheDocument();
  });
});

describe('CustomGuidesSection — member starting location', () => {
  const cases: Array<{
    name: string;
    coverFields: Record<string, unknown>;
    memberManifest: Record<string, unknown>;
    expectedLocation: string | null;
  }> = [
    {
      name: 'uses the member top-level location instead of the cover location',
      coverFields: {
        startingLocation: '/connections',
        additionalFields: { startingLocation: '/dashboards', coverOnly: true },
      },
      memberManifest: { startingLocation: '/alerting/routes' },
      expectedLocation: '/alerting/routes',
    },
    {
      name: 'keeps the member nested location and additional fields',
      coverFields: {
        startingLocation: '/connections',
        additionalFields: { startingLocation: '/dashboards', coverOnly: true },
      },
      memberManifest: { additionalFields: { startingLocation: '/alerting/routes', memberOnly: true } },
      expectedLocation: '/alerting/routes',
    },
    {
      name: 'keeps the member additional fields when the cover has unrelated additional fields',
      coverFields: { additionalFields: { coverOnly: true } },
      memberManifest: { additionalFields: { startingLocation: '/alerting/routes', memberOnly: true } },
      expectedLocation: '/alerting/routes',
    },
    {
      name: 'does not inherit a cover top-level location when the member has none',
      coverFields: { startingLocation: '/connections' },
      memberManifest: {},
      expectedLocation: null,
    },
    {
      name: 'does not inherit a cover nested location when the member has none',
      coverFields: { additionalFields: { startingLocation: '/connections', coverOnly: true } },
      memberManifest: { additionalFields: { memberOnly: true } },
      expectedLocation: null,
    },
  ];

  it.each(cases)('$name', async ({ coverFields, memberManifest, expectedLocation }) => {
    const coverManifest = { ...pathGuide.manifest, ...coverFields };
    const originalManifest = JSON.stringify(coverManifest);
    const path: PublishedGuide = { ...pathGuide, manifest: coverManifest };
    const members: Milestone[] = [
      {
        number: 1,
        title: 'Alerting module 1',
        url: 'backend-guide:fe-alerting-01',
        isActive: false,
      },
    ];
    mockResolvePackageMilestones.mockResolvedValue(members);
    const openDocsPage = jest.fn<void, [string, string, PackageOpenInfo?]>();

    render(
      <CustomGuidesSection
        guides={[path]}
        paths={[path]}
        orphanGuides={[]}
        isLoading={false}
        expanded
        onToggleExpanded={jest.fn()}
        openDocsPage={openDocsPage}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /View members/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Alerting module 1/i }));

    expect(openDocsPage).toHaveBeenCalledTimes(1);
    expect(openDocsPage).toHaveBeenCalledWith('backend-guide:fe-alerting-01', 'Alerting enablement', {
      packageId: path.id,
      packageManifest: { ...pathGuide.manifest, id: path.id },
      resolvedMilestones: members,
      launchSource: 'custom_guide',
    });
    const [requestedUrl, , packageInfo] = openDocsPage.mock.calls[0]!;
    expect(packageInfo?.packageManifest).not.toHaveProperty('startingLocation');
    expect(packageInfo?.packageManifest).not.toHaveProperty('additionalFields');

    const result = await fetchPackageContent(
      requestedUrl,
      packageInfo?.packageManifest,
      packageInfo?.resolvedMilestones,
      packageInfo?.repository,
      {
        content: {
          content: '{"id":"fe-alerting-01","title":"Alerting module 1","blocks":[]}',
          type: 'interactive',
          url: requestedUrl,
          lastFetched: '2026-09-27T00:00:00.000Z',
          metadata: { title: 'Alerting module 1', packageManifest: memberManifest },
        },
      }
    );

    expect(result.content?.metadata.packageManifest?.additionalFields).toEqual(memberManifest.additionalFields);
    expect(result.content?.metadata.learningJourney).toEqual({
      currentMilestone: 1,
      totalMilestones: 1,
      milestones: members,
      baseUrl: 'backend-guide:fe-alerting-path',
      summary: undefined,
    });
    const alignment = resolveDocsLoadAlignment({
      requestedUrl,
      packageManifest: packageInfo?.packageManifest,
      fetchedManifest: result.content?.metadata.packageManifest,
      currentPath: '/explore',
      launchSource: 'custom_guide',
      isAdmin: false,
      isFullScreen: false,
    });
    if (expectedLocation === null) {
      expect(alignment).toBeUndefined();
    } else {
      expect(alignment).toEqual({
        startingLocation: expectedLocation,
        currentPath: '/explore',
        launchSource: 'custom_guide',
      });
    }

    fireEvent.click(screen.getByRole('button', { name: /Start/i }));
    expect(openDocsPage).toHaveBeenLastCalledWith('backend-guide:fe-alerting-path', 'Alerting enablement', {
      packageId: path.id,
      packageManifest: { ...coverManifest, id: path.id },
      resolvedMilestones: undefined,
      launchSource: 'custom_guide',
    });
    expect(JSON.stringify(path.manifest)).toBe(originalManifest);
  });
});

describe('CustomGuidesSection — orphan fallback section', () => {
  it('renders both path cards and an orphan-guide section when both exist', () => {
    render(
      <CustomGuidesSection
        guides={[pathGuide, orphanGuide]}
        paths={[pathGuide]}
        orphanGuides={[orphanGuide]}
        isLoading={false}
        expanded
        onToggleExpanded={jest.fn()}
        openDocsPage={jest.fn()}
      />
    );

    expect(screen.getByText('Alerting enablement')).toBeInTheDocument();
    expect(screen.getByText('Other guides')).toBeInTheDocument();
    expect(screen.getByText('A standalone guide')).toBeInTheDocument();
  });
});
