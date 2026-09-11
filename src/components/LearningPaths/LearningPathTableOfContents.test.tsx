import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { LearningPathTableOfContents } from './LearningPathTableOfContents';
import { interactiveCompletionStorage, milestoneCompletionStorage } from '../../lib/user-storage';
import type { Milestone } from '../../types/content.types';

jest.mock('@grafana/ui', () => ({
  useStyles2: () => new Proxy({}, { get: (_t, p) => String(p) }),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
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
  milestoneCompletionStorage: { getCompleted: jest.fn(), getCompletedSync: jest.fn(() => new Set()) },
  interactiveCompletionStorage: { peekAll: jest.fn(() => ({})) },
  // Reached by the real calculation's module graph, never called from a
  // render path here.
  journeyCompletionStorage: { getAll: jest.fn(), set: jest.fn(), clear: jest.fn() },
  learningProgressStorage: { get: jest.fn(), save: jest.fn() },
}));

const getBadgeForPathMock = jest.fn();
jest.mock('../../learning-paths', () => ({
  getBadgeForPath: (...args: unknown[]) => getBadgeForPathMock(...args),
}));

const getCompletedMock = milestoneCompletionStorage.getCompleted as jest.MockedFunction<
  typeof milestoneCompletionStorage.getCompleted
>;
const getCompletedSyncMock = milestoneCompletionStorage.getCompletedSync as jest.MockedFunction<
  typeof milestoneCompletionStorage.getCompletedSync
>;
const peekAllMock = interactiveCompletionStorage.peekAll as jest.MockedFunction<
  typeof interactiveCompletionStorage.peekAll
>;

/** Sets both the async completion read (drives checkmarks/CTA target) and
 *  the sync one (drives journeyProgressFromMilestones's percentage) from
 *  the same slugs, so the two halves of the component agree in tests the
 *  way they agree in production. */
