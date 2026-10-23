import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ContextPanel } from './context-panel';
import { PLUGIN_BASE_URL } from '../../constants';
import { testIds } from '../../constants/testIds';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { useContextPanel, type Recommendation } from '../../context-engine';
import { resolvePackageNavLinks } from '../../docs-retrieval';
import { useLearningPaths, useMyAssignments, type ResolvedAssignment } from '../../learning-paths';
import { useBooleanFlag } from '../../utils/openfeature';

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
jest.mock('../../docs-retrieval', () => ({ resolvePackageNavLinks: jest.fn() }));
jest.mock('../../learning-paths', () => ({
  ...jest.requireActual('../../learning-paths'),
  useLearningPaths: jest.fn(),
  useMyAssignments: jest.fn(),
}));
jest.mock('../../utils/openfeature', () => ({ useBooleanFlag: jest.fn() }));
jest.mock('../../hooks', () => ({
  usePathfinderPluginConfig: () => ({ config: { acceptedTermsAndConditions: true } }),
}));
const mockUsePublishedGuides = jest.fn();
jest.mock('../../utils/usePublishedGuides', () => ({
  usePublishedGuides: () => mockUsePublishedGuides(),
}));
jest.mock('./hooks', () => ({ useRecommendationsScrollPosition: () => jest.fn() }));
jest.mock('../UserProfileBar/UserProfileBar', () => ({
  UserProfileBar: () => <div data-testid="user-profile-bar" />,
}));
jest.mock('../InteractiveLearningBanner', () => ({ InteractiveLearningBanner: () => null }));
jest.mock('../EnableRecommenderBanner', () => ({
  EnableRecommenderBanner: () => <div data-testid="enable-recommender-banner" />,
}));
jest.mock('../HelpFooter', () => ({
  HelpFooter: ({ variant }: { variant?: string }) => <div data-testid="help-footer" data-variant={variant} />,
}));

const { __mockPush: mockPush, __mockPublish: mockPublish } = jest.requireMock('@grafana/runtime');
const mockUseContextPanel = useContextPanel as jest.Mock;
const mockUseLearningPaths = useLearningPaths as jest.Mock;
const mockUseMyAssignments = useMyAssignments as jest.Mock;
const mockUseBooleanFlag = useBooleanFlag as jest.Mock;
const mockResolvePackageNavLinks = resolvePackageNavLinks as jest.Mock;

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
  hub?: boolean;
  recommendations?: Recommendation[];
  featured?: Recommendation[];
  startedPath?: boolean;
  manifestPath?: boolean;
  privatePath?: boolean;
  assignments?: ResolvedAssignment[];
  hasLoadedAssignments?: boolean;
}

function setup({
  hub = true,
  recommendations = [],
  featured = [],
  startedPath = false,
  manifestPath = false,
  privatePath = false,
  assignments = [],
  hasLoadedAssignments = true,
}: SetupOptions = {}) {
  mockUseBooleanFlag.mockImplementation((flag: string) => hub && flag === 'pathfinder.sidebar-hub');
  mockUseContextPanel.mockReturnValue({
    contextData: {
      recommendations,
      featuredRecommendations: featured,
      recommendationsError: null,
      isLoading: false,
    },
    isLoadingRecommendations: false,
    hasFetchedRecommendations: true,
    otherDocsExpanded: false,
    openLearningJourney,
    openDocsPage,
    toggleSummaryExpansion,
    toggleOtherDocsExpansion: jest.fn(),
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

describe('ContextPanelRenderer sidebar hub flag', () => {
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
  });

  it('keeps the existing recommended tab when the flag is off', async () => {
    setup({ hub: false, recommendations: [pkg('one')] });

    expect(screen.getByTestId('user-profile-bar')).toBeInTheDocument();
    expect(screen.getByTestId(testIds.contextPanel.recommendationsContainer)).toBeInTheDocument();
    expect(screen.queryByTestId(testIds.sidebarHub.container)).not.toBeInTheDocument();
    expect(screen.getByTestId('help-footer')).toHaveAttribute('data-variant', 'default');
  });

  it('renders the hub with the compact footer when the flag is on', async () => {
    setup({ recommendations: [pkg('one')] });

    expect(screen.getByTestId(testIds.sidebarHub.container)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome back, Ada' })).toBeInTheDocument();
    expect(screen.queryByTestId('user-profile-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId(testIds.contextPanel.recommendationsContainer)).not.toBeInTheDocument();
    expect(screen.getByTestId('help-footer')).toHaveAttribute('data-variant', 'compact');
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
      content_type: 'interactive-guide',
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
        content_type: 'interactive-guide',
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
      content_type: 'learning-journey',
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
      content_type: 'learning-journey',
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
      content_type: 'learning-journey',
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
        content_type: 'learning-journey',
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
      expect(within(details).getByRole('heading', { name: 'Modules' })).toBeInTheDocument();

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
      expect(screen.queryByRole('heading', { name: 'Modules' })).not.toBeInTheDocument();
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
        within(screen.getByTestId(testIds.sidebarHub.rowDetails(0))).queryByText('Modules')
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
      expect(screen.queryByRole('heading', { name: 'Modules' })).not.toBeInTheDocument();
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

      await click(within(screen.getByTestId(testIds.sidebarHub.customRow(0))).getByRole('button'));

      expect(openDocsPage).toHaveBeenCalledWith(
        'backend-guide:p1',
        'Custom p1',
        expect.objectContaining({ packageId: 'p1', launchSource: 'custom_guide', trackId: 'ops' })
      );
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

    it('keeps the old custom guides section and omits the hub one when the flag is off', () => {
      mockUsePublishedGuides.mockReturnValue({
        guides: [published('a')],
        paths: [],
        orphanGuides: [published('a')],
        isLoading: false,
        hasLoaded: true,
      });
      setup({ hub: false, recommendations: [pkg('one')] });

      expect(screen.queryByTestId(testIds.sidebarHub.customGuides)).not.toBeInTheDocument();
      expect(screen.getByTestId(testIds.contextPanel.customGuidesSection)).toBeInTheDocument();
    });
  });
});
