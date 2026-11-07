import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ContextPanel } from './context-panel';
import { PLUGIN_BASE_URL } from '../../constants';
import { testIds } from '../../constants/testIds';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { useContextPanel, type Recommendation } from '../../context-engine';
import { journeyMilestonePercentages, resolvePackageMilestones, resolvePackageNavLinks } from '../../docs-retrieval';
import type { Milestone } from '../../types/content.types';
import { useLearningPaths, useMyAssignments, type ResolvedAssignment } from '../../learning-paths';

jest.mock('@grafana/scenes', () => ({ SceneObjectBase: class {} }));

jest.mock('@grafana/runtime', () => {
  const mockPush = jest.fn();
  const mockPublish = jest.fn();
  return {
    getAppEvents: jest.fn(() => ({ publish: mockPublish })),
    locationService: { push: mockPush },
    config: { bootData: { user: { id: 1, name: 'Ada Lovelace', login: 'ada' } } },
    __mockPush: mockPush,
    __mockPublish: mockPublish,
  };
});

jest.mock('@grafana/i18n', () => ({
  t: jest.fn((key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{-?\s*(\w+)\s*\}\}/g, (_match, name: string) => String(values?.[name] ?? ''))
  ),
}));

jest.mock('../../lib/logging', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../lib/analytics', () => ({
  ...jest.requireActual('../../lib/analytics'),
  reportAppInteraction: jest.fn(),
}));
jest.mock('../../context-engine', () => ({ useContextPanel: jest.fn() }));
jest.mock('../../docs-retrieval', () => ({
  resolvePackageNavLinks: jest.fn(),
  resolvePackageMilestones: jest.fn(),
  journeyMilestonePercentages: jest.fn(),
}));
jest.mock('../../learning-paths', () => ({
  ...jest.requireActual('../../learning-paths'),
  useLearningPaths: jest.fn(),
  useMyAssignments: jest.fn(),
}));
jest.mock('../../hooks', () => ({
  usePathfinderPluginConfig: () => ({ config: { acceptedTermsAndConditions: true } }),
}));
const mockUsePublishedGuides = jest.fn();
jest.mock('../../utils/usePublishedGuides', () => ({
  usePublishedGuides: () => mockUsePublishedGuides(),
}));
jest.mock('./hooks', () => ({ useRecommendationsScrollPosition: () => jest.fn() }));
jest.mock('../InteractiveLearningBanner', () => ({ InteractiveLearningBanner: () => null }));
jest.mock('../EnableRecommenderBanner', () => ({
  EnableRecommenderBanner: () => <div data-testid="enable-recommender-banner" />,
}));
jest.mock('../HelpFooter', () => ({
  HelpFooter: () => <div data-testid="help-footer" />,
}));

const { __mockPush: mockPush, __mockPublish: mockPublish } = jest.requireMock('@grafana/runtime');
const mockUseContextPanel = useContextPanel as jest.Mock;
const mockUseLearningPaths = useLearningPaths as jest.Mock;
const mockUseMyAssignments = useMyAssignments as jest.Mock;
const mockResolvePackageNavLinks = resolvePackageNavLinks as jest.Mock;
const mockResolvePackageMilestones = resolvePackageMilestones as jest.Mock;
const mockJourneyMilestonePercentages = journeyMilestonePercentages as jest.Mock;
const resolvedAs = (ids: string[]): Milestone[] =>
  ids.map((id, index) => ({
    id,
    number: index + 1,
    title: `Title ${id}`,
    url: `backend-guide:${id}`,
    isActive: false,
  }));

const openDocsPage = jest.fn();
const openLearningJourney = jest.fn();
const toggleSummaryExpansion = jest.fn();

const pkg = (id: string, extra: Partial<Recommendation> = {}): Recommendation => ({
  title: `Title ${id}`,
  url: '',
  type: 'package',
  contentUrl: `https://cdn.example.com/${id}/content.json`,
  summary: `Summary ${id}`,
  manifest: { id, type: 'guide' },
  ...extra,
});

const assignment = (targetId: string, extra: Partial<ResolvedAssignment> = {}): ResolvedAssignment => ({
  targetId,
  title: `Assigned ${targetId}`,
  overdue: false,
  satisfied: false,
  progress: 0,
  ...extra,
});

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

const model = { state: { onOpenLearningJourney: jest.fn(), onOpenDocsPage: jest.fn() }, setState: jest.fn() };

interface SetupOptions {
  recommendations?: Recommendation[];
  featured?: Recommendation[];
  startedPath?: boolean;
  manifestPath?: boolean;
  privatePath?: boolean;
  assignments?: ResolvedAssignment[];
  hasLoadedAssignments?: boolean;
}

function setup({
  recommendations = [],
  featured = [],
  startedPath = false,
  manifestPath = false,
  privatePath = false,
  assignments = [],
  hasLoadedAssignments = true,
}: SetupOptions = {}) {
  mockUseContextPanel.mockReturnValue({
    contextData: {
      recommendations,
      featuredRecommendations: featured,
      recommendationsError: null,
      isLoading: false,
    },
    isLoadingRecommendations: false,
    hasFetchedRecommendations: true,
    openLearningJourney,
    openDocsPage,
    toggleSummaryExpansion,
  });
  const path = {
    id: 'getting-started',
    title: 'Getting started',
    description: '',
    guides: ['a', 'b'],
    badgeId: 'b',
    ...(manifestPath && { manifest: { type: 'path', milestones: ['a', 'b'] } }),
    ...(privatePath && { isPrivate: true }),
  };
  const memberUrl = (id: string) => (manifestPath ? `backend-guide:${id}` : `bundled:${id}`);
  mockUseLearningPaths.mockReturnValue({
    paths: [path],
    getPathProgress: () => (startedPath ? 50 : 0),
    getPathGuides: () => [],
    isPathCompleted: () => false,
    progress: { completedGuides: startedPath ? ['a'] : [] },
    isLoading: false,
  });
  mockUseMyAssignments.mockReturnValue({
    notDone: assignments,
    assignmentByTargetId: new Map(assignments.map((a) => [a.targetId, a])),
    onlinePaths: [],
    getPathGuides: () => [
      { id: 'a', title: 'Guide A', completed: startedPath, isCurrent: !startedPath, url: memberUrl('a') },
      { id: 'b', title: 'Guide B', completed: false, isCurrent: startedPath, url: memberUrl('b') },
    ],
    hasLoaded: hasLoadedAssignments,
  });
  return render(<ContextPanel.Component model={model as never} />);
}