function setCompletedSlugs(slugs: Set<string>): void {
  getCompletedMock.mockResolvedValue(slugs);
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
    peekAllMock.mockReturnValue({});
  });

  it('renders every milestone title with a heading', async () => {
    setCompletedSlugs(new Set());
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    expect(screen.getByText('In this path')).toBeInTheDocument();
    expect(screen.getByText('Set up')).toBeInTheDocument();
    expect(screen.getByText('Explore')).toBeInTheDocument();
    await waitFor(() =>
      expect(getCompletedMock).toHaveBeenCalledWith(
        baseUrl,
        milestones.map((milestone) => milestone.url)
      )
    );
  });

  it('shows a check for completed milestones and a play icon for the next (current) one', async () => {
    setCompletedSlugs(new Set(['set-up']));
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    await waitFor(() => expect(document.querySelectorAll('[data-icon="check"]')).toHaveLength(1));
    // Scoped to the module-list rows — the "Resume" CTA button above also
    // renders its own play icon, which a document-wide query would double-count.
    expect(document.querySelectorAll('.guideIconBadge [data-icon="play"]')).toHaveLength(1);
  });

  // Regression test (Cursor Bugbot, "Cover CTA resumes before progress
  // loads"): completedSlugs starts empty, so before getCompleted resolves,
  // an in-progress path reads as "0% done, start at module 1." A click on
  // the CTA or the current-row affordance during that window must not be
  // possible — it would resume the wrong milestone.
  it('offers no CTA or clickable row until progress has loaded, even for an in-progress path', async () => {
    let resolveCompleted: (slugs: Set<string>) => void = () => {};
    getCompletedMock.mockReturnValue(
      new Promise((resolve) => {
        resolveCompleted = resolve;
      })
    );
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    // Titles render immediately from static data...
    expect(screen.getByText('Set up')).toBeInTheDocument();
    // ...but nothing is clickable until real progress is known.
    expect(screen.queryByText('Get started')).not.toBeInTheDocument();
    expect(screen.queryByText('Resume')).not.toBeInTheDocument();
    expect(document.querySelector('[data-journey-start]')).not.toBeInTheDocument();

    await act(async () => {
      getCompletedSyncMock.mockReturnValue(new Set(['set-up']));
      resolveCompleted(new Set(['set-up']));
    });

    expect(await screen.findByText('Resume')).toBeInTheDocument();
    expect(document.querySelector('[data-journey-start]')).toHaveAttribute('data-milestone-url', milestones[1]!.url);
  });

  it('shows a Get started CTA targeting the first milestone, with no progress ring, at 0%', async () => {
    setCompletedSlugs(new Set());
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    const cta = await screen.findByText('Get started');
    expect(cta.closest('button')).toHaveAttribute('data-journey-start', 'true');
    expect(cta.closest('button')).toHaveAttribute('data-milestone-url', milestones[0]!.url);
    expect(cta.closest('button')).toHaveAttribute('data-interaction-location', 'get_started_cta');
    expect(screen.queryByText('40%')).not.toBeInTheDocument();
  });

  it('shows a progress ring and a Resume CTA targeting the next incomplete milestone', async () => {
    setCompletedSlugs(new Set(['set-up']));
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    const cta = await screen.findByText('Resume');
    expect(cta.closest('button')).toHaveAttribute('data-milestone-url', milestones[1]!.url);
    expect(cta.closest('button')).toHaveAttribute('data-interaction-location', 'resume_cta');
    expect(await screen.findByText('50%')).toBeInTheDocument();
  });

  // The number on this page is the mean of the milestones' OWN percentages,
  // not a completed-count fraction: one module finished and the next 40%
  // through reads 70%, where counting completed modules would read 50%.
  it("averages the milestones' own percentages, not the count of completed ones", async () => {
    setCompletedSlugs(new Set(['set-up']));
    peekAllMock.mockReturnValue({ [milestones[1]!.url]: 40 });
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    expect(await screen.findByText('70%')).toBeInTheDocument();
    expect(screen.queryByText('50%')).not.toBeInTheDocument();
  });

  it('hides the CTA once every milestone is completed', async () => {
    setCompletedSlugs(new Set(['set-up', 'explore']));
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    // Both milestone rows plus the now-100%-complete progress ring each render
    // their own checkmark — the ring shows a checkmark rather than "100%" text.
    await waitFor(() => expect(document.querySelectorAll('[data-icon="check"]')).toHaveLength(3));
    expect(screen.queryByText('Get started')).not.toBeInTheDocument();
    expect(screen.queryByText('Resume')).not.toBeInTheDocument();
  });

  it("renders each milestone's description when the source provides one", async () => {
    setCompletedSlugs(new Set());
    const withDescriptions: Milestone[] = [
      { ...milestones[0]!, description: 'Connect Grafana to your first data source.' },
      milestones[1]!,
    ];
    render(<LearningPathTableOfContents milestones={withDescriptions} baseUrl={baseUrl} />);

    expect(await screen.findByText('Connect Grafana to your first data source.')).toBeInTheDocument();
  });

  it('shows an "Earns X badge" preview when the path has a completion badge', async () => {
    setCompletedSlugs(new Set());
    getBadgeForPathMock.mockReturnValue({ id: 'core-badge', title: 'Core Concepts', icon: 'grafana' });
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} pathId="core-grafana-concepts-lj" />);

    expect(getBadgeForPathMock).toHaveBeenCalledWith('core-grafana-concepts-lj');
    expect(await screen.findByText('Earns Core Concepts badge')).toBeInTheDocument();
  });

  it('omits the badge preview when no pathId is known or no badge is defined for it', async () => {
    setCompletedSlugs(new Set());
    getBadgeForPathMock.mockReturnValue(undefined);
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    await waitFor(() => expect(getCompletedMock).toHaveBeenCalled());
    expect(getBadgeForPathMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Earns .* badge/)).not.toBeInTheDocument();
  });

  it('shows a hero card with the title, description, and module count when provided', async () => {
    setCompletedSlugs(new Set());
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
    expect(await screen.findByText('2 modules')).toBeInTheDocument();
  });

  it('shows the hero card from title alone, with no description and no badge', async () => {
    setCompletedSlugs(new Set());
    getBadgeForPathMock.mockReturnValue(undefined);
    render(
      <LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} title="Connect your first data source" />
    );

    expect(screen.getByTestId('learning-paths-cover-hero')).toBeInTheDocument();
    expect(screen.getByText('Connect your first data source')).toBeInTheDocument();
  });

  it('omits the hero card entirely when there is no title, description, or badge', async () => {
    setCompletedSlugs(new Set());
    getBadgeForPathMock.mockReturnValue(undefined);
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    await waitFor(() => expect(getCompletedMock).toHaveBeenCalled());
    expect(screen.queryByTestId('learning-paths-cover-hero')).not.toBeInTheDocument();
  });

  it('shows the total estimated duration when every milestone has one authored', async () => {
    setCompletedSlugs(new Set());
    const timedMilestones: Milestone[] = [
      { ...milestones[0]!, estimatedMinutes: 15 },
      { ...milestones[1]!, estimatedMinutes: 20 },
    ];
    render(<LearningPathTableOfContents milestones={timedMilestones} baseUrl={baseUrl} description="Summary" />);

    expect(await screen.findByText('35 min')).toBeInTheDocument();
  });

  it('formats the total as hours once it reaches 60 minutes, rounded', async () => {
    setCompletedSlugs(new Set());
    const timedMilestones: Milestone[] = [
      { ...milestones[0]!, estimatedMinutes: 100 },
      { ...milestones[1]!, estimatedMinutes: 130 },
    ];
    render(<LearningPathTableOfContents milestones={timedMilestones} baseUrl={baseUrl} description="Summary" />);

    // 230 min = 3.83h, rounds to 4h.
    expect(await screen.findByText('~4 hr')).toBeInTheDocument();
  });

  it('omits the total duration from the hero when any milestone lacks an authored estimate', async () => {
    setCompletedSlugs(new Set());
    // milestones[0] has its own authored estimate (rendered on its own row
    // regardless), but milestones[1] doesn't — the hero total requires all.
    const partiallyTimedMilestones: Milestone[] = [{ ...milestones[0]!, estimatedMinutes: 15 }, milestones[1]!];
    render(
      <LearningPathTableOfContents milestones={partiallyTimedMilestones} baseUrl={baseUrl} description="Summary" />
    );

    const hero = await screen.findByTestId('learning-paths-cover-hero');
    expect(hero).not.toHaveTextContent('min');
    expect(hero).not.toHaveTextContent('hr');
  });

  describe('sequential lock/unlock', () => {
    const threeMilestones: Milestone[] = [
      { number: 1, title: 'One', url: `${baseUrl}one/content.json`, isActive: false },
      { number: 2, title: 'Two', url: `${baseUrl}two/content.json`, isActive: false },
      { number: 3, title: 'Three', url: `${baseUrl}three/content.json`, isActive: false },
    ];

    it('locks every module after the first, unstarted one', async () => {
      setCompletedSlugs(new Set());
      render(<LearningPathTableOfContents milestones={threeMilestones} baseUrl={baseUrl} />);

      await waitFor(() => expect(screen.getAllByText('Locked')).toHaveLength(2));
      expect(document.querySelectorAll('.guideIconBadge [data-icon="lock"]')).toHaveLength(2);
    });

    it('unlocks the next module once the previous one completes, keeping the rest locked', async () => {
      setCompletedSlugs(new Set(['one']));
      render(<LearningPathTableOfContents milestones={threeMilestones} baseUrl={baseUrl} />);

      await waitFor(() => expect(screen.getAllByText('Locked')).toHaveLength(1));
      expect(document.querySelectorAll('.guideIconBadge [data-icon="play"]')).toHaveLength(1);
    });

    it('treats a module completed out of order as done, not locked', async () => {
      // "Three" completed while "One"/"Two" aren't — the cursor still sits at
      // "One", but "Three" must not be marked both completed and locked.
      setCompletedSlugs(new Set(['three']));
      render(<LearningPathTableOfContents milestones={threeMilestones} baseUrl={baseUrl} />);

      await waitFor(() => expect(document.querySelectorAll('.guideIconBadge [data-icon="check"]')).toHaveLength(1));
      // Only "Two" is locked; "Three" is done and "One" is the current cursor.
      expect(screen.getAllByText('Locked')).toHaveLength(1);
      expect(document.querySelectorAll('.guideIconBadge [data-icon="lock"]')).toHaveLength(1);
    });
  });
});
