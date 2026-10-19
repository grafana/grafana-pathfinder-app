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
jest.mock('../../utils/usePublishedGuides', () => ({
  usePublishedGuides: () => ({
    guides: [],
    paths: [],
    orphanGuides: [],
    isLoading: false,
    hasLoaded: true,
  }),
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
  assignments?: ResolvedAssignment[];
  hasLoadedAssignments?: boolean;
}

function setup({
  hub = true,
  recommendations = [],
  featured = [],
  startedPath = false,
  manifestPath = false,
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
    toggleSummaryExpansion: jest.fn(),
    toggleOtherDocsExpansion: jest.fn(),
  });
  const path = {
    id: 'getting-started',
    title: 'Getting started',
    description: '',
    guides: ['a', 'b'],
    badgeId: 'b',
    ...(manifestPath && { manifest: { type: 'path', milestones: ['a', 'b'] } }),
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
  render(<ContextPanel.Component model={model as never} />);
}

describe('ContextPanelRenderer sidebar hub flag', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    const rows = within(screen.getByTestId(testIds.sidebarHub.moreList)).getAllByRole('button');
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

  it('opens a docs page row without package info', async () => {
    setup({
      featured: [pkg('top')],
      recommendations: [{ title: 'Docs', url: 'https://grafana.com/docs/x/', type: 'docs-page' }],
    });

    await click(within(screen.getByTestId(testIds.sidebarHub.row(0))).getByRole('button'));

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
    await click(within(screen.getByTestId(testIds.sidebarHub.row(0))).getByRole('button'));
    await click(screen.getByTestId(testIds.sidebarHub.resumeAction));

    expect(openDocsPage).toHaveBeenCalledTimes(1);
    expect(openLearningJourney).not.toHaveBeenCalled();
    expect(screen.getByTestId(testIds.sidebarHub.featuredAction)).toBeDisabled();
    expect(screen.getByTestId(testIds.sidebarHub.resumeAction)).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.getByTestId(testIds.sidebarHub.featuredAction)).toBeEnabled());
    expect(screen.getByTestId(testIds.sidebarHub.resumeAction)).toBeEnabled();
  });
});