describe('ContextPanelRenderer sidebar hub', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePublishedGuides.mockReturnValue({
      guides: [],
      paths: [],
      orphanGuides: [],
      isLoading: false,
      hasLoaded: true,
    });
    openDocsPage.mockResolvedValue(undefined);
    mockResolvePackageNavLinks.mockResolvedValue([]);
    mockResolvePackageMilestones.mockImplementation(async (ids: string[]) => resolvedAs(ids));
    mockJourneyMilestonePercentages.mockReturnValue([]);
  });

  it('renders the hub in place of the old recommendations list', async () => {
    setup({ recommendations: [pkg('one')] });

    expect(screen.getByTestId(testIds.sidebarHub.container)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome back, Ada' })).toBeInTheDocument();
    expect(screen.getByTestId('help-footer')).toBeInTheDocument();
  });

  it('opens the first recommendation with its package info and reports the hub location', async () => {
    setup({ featured: [pkg('top')], recommendations: [pkg('two'), pkg('three')] });

    await click(screen.getByTestId(testIds.sidebarHub.featuredAction));

    expect(openDocsPage).toHaveBeenCalledWith('https://cdn.example.com/top/content.json', 'Title top', {
      packageId: 'top',
      packageManifest: { id: 'top', type: 'guide' },
    });
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.OpenResourceClick, {
      content_title: 'Title top',
      content_url: 'https://cdn.example.com/top/content.json',
      content_type: 'interactive_guide',
      interaction_location: 'hub_featured_card',
      match_accuracy: 0,
      total_milestones: 0,
      completion_percentage: 0,
    });
  });

  it('threads the assigned track into the package info of a recommended path', async () => {
    setup({
      featured: [pkg('ops-path', { manifest: { id: 'ops-path', type: 'path' } })],
      assignments: [assignment('ops-path', { trackId: 'ops' })],
    });

    await click(screen.getByTestId(testIds.sidebarHub.featuredAction));

    expect(openDocsPage).toHaveBeenCalledWith(
      'https://cdn.example.com/ops-path/content.json',
      'Title ops-path',
      expect.objectContaining({ packageId: 'ops-path', trackId: 'ops' })
    );
  });

  it('matches a recommended path to its assignment by manifest id, not by title', async () => {
    setup({
      featured: [pkg('admin-path', { title: 'Some path', manifest: { id: 'admin-path', type: 'path' } })],
      assignments: [
        assignment('admin-path', { title: 'A different title', trackId: 'ops' }),
        assignment('unrelated-path', { title: 'Some path', trackId: 'wrong' }),
      ],
    });

    await click(screen.getByTestId(testIds.sidebarHub.featuredAction));

    expect(openDocsPage).toHaveBeenCalledWith(
      'https://cdn.example.com/admin-path/content.json',
      'Some path',
      expect.objectContaining({ trackId: 'ops' })
    );
  });

  it('drops the track when the manifest id matches no assignment, even if a title matches', async () => {
    setup({
      featured: [pkg('not-assigned', { title: 'Some path', manifest: { id: 'not-assigned', type: 'path' } })],
      assignments: [assignment('unrelated-path', { title: 'Some path', trackId: 'wrong' })],
    });

    await click(screen.getByTestId(testIds.sidebarHub.featuredAction));

    expect(openDocsPage.mock.calls[0][2]).not.toHaveProperty('trackId');
  });

  it('matches an id-less path by title, unless two assignments share it', async () => {
    const idless = pkg('idless', { title: 'Some path', manifest: { type: 'path' } });
    const { unmount } = setup({
      featured: [idless],
      assignments: [assignment('one', { title: 'some path', trackId: 'ops' })],
    });
    await click(screen.getByTestId(testIds.sidebarHub.featuredAction));
    expect(openDocsPage.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ trackId: 'ops' }));
    unmount();
    openDocsPage.mockClear();

    setup({
      featured: [idless],
      assignments: [
        assignment('one', { title: 'Some path', trackId: 'ops' }),
        assignment('two', { title: 'Some path', trackId: 'other' }),
      ],
    });
    await click(screen.getByTestId(testIds.sidebarHub.featuredAction));
    expect(openDocsPage.mock.calls[0]?.[2]).not.toHaveProperty('trackId');
  });

  it('lists the next three recommendations in engine order', async () => {
    setup({
      featured: [pkg('top')],
      recommendations: [
        pkg('two'),
        { title: 'Docs', url: 'https://grafana.com/docs/x/', type: 'docs-page' },
        pkg('three'),
        pkg('four'),
      ],
    });

    const rows = within(screen.getByTestId(testIds.sidebarHub.moreList)).getAllByRole('button', {
      name: /^(Start|Read|Resume|Review): /,
    });
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Start: Title two',
      'Read: Docs',
      'Start: Title three',
    ]);

    await click(rows[0]!);
    expect(openDocsPage).toHaveBeenCalledWith(
      'https://cdn.example.com/two/content.json',
      'Title two',
      expect.objectContaining({ packageId: 'two' })
    );
    expect(reportAppInteraction).toHaveBeenCalledWith(
      UserInteraction.OpenResourceClick,
      expect.objectContaining({ interaction_location: 'hub_more_recommended' })
    );
  });

  describe('other documentation', () => {
    const rest = [
      pkg('five', { matchAccuracy: 0.4 }),
      { title: 'Docs six', url: 'https://grafana.com/docs/six/', type: 'docs-page' as const },
    ];

    it('lists every recommendation past the top four, collapsed by default', async () => {
      setup({ featured: [pkg('top')], recommendations: [pkg('two'), pkg('three'), pkg('four'), ...rest] });

      expect(screen.getByTestId(testIds.sidebarHub.otherDocsToggle)).toHaveAttribute('aria-expanded', 'false');
      expect(within(screen.getByTestId(testIds.sidebarHub.otherDocs)).getByText('2 items')).toBeInTheDocument();
      expect(screen.queryByText('Title five')).not.toBeInTheDocument();
      expect(screen.getByText('Title four')).toBeInTheDocument();
    });

    it('is absent when the four visible cards cover every recommendation', async () => {
      setup({ featured: [pkg('top')], recommendations: [pkg('two'), pkg('three'), pkg('four')] });

      expect(screen.queryByTestId(testIds.sidebarHub.otherDocs)).not.toBeInTheDocument();
    });

    it('opens a package item with its package info and reports the old payload at the hub location', async () => {
      setup({ featured: [pkg('top')], recommendations: [pkg('two'), pkg('three'), pkg('four'), ...rest] });

      await click(screen.getByTestId(testIds.sidebarHub.otherDocsToggle));
      await click(screen.getByTestId(testIds.sidebarHub.otherDoc(0)));

      expect(openDocsPage).toHaveBeenCalledWith(
        'https://cdn.example.com/five/content.json',
        'Title five',
        expect.objectContaining({ packageId: 'five' })
      );
      expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.OpenResourceClick, {
        content_title: 'Title five',
        content_url: 'https://cdn.example.com/five/content.json',
        content_type: 'interactive_guide',
        interaction_location: 'hub_other_docs',
        match_accuracy: 0.4,
        total_milestones: 0,
        completion_percentage: 0,
      });
    });

    it('opens a docs page item without milestone fields', async () => {
      setup({ featured: [pkg('top')], recommendations: [pkg('two'), pkg('three'), pkg('four'), ...rest] });

      await click(screen.getByTestId(testIds.sidebarHub.otherDocsToggle));
      await click(screen.getByTestId(testIds.sidebarHub.otherDoc(1)));

      expect(openDocsPage).toHaveBeenCalledWith('https://grafana.com/docs/six/', 'Docs six', undefined);
      expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.OpenResourceClick, {
        content_title: 'Docs six',
        content_url: 'https://grafana.com/docs/six/',
        content_type: 'docs',
        interaction_location: 'hub_other_docs',
        match_accuracy: 0,
      });
    });

    it('does not count the resumed path among the top four', async () => {
      setup({
        startedPath: true,
        featured: [pkg('getting-started')],
        recommendations: [pkg('two'), pkg('three'), pkg('four'), pkg('five')],
      });

      expect(screen.queryByTestId(testIds.sidebarHub.otherDocs)).not.toBeInTheDocument();
      expect(screen.getByText('Title five')).toBeInTheDocument();
    });
  });

  it('opens a docs page row without package info', async () => {
    setup({
      featured: [pkg('top')],
      recommendations: [{ title: 'Docs', url: 'https://grafana.com/docs/x/', type: 'docs-page' }],
    });

    await click(within(screen.getByTestId(testIds.sidebarHub.row(0))).getByRole('button', { name: /^Read: / }));

    expect(openDocsPage).toHaveBeenCalledWith('https://grafana.com/docs/x/', 'Docs', undefined);
    expect(openLearningJourney).not.toHaveBeenCalled();
  });

  it('hides the resume card until a path is started', async () => {
    setup({ recommendations: [pkg('one')] });

    expect(screen.queryByTestId(testIds.sidebarHub.resume)).not.toBeInTheDocument();
  });

  it('resumes a started path at its current guide', async () => {
    setup({ recommendations: [pkg('one')], startedPath: true });

    expect(screen.getByTestId(testIds.sidebarHub.resume)).toHaveTextContent('Getting started · Module 2 of 2');
    await click(screen.getByTestId(testIds.sidebarHub.resumeAction));

    expect(openLearningJourney).toHaveBeenCalledWith('bundled:b', 'Guide B');
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.OpenResourceClick, {
      content_title: 'Getting started',
      content_url: 'bundled:b',
      content_type: 'learning_journey',
      interaction_location: 'hub_resume_card',
      completion_percentage: 50,
      launch_target: 'current_guide',
    });
  });

  it('resumes a manifest-backed assigned path on its cover with the track', async () => {
    mockResolvePackageNavLinks.mockResolvedValue([{ packageId: 'getting-started', contentUrl: 'https://cdn/cover' }]);
    setup({
      startedPath: true,
      manifestPath: true,
      assignments: [assignment('getting-started', { trackId: 'ops', trackLabel: 'Operations', progress: 50 })],
    });

    expect(screen.getByTestId(testIds.sidebarHub.resume)).toHaveTextContent(
      'Getting started · Module 2 of 2 · Operations'
    );
    await click(screen.getByTestId(testIds.sidebarHub.resumeAction));

    await waitFor(() => expect(openDocsPage).toHaveBeenCalledTimes(1));
    expect(mockResolvePackageNavLinks).toHaveBeenCalledWith(['getting-started']);
    expect(openDocsPage).toHaveBeenCalledWith('https://cdn/cover', 'Getting started', {
      packageId: 'getting-started',
      packageManifest: { type: 'path', milestones: ['a', 'b'], id: 'getting-started' },
      trackId: 'ops',
    });
    expect(openLearningJourney).not.toHaveBeenCalled();
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.OpenResourceClick, {
      content_title: 'Getting started',
      content_url: 'https://cdn/cover',
      content_type: 'learning_journey',
      interaction_location: 'hub_resume_card',
      completion_percentage: 50,
      launch_target: 'cover_page',
    });
  });

  it('falls back to the current guide when the cover cannot be resolved', async () => {
    mockResolvePackageNavLinks.mockRejectedValue(new Error('offline'));
    setup({ startedPath: true, manifestPath: true });

    await click(screen.getByTestId(testIds.sidebarHub.resumeAction));

    await waitFor(() => expect(openDocsPage).toHaveBeenCalledTimes(1));
    expect(openDocsPage).toHaveBeenCalledWith(
      'backend-guide:b',
      'Getting started',
      expect.objectContaining({ packageId: 'getting-started' })
    );
    expect(reportAppInteraction).toHaveBeenCalledWith(
      UserInteraction.OpenResourceClick,
      expect.objectContaining({ content_url: 'backend-guide:b', launch_target: 'current_guide_fallback' })
    );
  });

  it('keeps the title and url of a private path out of the resume event', async () => {
    mockResolvePackageNavLinks.mockResolvedValue([{ packageId: 'getting-started', contentUrl: 'https://cdn/cover' }]);
    setup({ startedPath: true, manifestPath: true, privatePath: true });

    await click(screen.getByTestId(testIds.sidebarHub.resumeAction));

    await waitFor(() => expect(openDocsPage).toHaveBeenCalledTimes(1));
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.OpenResourceClick, {
      content_type: 'learning_journey',
      interaction_location: 'hub_resume_card',
      completion_percentage: 50,
      launch_target: 'cover_page',
    });
  });

  it('does not open or report a resume that resolves after the hub unmounted', async () => {
    let resolveCover: (links: unknown[]) => void = () => undefined;
    mockResolvePackageNavLinks.mockReturnValue(new Promise((resolve) => (resolveCover = resolve)));
    const { unmount } = setup({ startedPath: true, manifestPath: true });

    await click(screen.getByTestId(testIds.sidebarHub.resumeAction));
    expect(mockResolvePackageNavLinks).toHaveBeenCalledWith(['getting-started']);
    unmount();
    await act(async () => {
      resolveCover([{ packageId: 'getting-started', contentUrl: 'https://cdn/cover' }]);
    });

    expect(openDocsPage).not.toHaveBeenCalled();
    expect(reportAppInteraction).not.toHaveBeenCalled();
  });

  it('does not open a resume whose cover lookup fails after the hub unmounted', async () => {
    let rejectCover: (error: Error) => void = () => undefined;
    mockResolvePackageNavLinks.mockReturnValue(new Promise((_resolve, reject) => (rejectCover = reject)));
    const { unmount } = setup({ startedPath: true, manifestPath: true });

    await click(screen.getByTestId(testIds.sidebarHub.resumeAction));
    unmount();
    await act(async () => {
      rejectCover(new Error('offline'));
    });

    expect(openDocsPage).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('leaves the resumed path out of the recommendations', async () => {
    setup({
      startedPath: true,
      featured: [pkg('getting-started', { title: 'Getting started path' })],
      recommendations: [pkg('other')],
    });

    expect(screen.queryByText('Getting started path')).not.toBeInTheDocument();
    expect(screen.getByText('Title other')).toBeInTheDocument();
  });

  it('leaves out a recommendation that opens the guide the resume card offers', async () => {
    setup({
      startedPath: true,
      recommendations: [pkg('same', { contentUrl: 'bundled:b', title: 'Guide B again' }), pkg('other')],
    });

    expect(screen.queryByText('Guide B again')).not.toBeInTheDocument();
    expect(screen.getByText('Title other')).toBeInTheDocument();
  });

  it('counts assignments from the assignments hook', async () => {
    setup({ recommendations: [pkg('one')], assignments: [assignment('x'), assignment('y')] });

    expect(within(screen.getByTestId(testIds.sidebarHub.tile('assignments'))).getByText('2')).toBeInTheDocument();
  });

  it('waits for assignments before showing the tiles', async () => {
    setup({ recommendations: [pkg('one')], hasLoadedAssignments: false });

    expect(screen.queryByTestId(testIds.sidebarHub.tiles)).not.toBeInTheDocument();
    expect(screen.getByTestId(testIds.sidebarHub.loading)).toBeInTheDocument();
  });

  it('navigates to My learning from the header and every tile and reports each source', async () => {
    setup({ recommendations: [pkg('one')] });

    await click(screen.getByTestId(testIds.sidebarHub.myLearning));
    await click(screen.getByTestId(testIds.sidebarHub.tile('assignments')));
    await click(screen.getByTestId(testIds.sidebarHub.tile('in-progress')));
    await click(screen.getByTestId(testIds.sidebarHub.tile('completed')));

    expect(mockPush).toHaveBeenCalledTimes(4);
    expect(mockPush).toHaveBeenCalledWith(PLUGIN_BASE_URL);
    expect((reportAppInteraction as jest.Mock).mock.calls).toEqual([
      [UserInteraction.DocsPanelInteraction, { action: 'navigate_to_my_learning', source: 'hub_header' }],
      [UserInteraction.DocsPanelInteraction, { action: 'navigate_to_my_learning', source: 'hub_assignments' }],
      [UserInteraction.DocsPanelInteraction, { action: 'navigate_to_my_learning', source: 'hub_in_progress' }],
      [UserInteraction.DocsPanelInteraction, { action: 'navigate_to_my_learning', source: 'hub_completed' }],
    ]);
  });

  it('shows an error toast and unlocks the launch controls when opening a guide fails', async () => {
    openDocsPage.mockRejectedValue(new Error('unavailable'));
    setup({ featured: [pkg('top')], recommendations: [pkg('two')] });

    await click(screen.getByTestId(testIds.sidebarHub.featuredAction));

    await waitFor(() =>
      expect(mockPublish).toHaveBeenCalledWith({
        type: 'alert-error',
        payload: ['Could not open the guide', 'Something went wrong while loading the guide. Please try again.'],
      })
    );
    await waitFor(() => expect(screen.getByTestId(testIds.sidebarHub.featuredAction)).toBeEnabled());
  });

  it('ignores a second launch while the first is still opening', async () => {
    let finish: () => void = () => undefined;
    openDocsPage.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    setup({ featured: [pkg('top')], recommendations: [pkg('two')], startedPath: true });

    await click(screen.getByTestId(testIds.sidebarHub.featuredAction));
    await click(within(screen.getByTestId(testIds.sidebarHub.row(0))).getByRole('button', { name: /^Start: / }));
    await click(screen.getByTestId(testIds.sidebarHub.resumeAction));

    expect(openDocsPage).toHaveBeenCalledTimes(1);
    expect(openLearningJourney).not.toHaveBeenCalled();
    expect(screen.getByTestId(testIds.sidebarHub.featuredAction)).toBeDisabled();
    expect(screen.getByTestId(testIds.sidebarHub.resumeAction)).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByTestId(testIds.sidebarHub.featuredAction)).toBeEnabled());
    expect(screen.getByTestId(testIds.sidebarHub.resumeAction)).toBeEnabled();
  });

  describe('card expansion', () => {
    const milestone = (n: number) => ({
      id: `m${n}`,
      number: n,
      title: `Module ${n}`,
      url: `https://cdn.example.com/m${n}/content.json`,
      isActive: false,
    });
    const detailed = (id: string, extra: Partial<Recommendation> = {}) =>
      pkg(id, {
        manifest: { id, type: 'path', prerequisites: [{ id: 'p1', label: 'Have a data source' }] },
        milestones: [milestone(1), milestone(2)],
        totalSteps: 2,
        ...extra,
      });

    it('offers no toggle when there is nothing to expand', async () => {
      setup({ featured: [pkg('top', { summary: '' })], recommendations: [pkg('two', { summary: '' })] });

      expect(screen.queryByTestId(testIds.sidebarHub.featuredToggle)).not.toBeInTheDocument();
      expect(screen.queryByTestId(testIds.sidebarHub.rowToggle(0))).not.toBeInTheDocument();
    });

    it('toggles the featured card and reports the old summary event at the hub location', async () => {
      setup({ featured: [detailed('top')], recommendations: [pkg('two')] });

      const toggle = screen.getByTestId(testIds.sidebarHub.featuredToggle);
      expect(toggle).toHaveTextContent('Show milestones');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId(testIds.sidebarHub.featuredDetails)).not.toBeInTheDocument();
      await click(toggle);

      expect(toggleSummaryExpansion).toHaveBeenCalledWith('https://cdn.example.com/top/content.json');
      expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.SummaryClick, {
        content_title: 'Title top',
        content_url: 'https://cdn.example.com/top/content.json',
        content_type: 'learning_journey',
        action: 'expand',
        match_accuracy: 0,
        total_milestones: 2,
        interaction_location: 'hub_featured_card',
      });
      expect(openDocsPage).not.toHaveBeenCalled();
    });

    it('shows prerequisites and modules in an expanded featured card and jumps into a module', async () => {
      setup({ featured: [detailed('top', { summaryExpanded: true })], recommendations: [pkg('two')] });

      const details = screen.getByTestId(testIds.sidebarHub.featuredDetails);
      expect(screen.getByTestId(testIds.sidebarHub.featuredToggle)).toHaveTextContent('Hide milestones');
      expect(within(details).getByText('Have a data source')).toBeInTheDocument();
      expect(within(details).getByRole('heading', { name: 'Milestones' })).toBeInTheDocument();

      await click(screen.getByTestId(testIds.sidebarHub.featuredModule(1)));

      expect(openDocsPage).toHaveBeenCalledWith(
        'https://cdn.example.com/m2/content.json',
        'Title top',
        expect.objectContaining({ packageId: 'top' })
      );
      expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.JumpIntoMilestoneClick, {
        content_title: 'Title top',
        milestone_title: 'Module 2',
        milestone_number: 2,
        milestone_url: 'https://cdn.example.com/m2/content.json',
        content_url: 'https://cdn.example.com/top/content.json',
        interaction_location: 'hub_featured_milestone_list',
      });
    });

    it('expands a More recommended row without launching it and reports the collapse', async () => {
      setup({
        featured: [pkg('top')],
        recommendations: [detailed('two', { summaryExpanded: true, summary: 'Learn the basics' })],
      });

      const row = screen.getByTestId(testIds.sidebarHub.row(0));
      const details = screen.getByTestId(testIds.sidebarHub.rowDetails(0));
      expect(within(row).getByText('Learn the basics')).toBeInTheDocument();
      expect(within(details).getByText('Have a data source')).toBeInTheDocument();
      expect(within(details).getAllByRole('button')).toHaveLength(2);
      expect(screen.getByTestId(testIds.sidebarHub.rowModule(0, 0))).toHaveTextContent('Module 1');
      expect(screen.getByTestId(testIds.sidebarHub.rowModule(0, 1))).toHaveTextContent('Module 2');

      await click(screen.getByTestId(testIds.sidebarHub.rowToggle(0)));

      expect(toggleSummaryExpansion).toHaveBeenCalledWith('https://cdn.example.com/two/content.json');
      expect(reportAppInteraction).toHaveBeenCalledWith(
        UserInteraction.SummaryClick,
        expect.objectContaining({ action: 'collapse', interaction_location: 'hub_more_recommended' })
      );
      expect(openDocsPage).not.toHaveBeenCalled();
      expect(openLearningJourney).not.toHaveBeenCalled();
    });

    it('jumps into a module from a row at the row location', async () => {
      setup({ featured: [pkg('top')], recommendations: [detailed('two', { summaryExpanded: true })] });

      await click(screen.getByTestId(testIds.sidebarHub.rowModule(0, 0)));

      expect(openDocsPage).toHaveBeenCalledWith(
        'https://cdn.example.com/m1/content.json',
        'Title two',
        expect.objectContaining({ packageId: 'two' })
      );
      expect(reportAppInteraction).toHaveBeenCalledWith(
        UserInteraction.JumpIntoMilestoneClick,
        expect.objectContaining({ milestone_number: 1, interaction_location: 'hub_milestone_list' })
      );
    });

    it('opens a module of a non-package recommendation as a learning journey step', async () => {
      const journey: Recommendation = {
        title: 'Journey',
        url: 'https://grafana.com/docs/learning-journeys/j/',
        type: 'learning-journey',
        summary: 'A journey',
        milestones: [milestone(1)],
        summaryExpanded: true,
      };
      setup({ featured: [pkg('top')], recommendations: [journey] });

      await click(screen.getByTestId(testIds.sidebarHub.rowModule(0, 0)));

      expect(openLearningJourney).toHaveBeenCalledWith('https://cdn.example.com/m1/content.json', 'Journey - Module 1');
      expect(openDocsPage).not.toHaveBeenCalled();
    });

    it('tags the third More recommended row as more recommended, not other documentation', async () => {
      setup({ featured: [pkg('top')], recommendations: [pkg('two'), pkg('three'), pkg('four'), pkg('five')] });

      await click(within(screen.getByTestId(testIds.sidebarHub.row(2))).getByRole('button', { name: /^Start: / }));

      expect(reportAppInteraction).toHaveBeenCalledWith(
        UserInteraction.OpenResourceClick,
        expect.objectContaining({ content_title: 'Title four', interaction_location: 'hub_more_recommended' })
      );
    });

    it('offers a toggle for prerequisites alone and shows them without a modules list', async () => {
      const prerequisitesOnly = pkg('two', {
        summary: '',
        manifest: { id: 'two', type: 'guide', prerequisites: [{ id: 'p1', label: 'Have a data source' }] },
      });
      setup({ featured: [pkg('top')], recommendations: [{ ...prerequisitesOnly, summaryExpanded: true }] });

      expect(screen.getByTestId(testIds.sidebarHub.rowToggle(0))).toHaveTextContent('Hide details');
      expect(
        within(screen.getByTestId(testIds.sidebarHub.rowDetails(0))).getByText('Have a data source')
      ).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Milestones' })).not.toBeInTheDocument();
    });

    it('never lists modules for a docs page or shows a skeleton once modules are in', async () => {
      setup({
        featured: [pkg('top')],
        recommendations: [
          {
            title: 'Docs',
            url: 'https://grafana.com/docs/x/',
            type: 'docs-page',
            summary: 'Read this first',
            milestones: [milestone(1)],
            summaryExpanded: true,
          },
          detailed('three', { summaryExpanded: true, isResolvingDeferred: true }),
        ],
      });

      expect(
        within(screen.getByTestId(testIds.sidebarHub.rowDetails(0))).queryByText('Milestones')
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId(testIds.sidebarHub.rowModule(0, 0))).not.toBeInTheDocument();
      expect(screen.getByTestId(testIds.sidebarHub.rowModule(1, 0))).toBeInTheDocument();
      expect(screen.queryByTestId(testIds.sidebarHub.rowDetailsLoading(1))).not.toBeInTheDocument();
    });

    it('ignores a module click while another launch is still opening', async () => {
      let finish: () => void = () => undefined;
      openDocsPage.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
      setup({ featured: [pkg('top')], recommendations: [detailed('two', { summaryExpanded: true })] });

      await click(screen.getByTestId(testIds.sidebarHub.featuredAction));
      await click(screen.getByTestId(testIds.sidebarHub.rowModule(0, 0)));

      expect(openDocsPage).toHaveBeenCalledTimes(1);
      expect(openDocsPage).toHaveBeenCalledWith(
        'https://cdn.example.com/top/content.json',
        'Title top',
        expect.anything()
      );
      finish();
      await waitFor(() => expect(screen.getByTestId(testIds.sidebarHub.featuredAction)).toBeEnabled());
    });

    it('shows a loading skeleton while the modules of an expanded card resolve', async () => {
      setup({
        featured: [pkg('top')],
        recommendations: [
          pkg('two', {
            milestones: undefined,
            pendingMilestoneIds: ['a', 'b'],
            isResolvingDeferred: true,
            summaryExpanded: true,
          }),
        ],
      });

      expect(screen.getByTestId(testIds.sidebarHub.rowToggle(0))).toHaveTextContent('Hide milestones');
      expect(screen.getByTestId(testIds.sidebarHub.rowDetailsLoading(0))).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Milestones' })).not.toBeInTheDocument();
    });

    it('lets a docs row expand to its summary without a modules list', async () => {
      setup({
        featured: [pkg('top')],
        recommendations: [
          { title: 'Docs', url: 'https://grafana.com/docs/x/', type: 'docs-page', summary: 'Read this first' },
        ],
      });

      const toggle = screen.getByTestId(testIds.sidebarHub.rowToggle(0));
      expect(toggle).toHaveTextContent('Read more');
      expect(screen.queryByText('Read this first')).not.toBeInTheDocument();
      await click(toggle);
      expect(toggleSummaryExpansion).toHaveBeenCalledWith('https://grafana.com/docs/x/');
      expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.SummaryClick, {
        content_title: 'Docs',
        content_url: 'https://grafana.com/docs/x/',
        content_type: 'docs',
        action: 'expand',
        match_accuracy: 0,
        interaction_location: 'hub_more_recommended',
      });
    });
  });

  describe('custom guides', () => {
    const published = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      title: `Custom ${id}`,
      status: 'published',
      manifest: { type: 'guide' },
      ...extra,
    });

    it('lists published custom guides next to More recommended and opens one by its backend id', async () => {
      const guides = ['a', 'b', 'c', 'd'].map((id) => published(id));
      mockUsePublishedGuides.mockReturnValue({
        guides,
        paths: [],
        orphanGuides: guides,
        isLoading: false,
        hasLoaded: true,
      });
      setup({ featured: [pkg('top')], recommendations: [pkg('two')] });

      const section = screen.getByRole('region', { name: 'Custom guides' });
      expect(within(section).getAllByRole('button', { name: /^Start: Custom/ })).toHaveLength(3);

      expect(screen.queryByTestId(testIds.sidebarHub.customRowToggle(0))).not.toBeInTheDocument();
      await click(within(screen.getByTestId(testIds.sidebarHub.customRow(0))).getByRole('button'));

      expect(openDocsPage).toHaveBeenCalledWith('backend-guide:a', 'Custom a', undefined);
      expect(reportAppInteraction).toHaveBeenCalledWith(
        UserInteraction.OpenResourceClick,
        expect.objectContaining({ interaction_location: 'hub_custom_guides', content_url: 'backend-guide:a' })
      );

      await click(screen.getByTestId(testIds.sidebarHub.customGuidesToggle));
      expect(within(section).getAllByRole('button', { name: /^Start: Custom/ })).toHaveLength(4);
    });

    it('opens an assigned custom path with its manifest and track', async () => {
      const path = published('p1', { manifest: { type: 'path', milestones: ['x'] } });
      mockUsePublishedGuides.mockReturnValue({
        guides: [path],
        paths: [path],
        orphanGuides: [],
        isLoading: false,
        hasLoaded: true,
      });
      setup({ recommendations: [pkg('one')], assignments: [assignment('p1', { trackId: 'ops' })] });

      await click(
        within(screen.getByTestId(testIds.sidebarHub.customRow(0))).getByRole('button', { name: 'Start: Custom p1' })
      );

      expect(openDocsPage).toHaveBeenCalledWith(
        'backend-guide:p1',
        'Custom p1',
        expect.objectContaining({ packageId: 'p1', launchSource: 'custom_guide', trackId: 'ops' })
      );
    });

    describe('milestones', () => {
      // The track Combobox measures option text on a canvas and watches its scroll edges, neither of which jsdom has.
      let canvas: jest.SpyInstance;
      const originalObserver = global.IntersectionObserver;
      beforeAll(() => {
        canvas = jest
          .spyOn(HTMLCanvasElement.prototype, 'getContext')
          .mockReturnValue({ measureText: () => ({ width: 100 }) } as unknown as CanvasRenderingContext2D);
        global.IntersectionObserver = class {
          observe() {}
          unobserve() {}
          disconnect() {}
        } as unknown as typeof IntersectionObserver;
      });
      afterAll(() => {
        canvas.mockRestore();
        global.IntersectionObserver = originalObserver;
      });

      const labs = Array.from({ length: 12 }, (_, index) => `lab-${String(index + 1).padStart(2, '0')}`);
      const publish = (...paths: Array<ReturnType<typeof published>>) =>
        mockUsePublishedGuides.mockReturnValue({
          guides: paths,
          paths,
          orphanGuides: [],
          isLoading: false,
          hasLoaded: true,
        });
      const bootcamp = () =>
        published('bootcamp', {
          title: 'Bootcamp',
          manifest: { type: 'path', milestones: labs, startingLocation: '/connections', additionalFields: { a: 1 } },
        });
      const workshop = () =>
        published('workshop', {
          title: 'Workshop',
          manifest: {
            type: 'path',
            milestones: ['setup'],
            tracks: [
              { trackId: 'metrics', label: 'Metrics', guides: ['setup', 'm-1', 'm-2'] },
              { trackId: 'logs', label: 'Logs', guides: ['setup', 'l-1'] },
            ],
          },
        });
      const expand = async () => {
        await click(screen.getByTestId(testIds.sidebarHub.customRowToggle(0)));
        return screen.getByTestId(testIds.sidebarHub.customRowDetails(0));
      };
      const milestoneButtons = (details: HTMLElement) => within(details).findAllByRole('button', { name: /Title / });

      it("expands a published custom path's milestones and opens milestone 7 directly", async () => {
        publish(bootcamp());
        setup({ recommendations: [pkg('one')] });

        const toggle = screen.getByTestId(testIds.sidebarHub.customRowToggle(0));
        expect(toggle).toHaveAccessibleName('Show milestones');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByTestId(testIds.sidebarHub.customRow(0))).toHaveTextContent('12 milestones');
        expect(mockResolvePackageMilestones).not.toHaveBeenCalled();

        const details = await expand();

        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(toggle).toHaveAttribute('aria-controls', details.id);
        expect(await milestoneButtons(details)).toHaveLength(12);
        expect(mockResolvePackageMilestones.mock.calls.map(([ids]) => ids)).toEqual([labs.slice(0, 8), labs.slice(8)]);
        expect(openDocsPage).not.toHaveBeenCalled();

        await click(screen.getByTestId(testIds.sidebarHub.customRowModule(0, 6)));

        expect(openDocsPage).toHaveBeenCalledTimes(1);
        const [url, title, packageInfo] = openDocsPage.mock.calls[0]!;
        expect([url, title]).toEqual(['backend-guide:lab-07', 'Bootcamp']);
        expect(packageInfo).toMatchObject({
          packageId: 'bootcamp',
          launchSource: 'custom_guide',
          packageManifest: { id: 'bootcamp', type: 'path', milestones: labs },
        });
        expect(packageInfo.packageManifest).not.toHaveProperty('startingLocation');
        expect(packageInfo.packageManifest).not.toHaveProperty('additionalFields');
        expect(packageInfo).not.toHaveProperty('trackId');
        expect(packageInfo.resolvedMilestones.map((m: Milestone) => [m.number, m.id])).toEqual(
          labs.map((id, index) => [index + 1, id])
        );
        expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.JumpIntoMilestoneClick, {
          milestone_number: 7,
          total_milestones: 12,
          interaction_location: 'hub_custom_milestone_list',
        });
      });

      it('marks completed milestones and the one to resume at', async () => {
        mockJourneyMilestonePercentages.mockImplementation((_baseUrl: string, milestones: Milestone[]) =>
          milestones.map((milestone, index) => ({ milestone, percent: index < 4 ? 100 : index === 4 ? 40 : 0 }))
        );
        publish(bootcamp());
        setup({ recommendations: [pkg('one')] });

        const details = await expand();
        await milestoneButtons(details);

        expect(mockJourneyMilestonePercentages).toHaveBeenLastCalledWith('backend-guide:bootcamp', expect.any(Array));
        expect(within(details).getAllByText('Completed')).toHaveLength(4);
        const current = screen.getByTestId(testIds.sidebarHub.customRowModule(0, 4));
        expect(current).toHaveAttribute('aria-current', 'step');
        expect(current).toHaveTextContent('Up next');
        expect(within(details).getAllByRole('button', { current: 'step' })).toEqual([current]);
      });

      it('switches a tracked path between its sequences and opens a track member on its track', async () => {
        publish(workshop());
        setup({ recommendations: [pkg('one')], assignments: [assignment('workshop', { trackId: 'logs' })] });

        expect(screen.getByTestId(testIds.sidebarHub.customRow(0))).toHaveTextContent('4 milestones');
        const details = await expand();
        const track = within(details).getByRole('combobox', { name: 'Track' });
        expect(track).toHaveValue('Logs');
        expect(await milestoneButtons(details)).toHaveLength(2);
        const pick = async (label: string) => {
          fireEvent.change(track, { target: { value: label } });
          await act(async () => {});
          fireEvent.keyDown(track, { key: 'ArrowDown' });
          await act(async () => {
            fireEvent.keyDown(track, { key: 'Enter' });
          });
        };

        await pick('Fundamentals');
        await waitFor(async () => expect(await milestoneButtons(details)).toHaveLength(1));
        await pick('Metrics');
        await waitFor(async () => expect(await milestoneButtons(details)).toHaveLength(3));
        expect(track).toHaveValue('Metrics');
        expect(mockResolvePackageMilestones.mock.calls.map(([ids]) => ids)).toEqual([
          ['setup', 'l-1'],
          ['setup'],
          ['setup', 'm-1', 'm-2'],
        ]);

        await click(screen.getByTestId(testIds.sidebarHub.customRowModule(0, 2)));

        const [url, , packageInfo] = openDocsPage.mock.calls[0]!;
        expect(url).toBe('backend-guide:m-2');
        expect(packageInfo).toMatchObject({ packageId: 'workshop', trackId: 'metrics' });
        expect(packageInfo.trackMilestones.map((m: Milestone) => m.id)).toEqual(['setup', 'm-1', 'm-2']);
        expect(packageInfo.resolvedMilestones).toBeUndefined();
      });

      const locked = (id: string, number: number): Milestone => ({
        id,
        number,
        title: id,
        url: '',
        isActive: false,
        isLocked: true,
      });

      it('offers a retry when the resolver returns nothing, then keeps an unpublished milestone disabled', async () => {
        mockResolvePackageMilestones
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([...resolvedAs(['lab-01']), { ...locked('lab-02', 2), title: 'Title lab-02' }]);
        publish(published('short', { manifest: { type: 'path', milestones: ['lab-01', 'lab-02'] } }));
        setup({ recommendations: [pkg('one')] });

        const details = await expand();
        const alert = await within(details).findByRole('alert');
        expect(alert).toHaveTextContent('Could not load milestone details.');

        await click(within(alert).getByRole('button', { name: 'Retry' }));

        const [published1, unpublished] = await milestoneButtons(details);
        expect(published1).toBeEnabled();
        expect(unpublished).toBeDisabled();
        expect(unpublished).toHaveTextContent('Unavailable');
        expect(within(details).queryByRole('alert')).not.toBeInTheDocument();
        expect(mockResolvePackageMilestones).toHaveBeenCalledTimes(2);
      });

      it('lists a path with nothing published yet as unavailable and checks again on the next expand', async () => {
        mockResolvePackageMilestones
          .mockResolvedValueOnce([locked('lab-01', 1), locked('lab-02', 2)])
          .mockResolvedValueOnce(resolvedAs(['lab-01', 'lab-02']));
        publish(published('short', { manifest: { type: 'path', milestones: ['lab-01', 'lab-02'] } }));
        setup({ recommendations: [pkg('one')] });

        const details = await expand();
        const rows = await within(details).findAllByRole('button', { name: /lab-0/ });
        expect(rows.every((row) => row.hasAttribute('disabled'))).toBe(true);
        expect(within(details).queryByRole('alert')).not.toBeInTheDocument();

        await click(screen.getByTestId(testIds.sidebarHub.customRowToggle(0)));
        await expand();

        expect(await milestoneButtons(screen.getByTestId(testIds.sidebarHub.customRowDetails(0)))).toHaveLength(2);
        expect(mockResolvePackageMilestones).toHaveBeenCalledTimes(2);
      });

      it('opens a track-only path on its first track instead of an empty Fundamentals list', async () => {
        publish(
          published('roles', {
            title: 'Roles',
            manifest: { type: 'path', tracks: [{ trackId: 'ops', label: 'Ops', guides: ['ops-1', 'ops-2'] }] },
          })
        );
        setup({ recommendations: [pkg('one')] });

        const details = await expand();
        const track = within(details).getByRole('combobox', { name: 'Track' });

        expect(track).toHaveValue('Ops');
        expect(await milestoneButtons(details)).toHaveLength(2);
        expect(within(details).queryByRole('alert')).not.toBeInTheDocument();
        expect(mockResolvePackageMilestones.mock.calls.map(([ids]) => ids)).toEqual([['ops-1', 'ops-2']]);
      });

      it('follows an assigned track that loads after the row is shown', async () => {
        publish(workshop());
        const { rerender } = setup({ recommendations: [pkg('one')] });
        const assigned = [assignment('workshop', { trackId: 'logs' })];
        mockUseMyAssignments.mockReturnValue({
          ...mockUseMyAssignments.mock.results.at(-1)!.value,
          notDone: assigned,
          assignmentByTargetId: new Map(assigned.map((a) => [a.targetId, a])),
        });
        rerender(<ContextPanel.Component model={model as never} />);

        const details = await expand();

        expect(within(details).getByRole('combobox', { name: 'Track' })).toHaveValue('Logs');
        expect(await milestoneButtons(details)).toHaveLength(2);
        expect(mockResolvePackageMilestones).toHaveBeenCalledWith(['setup', 'l-1']);
      });

      it('keeps an in-flight expand when a catalogue refresh rebuilds the row', async () => {
        let settle: (milestones: Milestone[]) => void = () => {};
        mockResolvePackageMilestones
          .mockImplementationOnce(() => new Promise<Milestone[]>((resolve) => (settle = resolve)))
          .mockImplementation(() => new Promise<Milestone[]>(() => {}));
        const short = () => published('short', { manifest: { type: 'path', milestones: ['lab-01', 'lab-02'] } });
        publish(short());
        const { rerender } = setup({ recommendations: [pkg('one')] });

        const details = await expand();
        expect(screen.getByTestId(testIds.sidebarHub.customRowDetailsLoading(0))).toBeInTheDocument();
        publish(short());
        rerender(<ContextPanel.Component model={model as never} />);
        await act(async () => settle(resolvedAs(['lab-01', 'lab-02'])));

        expect(await milestoneButtons(details)).toHaveLength(2);
        expect(mockResolvePackageMilestones).toHaveBeenCalledTimes(1);
      });

      it('ignores a milestone click while another launch is still opening', async () => {
        let finish: () => void = () => {};
        openDocsPage.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
        publish(bootcamp());
        setup({ recommendations: [pkg('one')] });

        const details = await expand();
        await milestoneButtons(details);
        await click(screen.getByTestId(testIds.sidebarHub.customRowModule(0, 1)));
        await click(screen.getByTestId(testIds.sidebarHub.customRowModule(0, 2)));

        expect(openDocsPage).toHaveBeenCalledTimes(1);
        await act(async () => finish());
      });
    });

    it('shows the error toast when a custom guide fails to open', async () => {
      const guide = published('a');
      mockUsePublishedGuides.mockReturnValue({
        guides: [guide],
        paths: [],
        orphanGuides: [guide],
        isLoading: false,
        hasLoaded: true,
      });
      openDocsPage.mockRejectedValue(new Error('unavailable'));
      setup({ recommendations: [pkg('one')] });

      await click(within(screen.getByTestId(testIds.sidebarHub.customRow(0))).getByRole('button'));

      await waitFor(() =>
        expect(mockPublish).toHaveBeenCalledWith({
          type: 'alert-error',
          payload: ['Could not open the guide', 'Something went wrong while loading the guide. Please try again.'],
        })
      );
    });

    it('shows nothing while empty and a skeleton while loading', () => {
      mockUsePublishedGuides.mockReturnValue({
        guides: [],
        paths: [],
        orphanGuides: [],
        isLoading: true,
        hasLoaded: false,
      });
      setup({ recommendations: [pkg('one')] });

      expect(screen.queryByTestId(testIds.sidebarHub.customGuides)).not.toBeInTheDocument();
      expect(screen.getByTestId(testIds.sidebarHub.customGuidesLoading)).toBeInTheDocument();
    });
  });
});
