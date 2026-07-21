import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CustomGuidesSection } from './CustomGuidesSection';
import type { PublishedGuide } from '../../utils/usePublishedGuides';

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

const orphanGuide: PublishedGuide = { id: 'standalone-guide', title: 'A standalone guide', status: 'published' };

const pathGuide: PublishedGuide = {
  id: 'fe-alerting-path',
  title: 'fe-alerting-path',
  status: 'published',
  manifest: {
    type: 'path',
    repository: 'app-platform',
    description: 'Alerting enablement',
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
      packageManifest: pathGuide.manifest,
      resolvedMilestones: undefined,
    });
  });

  it('drills in to show the member list, rendering locked members as disabled', async () => {
    mockResolvePackageMilestones.mockResolvedValue([
      { number: 1, title: 'Alerting module 1', duration: '5-10 min', url: 'backend-guide:fe-alerting-01', isActive: false },
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
      expect.objectContaining({ packageId: 'fe-alerting-path' })
    );

    // Locked member is rendered but disabled and not clickable.
    const lockedButton = screen.getByRole('button', { name: /fe-alerting-02/i });
    expect(lockedButton).toBeDisabled();
    openDocsPage.mockClear();
    fireEvent.click(lockedButton);
    expect(openDocsPage).not.toHaveBeenCalled();
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
