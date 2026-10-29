import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { testIds } from '../../constants/testIds';
import type { HubResume, HubStats } from '../../learning-paths';
import { SidebarHub } from './SidebarHub';
import type { HubExpansion } from './GuideDetails';
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

function renderHub(props: Partial<React.ComponentProps<typeof SidebarHub>> = {}, onClickAbove?: () => void) {
  const onOpenMyLearning = jest.fn();
  const onResume = jest.fn();
  render(
    <div onClick={onClickAbove}>
      <SidebarHub
        userName="Ada"
        guides={[guide('Featured guide'), guide('Second'), guide('Third'), guide('Fourth'), guide('Fifth')]}
        resume={resume}
        stats={stats}
        customGuides={[]}
        isLoadingCustomGuides={false}
        isLoadingGuides={false}
        isLoadingLearning={false}
        recommendationsError={null}
        onOpenMyLearning={onOpenMyLearning}
        onResume={onResume}
        {...props}
      />
    </div>
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
        customGuides={[]}
        isLoadingCustomGuides={false}
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

  describe('card expansion', () => {
    const expansion = (extra: Partial<HubExpansion> = {}): HubExpansion => ({
      expanded: false,
      hasDetails: true,
      hasModules: true,
      modules: [{ id: 'm1', number: 1, title: 'First module', url: 'bundled:m1', isActive: false }],
      isResolving: false,
      onToggle: jest.fn(),
      onOpenModule: jest.fn(),
      ...extra,
    });

    it('toggles a More recommended row without launching it', () => {
      const withDetails = expansion();
      const second = guide('Second', { expansion: withDetails });
      renderHub({ guides: [guide('Featured guide'), second] });

      fireEvent.click(screen.getByRole('button', { name: 'Show milestones' }));

      expect(withDetails.onToggle).toHaveBeenCalledTimes(1);
      expect(second.onLaunch).not.toHaveBeenCalled();
    });

    it('shows the summary, then the modules, of an expanded row and opens a module through the hub', async () => {
      const open = expansion({ expanded: true });
      renderHub({ guides: [guide('Featured guide'), guide('Second', { summary: 'About Second', expansion: open })] });

      const details = screen.getByTestId(testIds.sidebarHub.rowDetails(0));
      expect(screen.getByRole('button', { name: 'Hide milestones' })).toHaveAttribute('aria-expanded', 'true');
      expect(within(details).getByText('About Second')).toBeInTheDocument();
      expect(within(details).getByRole('heading', { name: 'Milestones' })).toBeInTheDocument();

      fireEvent.click(screen.getByTestId(testIds.sidebarHub.rowModule(0, 0)));
      await waitFor(() => expect(open.onOpenModule).toHaveBeenCalledWith(open.modules[0]));
    });

    it('offers Read more on a row that only has a summary and nothing on one with neither', () => {
      renderHub({
        guides: [
          guide('Featured guide'),
          guide('Summary only', { expansion: expansion({ hasDetails: false, hasModules: false, modules: [] }) }),
          guide('Bare', { summary: undefined, expansion: expansion({ hasDetails: false, hasModules: false }) }),
        ],
      });

      expect(screen.getAllByRole('button', { name: 'Read more' })).toHaveLength(1);
      expect(screen.getByTestId(testIds.sidebarHub.row(1))).not.toHaveTextContent('Read more');
    });

    it('keeps the featured action after the expanded details and the lists compact', () => {
      const open = expansion({
        expanded: true,
        prerequisites: [{ id: 'p1', label: 'A data source' }],
        modules: [
          {
            id: 'm1',
            number: 1,
            title: 'First module',
            description: 'A long module description',
            url: 'bundled:m1',
            isActive: false,
          },
        ],
      });
      renderHub({ guides: [guide('Featured guide', { expansion: open })] });

      const details = screen.getByTestId(testIds.sidebarHub.featuredDetails);
      expect(
        details.compareDocumentPosition(screen.getByTestId(testIds.sidebarHub.featuredAction)) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(within(details).getByText('A data source')).toBeInTheDocument();
      expect(screen.queryByTestId('data-testid Alert info')).not.toBeInTheDocument();
      expect(screen.queryByText('A long module description')).not.toBeInTheDocument();
    });

    it('keeps module descriptions and the alert out of an expanded row too', () => {
      const open = expansion({
        expanded: true,
        prerequisites: [{ id: 'p1', label: 'A data source' }],
        modules: [
          {
            id: 'm1',
            number: 1,
            title: 'First module',
            description: 'A long module description',
            url: 'bundled:m1',
            isActive: false,
          },
        ],
      });
      renderHub({ guides: [guide('Featured guide'), guide('Second', { expansion: open })] });

      expect(
        within(screen.getByTestId(testIds.sidebarHub.rowDetails(0))).getByText('A data source')
      ).toBeInTheDocument();
      expect(screen.queryByTestId('data-testid Alert info')).not.toBeInTheDocument();
      expect(screen.queryByText('A long module description')).not.toBeInTheDocument();
    });

    it('shows a loading skeleton while the modules resolve', () => {
      renderHub({
        guides: [
          guide('Featured guide'),
          guide('Second', { expansion: expansion({ expanded: true, modules: [], isResolving: true }) }),
        ],
      });

      expect(screen.getByTestId(testIds.sidebarHub.rowDetailsLoading(0))).toBeInTheDocument();
    });

    it('keeps clicks inside the details of an expanded row from reaching anything above them', () => {
      const clickedAbove = jest.fn();
      renderHub(
        {
          guides: [
            guide('Featured guide'),
            guide('Second', {
              expansion: expansion({ expanded: true, prerequisites: [{ id: 'p1', label: 'A data source' }] }),
            }),
          ],
        },
        clickedAbove
      );

      const details = screen.getByTestId(testIds.sidebarHub.rowDetails(0));
      fireEvent.click(within(details).getByText('About Second'));
      fireEvent.click(within(details).getByText('A data source'));
      expect(clickedAbove).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId(testIds.sidebarHub.rowToggle(0)));
      expect(clickedAbove).toHaveBeenCalledTimes(1);
    });

    it('expands the featured card with its modules and opens one through the hub', async () => {
      const open = expansion({ expanded: true });
      renderHub({ guides: [guide('Featured guide', { expansion: open })] });

      expect(screen.getByTestId(testIds.sidebarHub.featuredToggle)).toHaveAttribute('aria-expanded', 'true');
      fireEvent.click(screen.getByTestId(testIds.sidebarHub.featuredModule(0)));
      await waitFor(() => expect(open.onOpenModule).toHaveBeenCalledWith(open.modules[0]));
    });
  });

  describe('other documentation', () => {
    const many = ['Featured guide', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh'].map((title) =>
      guide(title)
    );

    it('stays out of the way until there are more than four recommendations', () => {
      renderHub({ guides: many.slice(0, 4) });

      expect(screen.queryByTestId(testIds.sidebarHub.otherDocs)).not.toBeInTheDocument();
    });

    it('collects the rest under a collapsed toggle with their count, below More recommended', () => {
      renderHub({ guides: many });

      const section = screen.getByRole('region', { name: 'Other documentation' });
      const toggle = within(section).getByTestId(testIds.sidebarHub.otherDocsToggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(within(section).getByText('3 items')).toBeInTheDocument();
      expect(screen.queryByTestId(testIds.sidebarHub.otherDocsList)).not.toBeInTheDocument();
      expect(screen.queryByText('Fifth')).not.toBeInTheDocument();
      expect(
        screen.getByTestId(testIds.sidebarHub.moreList).compareDocumentPosition(section) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it('comes after the Custom guides section', () => {
      renderHub({
        guides: many,
        customGuides: [guide('Org guide')],
      });

      const custom = screen.getByTestId(testIds.sidebarHub.customGuides);
      expect(
        custom.compareDocumentPosition(screen.getByTestId(testIds.sidebarHub.otherDocs)) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it('expands to the remaining titles in order and launches the one clicked', async () => {
      renderHub({ guides: many });

      fireEvent.click(screen.getByTestId(testIds.sidebarHub.otherDocsToggle));
      const list = screen.getByTestId(testIds.sidebarHub.otherDocsList);
      expect(screen.getByTestId(testIds.sidebarHub.otherDocsToggle)).toHaveAttribute('aria-expanded', 'true');
      expect(
        within(list)
          .getAllByRole('button')
          .map((button) => button.textContent)
      ).toEqual(['Fifth', 'Sixth', 'Seventh']);

      fireEvent.click(screen.getByTestId(testIds.sidebarHub.otherDoc(1)));
      await waitFor(() => expect(many[5]!.onLaunch).toHaveBeenCalledTimes(1));
      expect(many[4]!.onLaunch).not.toHaveBeenCalled();
    });

    it('collapses again from the toggle', () => {
      renderHub({ guides: many });

      fireEvent.click(screen.getByTestId(testIds.sidebarHub.otherDocsToggle));
      fireEvent.click(screen.getByTestId(testIds.sidebarHub.otherDocsToggle));

      expect(screen.queryByTestId(testIds.sidebarHub.otherDocsList)).not.toBeInTheDocument();
    });

    it('is hidden while recommendations reload', () => {
      renderHub({ guides: many, isLoadingGuides: true });

      expect(screen.queryByTestId(testIds.sidebarHub.otherDocs)).not.toBeInTheDocument();
    });
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
    fireEvent.click(screen.getByRole('button', { name: 'Start guide' }));

    expect(featured.onLaunch).toHaveBeenCalledTimes(1);
  });

  it('offers Read for docs and Resume for a started guide', () => {
    renderHub({ guides: [guide('Docs page', { kind: 'docs' })], resume: null });
    expect(screen.getByRole('button', { name: 'Read' })).toBeInTheDocument();
  });

  it('offers Resume on a featured guide that is already started', () => {
    renderHub({ guides: [guide('Started', { progress: 30 })], resume: null });
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('launches a more recommended row', () => {
    const second = guide('Second');
    renderHub({ guides: [guide('Featured guide'), second] });

    fireEvent.click(within(screen.getByTestId(testIds.sidebarHub.row(0))).getByRole('button'));

    expect(second.onLaunch).toHaveBeenCalledTimes(1);
  });

  it('launches a more recommended row once from its play control', () => {
    const second = guide('Second');
    const clickedAbove = jest.fn();
    renderHub({ guides: [guide('Featured guide'), second] }, clickedAbove);

    fireEvent.click(screen.getByTestId(testIds.sidebarHub.rowPlay(testIds.sidebarHub.row(0))));

    expect(second.onLaunch).toHaveBeenCalledTimes(1);
    expect(clickedAbove).not.toHaveBeenCalled();
  });

  it('keeps the play control out of the accessibility tree and the tab order', () => {
    renderHub({ guides: [guide('Featured guide'), guide('Second')] });

    const play = screen.getByTestId(testIds.sidebarHub.rowPlay(testIds.sidebarHub.row(0)));
    expect(play).toHaveAttribute('aria-hidden', 'true');
    expect(play).toHaveAttribute('tabindex', '-1');
    expect(within(screen.getByTestId(testIds.sidebarHub.row(0))).getAllByRole('button')).toHaveLength(1);
  });

  it('describes the resume card and resumes from its button', () => {
    const { onResume } = renderHub({ resume: { ...resume, trackLabel: 'Operations' } });

    const resumeCard = screen.getByRole('region', { name: 'Continue learning' });
    expect(resumeCard).toBe(screen.getByTestId(testIds.sidebarHub.resume));
    expect(resumeCard).toHaveTextContent('Getting started · Module 2 of 5 · Operations');
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

  it.each([
    [{ tone: 'today', days: 0, dueAt: '2026-10-19T00:00:00Z' }, 'Due today'],
    [{ tone: 'later', days: 1, dueAt: '2026-10-20T00:00:00Z' }, 'Due tomorrow'],
    [{ tone: 'later', days: 5, dueAt: '2026-10-24T00:00:00Z' }, 'Due in 5 days'],
    [{ tone: 'overdue', days: -2, dueAt: '2026-10-17T00:00:00Z' }, /^Due .*2026/],
  ] as const)('captions the assignments tile for %j', (nextDue, caption) => {
    renderHub({ stats: { ...stats, nextDue } });

    expect(within(screen.getByTestId(testIds.sidebarHub.tile('assignments'))).getByText(caption)).toBeInTheDocument();
  });

  it('shows skeletons while loading instead of cards', () => {
    renderHub({ isLoadingGuides: true, isLoadingLearning: true });

    expect(screen.getAllByTestId(testIds.sidebarHub.loading)).toHaveLength(2);
    expect(screen.queryByTestId(testIds.sidebarHub.featured)).not.toBeInTheDocument();
    expect(screen.queryByTestId(testIds.sidebarHub.resume)).not.toBeInTheDocument();
    expect(screen.queryByTestId(testIds.sidebarHub.tiles)).not.toBeInTheDocument();
  });

  it('hides the more recommended rows while recommendations reload', () => {
    renderHub({ isLoadingGuides: true });

    expect(screen.queryByTestId(testIds.sidebarHub.featured)).not.toBeInTheDocument();
    expect(screen.queryByTestId(testIds.sidebarHub.moreList)).not.toBeInTheDocument();
    expect(screen.queryByText('More recommended')).not.toBeInTheDocument();
  });

  it('shows the recommendations error and still renders learning progress', () => {
    renderHub({ guides: [], recommendationsError: 'Service down' });

    expect(screen.getByTestId(testIds.contextPanel.errorAlert)).toHaveTextContent('Service down');
    expect(screen.getByTestId(testIds.sidebarHub.tiles)).toBeInTheDocument();
  });

  describe('custom guides', () => {
    const customGuides = ['One', 'Two', 'Three', 'Four', 'Five'].map((name) =>
      guide(`Custom ${name}`, { organization: true, summary: undefined })
    );

    it('shows a short list that expands to the full list and collapses again', () => {
      renderHub({ customGuides });

      const section = screen.getByRole('region', { name: 'Custom guides' });
      expect(within(section).getByText('5 items')).toBeInTheDocument();
      expect(within(section).getAllByRole('button', { name: /^Start: Custom/ })).toHaveLength(3);
      expect(within(section).getAllByText('Your organization')).toHaveLength(3);

      fireEvent.click(within(section).getByRole('button', { name: 'Show all 5' }));
      expect(within(section).getAllByRole('button', { name: /^Start: Custom/ })).toHaveLength(5);
      expect(within(section).getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');

      fireEvent.click(within(section).getByRole('button', { name: 'Show less' }));
      expect(within(section).getAllByRole('button', { name: /^Start: Custom/ })).toHaveLength(3);
    });

    it('has no expand control when the list already fits', () => {
      renderHub({ customGuides: customGuides.slice(0, 3) });

      expect(screen.queryByTestId(testIds.sidebarHub.customGuidesToggle)).not.toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /^Start: Custom/ })).toHaveLength(3);
    });

    it('launches a custom guide from its row', () => {
      renderHub({ customGuides });

      fireEvent.click(within(screen.getByTestId(testIds.sidebarHub.customRow(1))).getByRole('button'));

      expect(customGuides[1]!.onLaunch).toHaveBeenCalledTimes(1);
    });

    it('launches a custom guide once from its play control', () => {
      const custom = guide('Custom play', { organization: true, summary: undefined });
      renderHub({ customGuides: [custom] });

      fireEvent.click(screen.getByTestId(testIds.sidebarHub.rowPlay(testIds.sidebarHub.customRow(0))));

      expect(custom.onLaunch).toHaveBeenCalledTimes(1);
    });

    it('renders nothing when there are none and a skeleton while loading', () => {
      const { unmount } = render(
        <SidebarHub
          userName="Ada"
          guides={[]}
          resume={null}
          stats={stats}
          customGuides={[]}
          isLoadingCustomGuides={false}
          isLoadingGuides={false}
          isLoadingLearning={false}
          recommendationsError={null}
          onOpenMyLearning={jest.fn()}
          onResume={jest.fn()}
        />
      );
      expect(screen.queryByTestId(testIds.sidebarHub.customGuides)).not.toBeInTheDocument();
      unmount();

      renderHub({ customGuides, isLoadingCustomGuides: true });
      expect(screen.queryByTestId(testIds.sidebarHub.customGuides)).not.toBeInTheDocument();
      expect(screen.getByTestId(testIds.sidebarHub.customGuidesLoading)).toBeInTheDocument();
    });
  });
});
