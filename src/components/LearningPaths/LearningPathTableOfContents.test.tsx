import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { LearningPathTableOfContents } from './LearningPathTableOfContents';
import { milestoneCompletionStorage } from '../../lib/user-storage';
import type { Milestone } from '../../types/content.types';

jest.mock('@grafana/ui', () => ({
  useStyles2: () => new Proxy({}, { get: (_t, p) => String(p) }),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k])) : fallback,
}));

jest.mock('../../lib/user-storage', () => ({
  milestoneCompletionStorage: { getCompleted: jest.fn() },
}));

const getBadgeForPathMock = jest.fn();
jest.mock('../../learning-paths', () => ({
  getBadgeForPath: (...args: unknown[]) => getBadgeForPathMock(...args),
}));

const getCompletedMock = milestoneCompletionStorage.getCompleted as jest.MockedFunction<
  typeof milestoneCompletionStorage.getCompleted
>;

const baseUrl = 'https://grafana.com/docs/learning-paths/demo/';
const milestones: Milestone[] = [
  { number: 1, title: 'Set up', url: `${baseUrl}set-up/content.json`, isActive: false },
  { number: 2, title: 'Explore', url: `${baseUrl}explore/content.json`, isActive: false },
];

describe('LearningPathTableOfContents', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders every milestone title with a heading', async () => {
    getCompletedMock.mockResolvedValue(new Set());
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
    getCompletedMock.mockResolvedValue(new Set(['set-up']));
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    await waitFor(() => expect(document.querySelectorAll('[data-icon="check"]')).toHaveLength(1));
    // Scoped to the module-list rows — the "Resume" CTA button above also
    // renders its own play icon, which a document-wide query would double-count.
    expect(document.querySelectorAll('.guideIconBadge [data-icon="play"]')).toHaveLength(1);
  });

  it('shows a Get started CTA targeting the first milestone, with no progress ring, at 0%', async () => {
    getCompletedMock.mockResolvedValue(new Set());
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    const cta = await screen.findByText('Get started');
    expect(cta.closest('button')).toHaveAttribute('data-journey-start', 'true');
    expect(cta.closest('button')).toHaveAttribute('data-milestone-url', milestones[0]!.url);
    expect(cta.closest('button')).toHaveAttribute('data-interaction-location', 'get_started_cta');
    expect(screen.queryByText('40%')).not.toBeInTheDocument();
  });

  it('shows a progress ring and a Resume CTA targeting the next incomplete milestone', async () => {
    getCompletedMock.mockResolvedValue(new Set(['set-up']));
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    const cta = await screen.findByText('Resume');
    expect(cta.closest('button')).toHaveAttribute('data-milestone-url', milestones[1]!.url);
    expect(cta.closest('button')).toHaveAttribute('data-interaction-location', 'resume_cta');
    expect(await screen.findByText('50%')).toBeInTheDocument();
  });

  it('hides the CTA once every milestone is completed', async () => {
    getCompletedMock.mockResolvedValue(new Set(['set-up', 'explore']));
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    // Both milestone rows plus the now-100%-complete progress ring each render
    // their own checkmark — the ring shows a checkmark rather than "100%" text.
    await waitFor(() => expect(document.querySelectorAll('[data-icon="check"]')).toHaveLength(3));
    expect(screen.queryByText('Get started')).not.toBeInTheDocument();
    expect(screen.queryByText('Resume')).not.toBeInTheDocument();
  });

  it("renders each milestone's description when the source provides one", async () => {
    getCompletedMock.mockResolvedValue(new Set());
    const withDescriptions: Milestone[] = [
      { ...milestones[0]!, description: 'Connect Grafana to your first data source.' },
      milestones[1]!,
    ];
    render(<LearningPathTableOfContents milestones={withDescriptions} baseUrl={baseUrl} />);

    expect(await screen.findByText('Connect Grafana to your first data source.')).toBeInTheDocument();
  });

  it('shows an "Earns X badge" preview when the path has a completion badge', async () => {
    getCompletedMock.mockResolvedValue(new Set());
    getBadgeForPathMock.mockReturnValue({ id: 'core-badge', title: 'Core Concepts', icon: 'grafana' });
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} pathId="core-grafana-concepts-lj" />);

    expect(getBadgeForPathMock).toHaveBeenCalledWith('core-grafana-concepts-lj');
    expect(await screen.findByText('Earns Core Concepts badge')).toBeInTheDocument();
  });

  it('omits the badge preview when no pathId is known or no badge is defined for it', async () => {
    getCompletedMock.mockResolvedValue(new Set());
    getBadgeForPathMock.mockReturnValue(undefined);
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    await waitFor(() => expect(getCompletedMock).toHaveBeenCalled());
    expect(getBadgeForPathMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Earns .* badge/)).not.toBeInTheDocument();
  });

  it('shows a hero card with the title, description, and module count when provided', async () => {
    getCompletedMock.mockResolvedValue(new Set());
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
    getCompletedMock.mockResolvedValue(new Set());
    getBadgeForPathMock.mockReturnValue(undefined);
    render(
      <LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} title="Connect your first data source" />
    );

    expect(screen.getByTestId('learning-paths-cover-hero')).toBeInTheDocument();
    expect(screen.getByText('Connect your first data source')).toBeInTheDocument();
  });

  it('omits the hero card entirely when there is no title, description, or badge', async () => {
    getCompletedMock.mockResolvedValue(new Set());
    getBadgeForPathMock.mockReturnValue(undefined);
    render(<LearningPathTableOfContents milestones={milestones} baseUrl={baseUrl} />);

    await waitFor(() => expect(getCompletedMock).toHaveBeenCalled());
    expect(screen.queryByTestId('learning-paths-cover-hero')).not.toBeInTheDocument();
  });

  it('shows the total estimated duration when every milestone has one authored', async () => {
    getCompletedMock.mockResolvedValue(new Set());
    const timedMilestones: Milestone[] = [
      { ...milestones[0]!, estimatedMinutes: 15 },
      { ...milestones[1]!, estimatedMinutes: 20 },
    ];
    render(<LearningPathTableOfContents milestones={timedMilestones} baseUrl={baseUrl} description="Summary" />);

    expect(await screen.findByText('35 min')).toBeInTheDocument();
  });

  it('formats the total as hours once it reaches 60 minutes, rounded', async () => {
    getCompletedMock.mockResolvedValue(new Set());
    const timedMilestones: Milestone[] = [
      { ...milestones[0]!, estimatedMinutes: 100 },
      { ...milestones[1]!, estimatedMinutes: 130 },
    ];
    render(<LearningPathTableOfContents milestones={timedMilestones} baseUrl={baseUrl} description="Summary" />);

    // 230 min = 3.83h, rounds to 4h.
    expect(await screen.findByText('~4 hr')).toBeInTheDocument();
  });

  it('omits the total duration from the hero when any milestone lacks an authored estimate', async () => {
    getCompletedMock.mockResolvedValue(new Set());
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
      getCompletedMock.mockResolvedValue(new Set());
      render(<LearningPathTableOfContents milestones={threeMilestones} baseUrl={baseUrl} />);

      await waitFor(() => expect(screen.getAllByText('Locked')).toHaveLength(2));
      expect(document.querySelectorAll('.guideIconBadge [data-icon="lock"]')).toHaveLength(2);
    });

    it('unlocks the next module once the previous one completes, keeping the rest locked', async () => {
      getCompletedMock.mockResolvedValue(new Set(['one']));
      render(<LearningPathTableOfContents milestones={threeMilestones} baseUrl={baseUrl} />);

      await waitFor(() => expect(screen.getAllByText('Locked')).toHaveLength(1));
      expect(document.querySelectorAll('.guideIconBadge [data-icon="play"]')).toHaveLength(1);
    });

    it('treats a module completed out of order as done, not locked', async () => {
      // "Three" completed while "One"/"Two" aren't — the cursor still sits at
      // "One", but "Three" must not be marked both completed and locked.
      getCompletedMock.mockResolvedValue(new Set(['three']));
      render(<LearningPathTableOfContents milestones={threeMilestones} baseUrl={baseUrl} />);

      await waitFor(() => expect(document.querySelectorAll('.guideIconBadge [data-icon="check"]')).toHaveLength(1));
      // Only "Two" is locked; "Three" is done and "One" is the current cursor.
      expect(screen.getAllByText('Locked')).toHaveLength(1);
      expect(document.querySelectorAll('.guideIconBadge [data-icon="lock"]')).toHaveLength(1);
    });
  });
});
