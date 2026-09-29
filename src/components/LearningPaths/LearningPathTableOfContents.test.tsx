import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { LearningPathTableOfContents } from './LearningPathTableOfContents';
import { interactiveCompletionStorage, milestoneCompletionStorage } from '../../lib/user-storage';
import { resetMilestoneBackfillGuardForTests } from '../../docs-retrieval';
import type { CoverPageTrack, Milestone } from '../../types/content.types';

jest.mock('@grafana/ui', () => ({
  useStyles2: () => new Proxy({}, { get: (_t, p) => String(p) }),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
  TabsBar: ({ children, ...rest }: { children: React.ReactNode }) => (
    <div role="tablist" {...rest}>
      {children}
    </div>
  ),
  Tab: ({
    label,
    active,
    onChangeTab,
    'data-testid': testId,
  }: {
    label: string;
    active?: boolean;
    onChangeTab?: () => void;
    'data-testid'?: string;
  }) => (
    <button type="button" role="tab" aria-selected={active} data-testid={testId} onClick={onChangeTab}>
      {label}
    </button>
  ),
  TabContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  // `@grafana/runtime`'s own module init reaches for these two, and the real
  // percentage calculation this file exercises imports it transitively
  // (docs-retrieval -> security -> dev-mode -> @grafana/runtime).
  createLogger: () => ({
    logger: () => undefined,
    enable: () => undefined,
    disable: () => undefined,
    isEnabled: () => false,
  }),
  attachDebugger: () => undefined,
}));

// The percentage the cover page shows is the real shared calculation, so the
// modules it reaches through have to load. Only the Grafana platform surface
// is stubbed — never the calculation itself, or this file would agree with a
// reimplementation instead of the code that ships.
jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: { id: 1, orgId: 1 } }, namespace: 'stacks-123', featureToggles: {} },
  getAppEvents: () => ({ publish: jest.fn() }),
  getBackendSrv: () => ({ fetch: jest.fn(), get: jest.fn(), post: jest.fn() }),
  locationService: { push: jest.fn(), getSearchObject: () => ({}) },
  usePluginUserStorage: jest.fn(),
  reportInteraction: jest.fn(),
}));

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k])) : fallback,
}));

jest.mock('../../lib/user-storage', () => ({
  // Legacy read only — the component reads completion through the shared
  // percentage calculation, which folds this in for pre-existing data
  // (see `journeyMilestonePercentages`'s backfill).
  milestoneCompletionStorage: { getCompletedSync: jest.fn(() => new Set()) },
  interactiveCompletionStorage: { peekAll: jest.fn(() => ({})), set: jest.fn(() => Promise.resolve()) },
  // Reached by the real calculation's module graph, never called from a
  // render path here.
  journeyCompletionStorage: { getAll: jest.fn(), set: jest.fn(), clear: jest.fn() },
  learningProgressStorage: { get: jest.fn(), save: jest.fn() },
}));

const getBadgeForPathMock = jest.fn();
jest.mock('../../learning-paths', () => ({
  getBadgeForPath: (...args: unknown[]) => getBadgeForPathMock(...args),
}));

const getCompletedSyncMock = milestoneCompletionStorage.getCompletedSync as jest.MockedFunction<
  typeof milestoneCompletionStorage.getCompletedSync
>;
const peekAllMock = interactiveCompletionStorage.peekAll as jest.MockedFunction<
  typeof interactiveCompletionStorage.peekAll
>;

/** Sets the legacy completed-slugs read the shared calculation folds in,
 *  keyed by milestone slug — matching what `milestoneCompletionStorage`
 *  persisted before this store existed. */
function setCompletedSlugs(slugs: Set<string>): void {
  getCompletedSyncMock.mockReturnValue(slugs);
}

const baseUrl = 'https://grafana.com/docs/learning-paths/demo/';
const milestones: Milestone[] = [
  { number: 1, title: 'Set up', url: `${baseUrl}set-up/content.json`, isActive: false },
  { number: 2, title: 'Explore', url: `${baseUrl}explore/content.json`, isActive: false },
];

