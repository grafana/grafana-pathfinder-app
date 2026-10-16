import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { testIds } from '../../constants/testIds';
import type { HubResume, HubStats } from '../../learning-paths';
import { SidebarHub } from './SidebarHub';
import type { HubGuide } from './GuideRow';

jest.mock('@grafana/i18n', () => ({
  t: jest.fn((key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{-?\s*(\w+)\s*\}\}/g, (_match, name: string) => String(values?.[name] ?? ''))
  ),
}));

const guide = (title: string, extra: Partial<HubGuide> = {}): HubGuide => ({
  key: title,
  title,
  summary: `About ${title}`,
  topic: 'dashboards',
  kind: 'guide',
  effort: 'About 8 min',
  onLaunch: jest.fn(),
  ...extra,
});

const resume: HubResume = {
  pathId: 'getting-started',
  pathTitle: 'Getting started',
  guideTitle: 'Build a dashboard',
  guideUrl: 'bundled:build-a-dashboard',
  percent: 40,
  moduleNumber: 2,
  moduleCount: 5,
};

const stats: HubStats = { assignments: 2, inProgress: 1, completed: 7 };

function renderHub(props: Partial<React.ComponentProps<typeof SidebarHub>> = {}) {
  const onOpenMyLearning = jest.fn();
  const onResume = jest.fn();
  render(
    <SidebarHub
      userName="Ada"
      guides={[guide('Featured guide'), guide('Second'), guide('Third'), guide('Fourth'), guide('Fifth')]}
      resume={resume}
      stats={stats}
      isLoadingGuides={false}
      isLoadingLearning={false}
      recommendationsError={null}
      onOpenMyLearning={onOpenMyLearning}
      onResume={onResume}
      {...props}
    />
  );
  return { onOpenMyLearning, onResume };
}

describe('SidebarHub', () => {
  it('greets the user by name and falls back without one', () => {
    const { unmount } = render(
      <SidebarHub
        userName="Ada"
        guides={[]}
        resume={null}
        stats={stats}
        isLoadingGuides={false}
        isLoadingLearning={false}
        recommendationsError={null}
        onOpenMyLearning={jest.fn()}
        onResume={jest.fn()}
      />
    );
    expect(screen.getByRole('heading', { name: 'Welcome back, Ada' })).toBeInTheDocument();
    unmount();

    renderHub({ userName: undefined });
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
  });

  it('opens My learning from the header button', () => {
    const { onOpenMyLearning } = renderHub();

    fireEvent.click(screen.getByTestId(testIds.sidebarHub.myLearning));

    expect(onOpenMyLearning).toHaveBeenCalledWith('header');
  });

  it('leads with the featured guide, then resume, tiles and three more rows', () => {
    renderHub();

    const container = screen.getByTestId(testIds.sidebarHub.container);
    const order = [
      testIds.sidebarHub.featured,
      testIds.sidebarHub.resume,
      testIds.sidebarHub.tiles,
      testIds.sidebarHub.moreList,
    ].map((id) => within(container).getByTestId(id));
    order.slice(1).forEach((node, i) => {
      expect(order[i]!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    expect(screen.getByText('Recommended for you')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Featured guide' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'More recommended' })).toBeInTheDocument();
    expect(within(screen.getByTestId(testIds.sidebarHub.moreList)).getAllByRole('button')).toHaveLength(3);
    expect(screen.queryByText('Fifth')).not.toBeInTheDocument();
  });

  it('puts resume on top when there is no featured guide', () => {
    renderHub({ guides: [] });

    const container = screen.getByTestId(testIds.sidebarHub.container);
    const resumeCard = within(container).getByTestId(testIds.sidebarHub.resume);

    expect(screen.queryByTestId(testIds.sidebarHub.featured)).not.toBeInTheDocument();
    expect(screen.queryByTestId(testIds.sidebarHub.moreList)).not.toBeInTheDocument();
    expect(container.querySelector('header')!.nextElementSibling).toBe(resumeCard);
  });

  it('shows the topic chip and launches the featured guide', () => {
    const featured = guide('Featured guide');
    renderHub({ guides: [featured] });

    expect(screen.getByText('Dashboards')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start: Featured guide' }));

    expect(featured.onLaunch).toHaveBeenCalledTimes(1);
  });

  it('offers Read for docs and Resume for a started guide', () => {
    renderHub({ guides: [guide('Docs page', { kind: 'docs' })], resume: null });
    expect(screen.getByRole('button', { name: 'Read: Docs page' })).toBeInTheDocument();
  });

  it('offers Resume on a featured guide that is already started', () => {
    renderHub({ guides: [guide('Started', { progress: 30 })], resume: null });
    expect(screen.getByRole('button', { name: 'Resume: Started' })).toBeInTheDocument();
  });

  it('launches a more recommended row', () => {
    const second = guide('Second');
    renderHub({ guides: [guide('Featured guide'), second] });

    fireEvent.click(screen.getByTestId(testIds.sidebarHub.row(0)));

    expect(second.onLaunch).toHaveBeenCalledTimes(1);
  });

  it('describes the resume card and resumes from its button', () => {
    const { onResume } = renderHub({ resume: { ...resume, trackLabel: 'Operations' } });

    expect(screen.getByText('Continue · Getting started')).toBeInTheDocument();
    expect(screen.getByText('Module 2 of 5 · Operations')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume: Build a dashboard' }));

    expect(onResume).toHaveBeenCalledWith(expect.objectContaining({ pathId: 'getting-started' }));
  });

  it('sends every tile to My learning', () => {
    const { onOpenMyLearning } = renderHub();

    fireEvent.click(screen.getByTestId(testIds.sidebarHub.tile('assignments')));
    fireEvent.click(screen.getByTestId(testIds.sidebarHub.tile('in-progress')));
    fireEvent.click(screen.getByTestId(testIds.sidebarHub.tile('completed')));

    expect(onOpenMyLearning.mock.calls).toEqual([['assignments'], ['in-progress'], ['completed']]);
    const tiles = screen.getByTestId(testIds.sidebarHub.tiles);
    expect(within(tiles).getByText('2')).toBeInTheDocument();
    expect(within(tiles).getByText('7')).toBeInTheDocument();
  });

  it('captions the assignments tile with the next due date', () => {
    renderHub({ stats: { ...stats, nextDue: { tone: 'later', days: 3, dueAt: '2026-10-19T00:00:00Z' } } });

    expect(screen.getByText('Due in 3 days')).toBeInTheDocument();
  });

  it('shows skeletons while loading instead of cards', () => {
    renderHub({ isLoadingGuides: true, isLoadingLearning: true });

    expect(screen.getAllByTestId(testIds.sidebarHub.loading)).toHaveLength(2);
    expect(screen.queryByTestId(testIds.sidebarHub.featured)).not.toBeInTheDocument();
    expect(screen.queryByTestId(testIds.sidebarHub.resume)).not.toBeInTheDocument();
    expect(screen.queryByTestId(testIds.sidebarHub.tiles)).not.toBeInTheDocument();
  });

  it('shows the recommendations error and still renders learning progress', () => {
    renderHub({ guides: [], recommendationsError: 'Service down' });

    expect(screen.getByTestId(testIds.contextPanel.errorAlert)).toHaveTextContent('Service down');
    expect(screen.getByTestId(testIds.sidebarHub.tiles)).toBeInTheDocument();
  });
});