describe('LearningPathTableOfContents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMilestoneBackfillGuardForTests();
    peekAllMock.mockReturnValue({});
    getCompletedSyncMock.mockReturnValue(new Set());
  });

  it('renders every milestone title with a heading', () => {
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    expect(screen.getByText('In this path')).toBeInTheDocument();
    expect(screen.getByText('Set up')).toBeInTheDocument();
    expect(screen.getByText('Explore')).toBeInTheDocument();
  });

  it('shows a check for completed milestones and a play icon for the next (current) one', () => {
    setCompletedSlugs(new Set(['set-up']));
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    expect(document.querySelectorAll('[data-icon="check"]')).toHaveLength(1);
    // Scoped to the module-list rows — the "Resume" CTA button above also
    // renders its own play icon, which a document-wide query would double-count.
    expect(document.querySelectorAll('.guideIconBadge [data-icon="play"]')).toHaveLength(1);
  });

  // The shared calculation is synchronous (storage-backed, not a promise),
  // so real progress is what the very first render sees — no loading
  // window where an in-progress path could briefly read as 0%.
  it('shows the real CTA target on the very first render, with no loading window', () => {
    setCompletedSlugs(new Set(['set-up']));
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    expect(screen.getByText('Resume')).toBeInTheDocument();
    expect(document.querySelector('[data-journey-start]')).toHaveAttribute('data-milestone-url', milestones[1]!.url);
  });

  // The module list's React key falls back to an ordinal (e.g. "2") when a
  // Milestone carries no real manifest id (the `milestones` fixture above
  // never sets one) — GuideList must never forward that fallback as
  // data-milestone-id, since an ordinal would never match a real manifest
  // id and would misclassify the next load as the cover page.
  it('never sends a fallback ordinal id as data-milestone-id when milestones carry no real id', () => {
    setCompletedSlugs(new Set(['set-up']));
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    expect(document.querySelector('[data-journey-start]')).not.toHaveAttribute('data-milestone-id');
  });

  it('sends the real manifest guide id as data-milestone-id when milestones carry one', () => {
    const milestonesWithIds: Milestone[] = [
      { id: 'set-up', number: 1, title: 'Set up', url: `${baseUrl}set-up/content.json`, isActive: false },
      { id: 'explore', number: 2, title: 'Explore', url: `${baseUrl}explore/content.json`, isActive: false },
    ];
    setCompletedSlugs(new Set(['set-up']));
    render(<LearningPathTableOfContents milestones={milestonesWithIds} baseUrl={baseUrl} />);

    expect(document.querySelector('[data-journey-start]')).toHaveAttribute('data-milestone-id', 'explore');
  });

  it('shows a Get started CTA targeting the first milestone, with no progress ring, at 0%', () => {
    setCompletedSlugs(new Set());
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    const cta = screen.getByText('Get started');
    expect(cta.closest('button')).toHaveAttribute('data-journey-start', 'true');
    expect(cta.closest('button')).toHaveAttribute('data-milestone-url', milestones[0]!.url);
    expect(cta.closest('button')).toHaveAttribute('data-interaction-location', 'get_started_cta');
    expect(screen.queryByText('40%')).not.toBeInTheDocument();
  });

  it('shows a progress ring and a Resume CTA targeting the next incomplete milestone', () => {
    setCompletedSlugs(new Set(['set-up']));
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    const cta = screen.getByText('Resume');
    expect(cta.closest('button')).toHaveAttribute('data-milestone-url', milestones[1]!.url);
    expect(cta.closest('button')).toHaveAttribute('data-interaction-location', 'resume_cta');
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  // The number on this page is the mean of the milestones' OWN percentages,
  // not a completed-count fraction: one module finished and the next 40%
  // through reads 70%, where counting completed modules would read 50%.
  it("averages the milestones' own percentages, not the count of completed ones", () => {
    setCompletedSlugs(new Set(['set-up']));
    peekAllMock.mockReturnValue({ [milestones[1]!.url]: 40 });
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.queryByText('50%')).not.toBeInTheDocument();
  });

  it('hides the CTA once every milestone is completed', () => {
    setCompletedSlugs(new Set(['set-up', 'explore']));
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    // Both milestone rows plus the now-100%-complete progress ring each render
    // their own checkmark — the ring shows a checkmark rather than "100%" text.
    expect(document.querySelectorAll('[data-icon="check"]')).toHaveLength(3);
    expect(screen.queryByText('Get started')).not.toBeInTheDocument();
    expect(screen.queryByText('Resume')).not.toBeInTheDocument();
  });

  it("renders each milestone's description when the source provides one", () => {
    const withDescriptions: Milestone[] = [
      { ...milestones[0]!, description: 'Connect Grafana to your first data source.' },
      milestones[1]!,
    ];
    render(<LearningPathTableOfContents milestones={withDescriptions} baseUrl={baseUrl} />);

    expect(screen.getByText('Connect Grafana to your first data source.')).toBeInTheDocument();
  });

  it('shows an "Earns X badge" preview when the path has a completion badge', () => {
    getBadgeForPathMock.mockReturnValue({ id: 'core-badge', title: 'Core Concepts', icon: 'grafana' });
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} pathId="core-grafana-concepts-lj" />);

    expect(getBadgeForPathMock).toHaveBeenCalledWith('core-grafana-concepts-lj');
    expect(screen.getByText('Earns Core Concepts badge')).toBeInTheDocument();
  });

  it('omits the badge preview when no pathId is known or no badge is defined for it', () => {
    getBadgeForPathMock.mockReturnValue(undefined);
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    expect(getBadgeForPathMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Earns .* badge/)).not.toBeInTheDocument();
  });

  it('shows a hero card with the title, description, and module count when provided', () => {
    render(
      <LearningPathTableOfContents
        milestones={milestones}
        baseUrl={baseUrl}
        title="Connect your first data source"
        description="Learn how Grafana connects to data."
      />
    );

    expect(screen.getByTestId('learning-paths-cover-hero')).toBeInTheDocument();
    expect(screen.getByText('Connect your first data source')).toBeInTheDocument();
    expect(screen.getByText('Learn how Grafana connects to data.')).toBeInTheDocument();
    expect(screen.getByText('2 modules')).toBeInTheDocument();
  });

  it('shows the hero card from title alone, with no description and no badge', () => {
    getBadgeForPathMock.mockReturnValue(undefined);
    render(
      <LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} title="Connect your first data source" />
    );

    expect(screen.getByTestId('learning-paths-cover-hero')).toBeInTheDocument();
    expect(screen.getByText('Connect your first data source')).toBeInTheDocument();
  });

  it('omits the hero card entirely when there is no title, description, or badge', () => {
    getBadgeForPathMock.mockReturnValue(undefined);
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    expect(screen.queryByTestId('learning-paths-cover-hero')).not.toBeInTheDocument();
  });

  it('shows the total estimated duration when every milestone has one authored', () => {
    const timedMilestones: Milestone[] = [
      { ...milestones[0]!, estimatedMinutes: 15 },
      { ...milestones[1]!, estimatedMinutes: 20 },
    ];
    render(<LearningPathTableOfContents milestones={timedMilestones} baseUrl={baseUrl} description="Summary" />);

    expect(screen.getByText('35 min')).toBeInTheDocument();
  });

  it('formats the total as hours once it reaches 60 minutes, rounded', () => {
    const timedMilestones: Milestone[] = [
      { ...milestones[0]!, estimatedMinutes: 100 },
      { ...milestones[1]!, estimatedMinutes: 130 },
    ];
    render(<LearningPathTableOfContents milestones={timedMilestones} baseUrl={baseUrl} description="Summary" />);

    // 230 min = 3.83h, rounds to 4h.
    expect(screen.getByText('~4 hr')).toBeInTheDocument();
  });

  it('omits the total duration from the hero when any milestone lacks an authored estimate', () => {
    // milestones[0] has its own authored estimate (rendered on its own row
    // regardless), but milestones[1] doesn't — the hero total requires all.
    const partiallyTimedMilestones: Milestone[] = [{ ...milestones[0]!, estimatedMinutes: 15 }, milestones[1]!];
    render(
      <LearningPathTableOfContents milestones={partiallyTimedMilestones} baseUrl={baseUrl} description="Summary" />
    );

    const hero = screen.getByTestId('learning-paths-cover-hero');
    expect(hero).not.toHaveTextContent('min');
    expect(hero).not.toHaveTextContent('hr');
  });

  describe('sequential lock/unlock', () => {
    const threeMilestones: Milestone[] = [
      { number: 1, title: 'One', url: `${baseUrl}one/content.json`, isActive: false },
      { number: 2, title: 'Two', url: `${baseUrl}two/content.json`, isActive: false },
      { number: 3, title: 'Three', url: `${baseUrl}three/content.json`, isActive: false },
    ];

    it('locks every module after the first, unstarted one', () => {
      render(<LearningPathTableOfContents milestones={threeMilestones} baseUrl={baseUrl} />);

      expect(screen.getAllByText('Locked')).toHaveLength(2);
      expect(document.querySelectorAll('.guideIconBadge [data-icon="lock"]')).toHaveLength(2);
    });

    it('unlocks the next module once the previous one completes, keeping the rest locked', () => {
      setCompletedSlugs(new Set(['one']));
      render(<LearningPathTableOfContents milestones={threeMilestones} baseUrl={baseUrl} />);

      expect(screen.getAllByText('Locked')).toHaveLength(1);
      expect(document.querySelectorAll('.guideIconBadge [data-icon="play"]')).toHaveLength(1);
    });

    it('treats a module completed out of order as done, not locked', () => {
      // "Three" completed while "One"/"Two" aren't — the cursor still sits at
      // "One", but "Three" must not be marked both completed and locked.
      setCompletedSlugs(new Set(['three']));
      render(<LearningPathTableOfContents milestones={threeMilestones} baseUrl={baseUrl} />);

      expect(document.querySelectorAll('.guideIconBadge [data-icon="check"]')).toHaveLength(1);
      // Only "Two" is locked; "Three" is done and "One" is the current cursor.
      expect(screen.getAllByText('Locked')).toHaveLength(1);
      expect(document.querySelectorAll('.guideIconBadge [data-icon="lock"]')).toHaveLength(1);
    });
  });

  describe('tracks (Path Tracks RFC)', () => {
    const builderMilestones: Milestone[] = [
      { number: 1, title: 'Builder one', url: `${baseUrl}builder-one/content.json`, isActive: false },
    ];
    const sellerMilestones: Milestone[] = [
      { number: 1, title: 'Seller one', url: `${baseUrl}seller-one/content.json`, isActive: false },
      { number: 2, title: 'Seller two', url: `${baseUrl}seller-two/content.json`, isActive: false },
    ];
    const tracks: CoverPageTrack[] = [
      { trackId: 'builder', label: 'Builder', milestones: builderMilestones },
      { trackId: 'seller', label: 'Seller', milestones: sellerMilestones },
    ];

    // Regression: no `tracks` prop (the case every caller used before Path
    // Tracks existed) must render byte-for-byte what it always did — a single
    // flat list, no tab bar at all.
    it('renders no tab bar and the plain flat list when tracks is omitted', () => {
      setCompletedSlugs(new Set());
      render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
      expect(screen.queryByText('Foundations')).not.toBeInTheDocument();
      expect(screen.getByText('Set up')).toBeInTheDocument();
      expect(screen.getByText('Explore')).toBeInTheDocument();
    });

    it('renders no tab bar when tracks is an empty array', () => {
      setCompletedSlugs(new Set());
      render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} tracks={[]} />);

      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    });

    it('renders a Foundations tab plus one tab per declared track', () => {
      setCompletedSlugs(new Set());
      render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} tracks={tracks} />);

      expect(screen.getByRole('tablist')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Foundations' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Builder' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Seller' })).toBeInTheDocument();
    });

    // The tabs bar needs its own top margin because `hero`'s bottom margin
    // is deliberately 0 (so the no-tracks case above stays pixel-for-pixel
    // unchanged) and `@grafana/ui`'s TabsBar carries none of its own.
    it('gives the tabs bar its own top margin, separate from the hero card', () => {
      setCompletedSlugs(new Set());
      render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} tracks={tracks} />);

      expect(screen.getByRole('tablist').className).toContain('tracksTabs');
    });

    // getManifestTracks (the shared utility every tracks consumer reads
    // through) drops a reserved-id or duplicate trackId before it ever
    // reaches this component, so the tab bar renders from an already-clean
    // `tracks` prop and never shows two tabs simultaneously marked active.
    it('marks exactly one tab active at a time, whichever tab is selected', () => {
      setCompletedSlugs(new Set());
      render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} tracks={tracks} />);

      expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1);

      fireEvent.click(screen.getByRole('tab', { name: 'Builder' }));
      expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1);
      expect(screen.getByRole('tab', { name: 'Builder' })).toHaveAttribute('aria-selected', 'true');

      fireEvent.click(screen.getByRole('tab', { name: 'Seller' }));
      expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1);
      expect(screen.getByRole('tab', { name: 'Seller' })).toHaveAttribute('aria-selected', 'true');
    });

    // Regression: the active track tab used to be purely local state, never
    // reaching the panel model, so Next/Previous always resolved against
    // Foundations regardless of the selected tab. onActiveTrackChange is how
    // the model learns which tab is selected.
    it('reports the selected tab via onActiveTrackChange, including on mount', () => {
      setCompletedSlugs(new Set());
      const onActiveTrackChange = jest.fn();
      render(
        <LearningPathTableOfContents
          milestones={milestones}
          baseUrl={baseUrl}
          tracks={tracks}
          onActiveTrackChange={onActiveTrackChange}
        />
      );

      expect(onActiveTrackChange).toHaveBeenLastCalledWith(null, null);

      fireEvent.click(screen.getByRole('tab', { name: 'Builder' }));
      expect(onActiveTrackChange).toHaveBeenLastCalledWith('builder', builderMilestones);

      fireEvent.click(screen.getByRole('tab', { name: 'Foundations' }));
      expect(onActiveTrackChange).toHaveBeenLastCalledWith(null, null);
    });

    // Every navigation remounts this component (ContentRenderer keys on the
    // loaded URL). Without initialActiveTrackId, a fresh mount always starts
    // at Foundations and its mount-time onActiveTrackChange call would
    // overwrite the caller's stored selection with it.
    it('restores the selected tab from initialActiveTrackId instead of defaulting to Foundations on mount', () => {
      setCompletedSlugs(new Set());
      const onActiveTrackChange = jest.fn();
      render(
        <LearningPathTableOfContents
          milestones={milestones}
          baseUrl={baseUrl}
          tracks={tracks}
          initialActiveTrackId="builder"
          onActiveTrackChange={onActiveTrackChange}
        />
      );

      expect(screen.getByRole('tab', { name: 'Builder' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Builder one')).toBeInTheDocument();
      expect(onActiveTrackChange).toHaveBeenLastCalledWith('builder', builderMilestones);
    });

    it("falls back to Foundations when initialActiveTrackId names no real track (a different path's leftover selection)", () => {
      setCompletedSlugs(new Set());
      render(
        <LearningPathTableOfContents
          milestones={milestones}
          baseUrl={baseUrl}
          tracks={tracks}
          initialActiveTrackId="some-other-path-track"
        />
      );

      expect(screen.getByRole('tab', { name: 'Foundations' })).toHaveAttribute('aria-selected', 'true');
    });

    // content-renderer.tsx reuses this component instance across
    // navigation, with no remount key between paths — activeTabId must
    // reset when the props change, or a track selected on one path either
    // leaves no tab active on the next (its trackId doesn't exist there)
    // or silently pre-selects a same-named track the reader never clicked.
    it('resets the active tab to Foundations when the path changes (no remount key between paths)', () => {
      setCompletedSlugs(new Set());
      const { rerender } = render(
        <LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} tracks={tracks} />
      );

      fireEvent.click(screen.getByRole('tab', { name: 'Seller' }));
      expect(screen.getByRole('tab', { name: 'Seller' })).toHaveAttribute('aria-selected', 'true');

      // A different path, reusing the SAME "Builder"/"Seller" track ids and
      // labels — the exact case where a naive reset-by-trackId-existence
      // would silently keep a track selected instead of defaulting back to
      // Foundations, since a track sharing the stale id exists here too.
      const otherPathBaseUrl = 'https://grafana.com/docs/learning-paths/other-demo/';
      const otherMilestones: Milestone[] = [
        { number: 1, title: 'Other set up', url: `${otherPathBaseUrl}other-set-up/content.json`, isActive: false },
      ];
      rerender(<LearningPathTableOfContents milestones={otherMilestones} baseUrl={otherPathBaseUrl} tracks={tracks} />);

      expect(screen.getByRole('tab', { name: 'Foundations' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tab', { name: 'Seller' })).toHaveAttribute('aria-selected', 'false');
      expect(screen.getByText('Other set up')).toBeInTheDocument();
      expect(screen.queryByText('Seller one')).not.toBeInTheDocument();
    });

    it('shows the Foundations sequence by default, with Foundations active', () => {
      setCompletedSlugs(new Set());
      render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} tracks={tracks} />);

      expect(screen.getByRole('tab', { name: 'Foundations' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Set up')).toBeInTheDocument();
      expect(screen.getByText('Explore')).toBeInTheDocument();
      expect(screen.queryByText('Builder one')).not.toBeInTheDocument();
    });

    it("switches the module list, hero module count, and progress lookup to the active track's own guides", () => {
      setCompletedSlugs(new Set());
      render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} tracks={tracks} />);

      fireEvent.click(screen.getByRole('tab', { name: 'Seller' }));

      expect(screen.getByRole('tab', { name: 'Seller' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('Seller one')).toBeInTheDocument();
      expect(screen.getByText('Seller two')).toBeInTheDocument();
      expect(screen.queryByText('Set up')).not.toBeInTheDocument();
      expect(getCompletedSyncMock).toHaveBeenLastCalledWith(
        baseUrl,
        sellerMilestones.map((m) => m.url)
      );
    });

    // The shared percentage calculation is synchronous and re-runs on
    // every render, so switching tabs cannot leave the CTA/click target
    // live against the PREVIOUS tab's stale completion data.
    it('shows the new tab CTA immediately on tab switch, with no stale window', () => {
      setCompletedSlugs(new Set());
      render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} tracks={tracks} />);

      expect(screen.getByText('Get started')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'Seller' }));

      expect(screen.getByText('Seller one')).toBeInTheDocument();
      expect(document.querySelector('[data-journey-start]')).toHaveAttribute(
        'data-milestone-url',
        sellerMilestones[0]!.url
      );
    });

    it('reuses the Foundations sequential lock/unlock mechanism for a track', () => {
      setCompletedSlugs(new Set());
      render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} tracks={tracks} />);

      fireEvent.click(screen.getByRole('tab', { name: 'Seller' }));

      expect(screen.getAllByText('Locked')).toHaveLength(1);
      expect(document.querySelectorAll('.guideIconBadge [data-icon="lock"]')).toHaveLength(1);
    });

    it('reflects the hero module count for the active tab, not the Foundations count', () => {
      setCompletedSlugs(new Set());
      render(
        <LearningPathTableOfContents
          milestones={milestones}
          baseUrl={baseUrl}
          tracks={tracks}
          title="Alerting enablement"
        />
      );

      expect(screen.getByText('2 modules')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'Builder' }));
      expect(screen.getByText('1 modules')).toBeInTheDocument();
    });

    // A track is a presentation ordering only, never a second completion
    // authority (COMPLETION-MODEL.md) — the durable, path-wide percentage
    // shown elsewhere (My Learning) can legitimately read lower than this
    // ring's own number for the same guides, since it stays keyed to
    // Foundations membership alone. The ring must not read as path
    // completion; its accessible label names the active sequence instead.
    it("scopes the progress ring's accessible label to the active sequence, not the path as a whole", () => {
      setCompletedSlugs(new Set(['set-up', 'seller-one']));
      render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} tracks={tracks} />);

      expect(screen.getByRole('img', { name: '50% through Foundations' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('tab', { name: 'Seller' }));

      expect(screen.getByRole('img', { name: '50% through Seller' })).toBeInTheDocument();
    });
  });

  it('backfills a legacy milestoneCompletionStorage completion into interactiveCompletionStorage once', async () => {
    setCompletedSlugs(new Set(['set-up']));
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    await act(async () => {
      await waitFor(() => expect(interactiveCompletionStorage.set).toHaveBeenCalledWith(milestones[0]!.url, 100));
      // Drains the announcement chained onto the backfill write, so it lands
      // inside `act` rather than after the test's own render has settled.
      await Promise.resolve();
    });
  });
});
