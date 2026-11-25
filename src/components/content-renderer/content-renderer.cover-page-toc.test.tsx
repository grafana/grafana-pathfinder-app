import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createTheme } from '@grafana/data';

import type { RawContent } from '../../types/content.types';
import type { LearningProgress } from '../../types/learning-paths.types';
import { testIds } from '../../constants/testIds';
import { StorageEvents } from '../../lib/event-names';
import { learningProgressStorage } from '../../lib/user-storage';
import { ContentRenderer } from './content-renderer';
import { docsContentHtml, journeyContentHtml } from '../../styles/content-html.styles';
import { UNTRACKED_COMPLETION } from '../../test-utils/content-renderer-completion';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key])) : fallback,
}));

jest.mock('@grafana/ui', () => ({
  ...jest.requireActual('@grafana/ui'),
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
  TextLink: ({
    children,
    inline: _inline,
    variant: _variant,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { inline?: boolean; variant?: string }) => (
    <a {...props}>{children}</a>
  ),
}));

const baseUrl = 'https://grafana.com/docs/learning-paths/demo';
const milestones = [{ number: 1, title: 'Set up', duration: '', url: `${baseUrl}/set-up/`, isActive: false }];

function makeContent(overrides: Partial<RawContent> = {}): RawContent {
  return {
    content: '<p>Body</p>',
    type: 'learning-journey',
    url: baseUrl,
    lastFetched: '2026-07-31T00:00:00.000Z',
    metadata: {
      title: 'Demo',
      learningJourney: {
        currentMilestone: 0,
        totalMilestones: milestones.length,
        milestones,
        baseUrl,
      },
    },
    ...overrides,
  };
}

describe('ContentRenderer cover-page table of contents', () => {
  it('applies the heading scale and reading gaps inside a lesson article', () => {
    const cover = makeContent();
    const theme = createTheme();
    const content = makeContent({
      content: `
        <div class="orange-outline-list"><div class="icon-heading"><h2>Objective</h2></div></div>
        <p>First paragraph</p>
        <p>Second paragraph</p>
        <div class="markdown-block"><p>Third paragraph</p></div>
        <p>Fourth paragraph</p>
        <div class="orange-outline-list"><div class="icon-heading"><h2>Introduction</h2></div></div>
        <p>List lead-in</p>
        <ul><li>First bullet</li><li>Second bullet</li></ul>
        <h2>More detail</h2>
        <h3>Example</h3>
        <p>First subsection body</p>
        <h3>Second example</h3>
        <p>Second subsection body</p>
        <div class="markdown-block"><h3>Wrapped example</h3><p>Wrapped subsection body</p></div>
        <div class="html-block"><h2>HTML section</h2><p>HTML section body</p></div>
        <h2>Markdown group</h2>
        <div class="markdown-block"><h3>First in Markdown group</h3><p>Subsection body</p></div>
        <div class="markdown-block"><p>Previous section body</p><h2>HTML group</h2></div>
        <div class="html-block"><h3>First in HTML group</h3><p>Subsection body</p></div>
        <h1>Summary</h1>
      `,
      metadata: {
        ...cover.metadata,
        learningJourney: { ...cover.metadata.learningJourney!, currentMilestone: 1 },
      },
    });

    render(
      <ContentRenderer className={journeyContentHtml(theme)} completion={UNTRACKED_COMPLETION} content={content} />
    );

    const objective = screen.getByRole('heading', { name: 'Objective' });
    const introduction = screen.getByRole('heading', { name: 'Introduction' });
    const moreDetail = screen.getByRole('heading', { name: 'More detail', level: 2 });
    const summary = screen.getByRole('heading', { name: 'Summary', level: 1 });
    const example = screen.getByRole('heading', { name: 'Example', level: 3 });
    const secondExample = screen.getByRole('heading', { name: 'Second example', level: 3 });
    const wrappedExample = screen.getByRole('heading', { name: 'Wrapped example', level: 3 });
    expect(getComputedStyle(summary).fontSize).toBe(theme.typography.xxl.fontSize);
    expect(getComputedStyle(objective).fontSize).toBe(theme.typography.xl.fontSize);
    expect(getComputedStyle(example).fontSize).toBe(theme.typography.lg.fontSize);
    expect(getComputedStyle(example).marginTop).toBe(theme.spacing(3));
    expect(getComputedStyle(secondExample).marginTop).toBe(theme.spacing(5.5));
    expect(getComputedStyle(secondExample).marginBottom).toBe(theme.spacing(1.5));
    expect(getComputedStyle(wrappedExample).marginTop).toBe(theme.spacing(5.5));
    expect(getComputedStyle(screen.getByRole('heading', { name: 'HTML section' })).marginTop).toBe(theme.spacing(5.5));
    expect(getComputedStyle(screen.getByRole('heading', { name: 'First in Markdown group' })).marginTop).toBe(
      theme.spacing(3)
    );
    expect(getComputedStyle(screen.getByRole('heading', { name: 'First in HTML group' })).marginTop).toBe(
      theme.spacing(3)
    );
    expect(getComputedStyle(objective).marginBottom).toBe(theme.spacing(1.5));
    expect(getComputedStyle(screen.getByText('First paragraph')).marginBottom).toBe(theme.spacing(2));
    expect(getComputedStyle(screen.getByText('Second paragraph')).marginBottom).toBe(theme.spacing(2));
    expect(getComputedStyle(screen.getByText('Third paragraph')).marginBottom).toBe(theme.spacing(2));
    expect(getComputedStyle(screen.getByText('List lead-in')).marginBottom).toBe(theme.spacing(1));
    expect(getComputedStyle(introduction).marginTop).toBe(theme.spacing(5.5));
    expect(getComputedStyle(moreDetail).marginTop).toBe(theme.spacing(5.5));
    expect(getComputedStyle(screen.getByText('First bullet')).marginBottom).toBe(theme.spacing(1));
  });

  it.each([
    ['tip', 'success'],
    ['note', 'info'],
    ['warning', 'warning'],
    ['caution', 'warning'],
  ])('renders a %s admonition with an icon and preserves its content', (kind, tone) => {
    const cover = makeContent();
    const content = makeContent({
      content: `
        <div class="admonition admonition-${kind}" id="lesson-summary">
          <blockquote><div class="admonition-title">Lesson summary</div><p>Read the <strong>summary</strong>.</p></blockquote>
        </div>
        <blockquote><p>Regular quotation</p></blockquote>
      `,
      metadata: {
        ...cover.metadata,
        learningJourney: { ...cover.metadata.learningJourney!, currentMilestone: 1 },
      },
    });

    render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={content} />);

    const admonition = screen.getByText('Lesson summary').closest('.admonition');
    expect(admonition).toHaveAttribute('id', 'lesson-summary');
    expect(admonition).toHaveAttribute('data-guide-admonition', tone);
    expect(admonition?.querySelector('.guide-admonition-icon')).toHaveAttribute('aria-hidden', 'true');
    expect(admonition).toContainElement(screen.getByText('summary', { selector: 'strong' }));
    expect(screen.getByText('Regular quotation').closest('[data-guide-admonition]')).toBeNull();
  });

  it.each([
    { surface: 'compact cover', currentMilestone: 0, fullPageOverview: false, border: 'solid' },
    { surface: 'full-page cover', currentMilestone: 0, fullPageOverview: true, border: 'solid' },
    { surface: 'lesson', currentMilestone: 1, fullPageOverview: false, border: '' },
  ])('scopes the orange heading border to the cover ($surface)', ({ currentMilestone, fullPageOverview, border }) => {
    const cover = makeContent();
    const content = makeContent({
      content: '<div class="orange-outline-list"><div class="icon-heading"><h2>Objective</h2></div></div>',
      metadata: {
        ...cover.metadata,
        learningJourney: { ...cover.metadata.learningJourney!, currentMilestone },
      },
    });

    render(
      <ContentRenderer
        className={fullPageOverview ? undefined : journeyContentHtml(createTheme())}
        fullPageOverview={fullPageOverview}
        completion={UNTRACKED_COMPLETION}
        content={content}
      />
    );

    if (fullPageOverview) {
      fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
    }

    const heading = screen.getByRole('heading', { name: 'Objective', level: fullPageOverview ? 3 : 2 });
    expect(getComputedStyle(heading.closest('.orange-outline-list')!).borderTopStyle).toBe(border);
  });

  it('renders on a learning journey cover with milestones', () => {
    render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={makeContent()} />);

    expect(screen.getByTestId(testIds.learningPaths.tableOfContents)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'About this path' })).not.toBeInTheDocument();
  });

  it('introduces the authored body after the full-page module list', () => {
    const content = makeContent({
      content: '<div><h2 id="expect">What to expect</h2><p>Body</p><h3>More detail</h3></div>',
    });
    render(<ContentRenderer fullPageOverview completion={UNTRACKED_COMPLETION} content={content} />);

    const toc = screen.getByTestId(testIds.learningPaths.tableOfContents);
    expect(screen.getByRole('tab', { name: 'Outline' })).toHaveAttribute('aria-selected', 'true');
    expect(toc).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'About this path' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
    const heading = screen.getByRole('heading', { level: 2, name: 'About this path' });
    expect(toc).not.toBeVisible();
    expect(heading.compareDocumentPosition(screen.getByText('Body')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'What to expect' })).toHaveAttribute('id', 'expect');
    expect(screen.getByRole('heading', { level: 4, name: 'More detail' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Outline' }));
    expect(toc).toBeVisible();
  });

  it('disables Details when a path has an empty cover body', () => {
    const content = makeContent({
      isNativeJson: true,
      content: JSON.stringify({
        id: 'demo',
        title: 'Demo',
        blocks: [{ type: 'html', content: '<div><p>&nbsp;</p></div>' }],
      }),
    });

    render(<ContentRenderer fullPageOverview completion={UNTRACKED_COMPLETION} content={content} />);

    const details = screen.getByRole('tab', { name: 'Details' });
    expect(details).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(details);
    expect(screen.getByRole('tab', { name: 'Outline' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId(testIds.learningPaths.tableOfContents)).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'About this path' })).not.toBeInTheDocument();
  });

  it('lists badge icons after the authored body and updates their shared details', async () => {
    const learningProgress: LearningProgress = {
      completedGuides: [],
      earnedBadges: [],
      streakDays: 0,
      lastActivityDate: '',
      pendingCelebrations: [],
    };
    const getProgress = jest.spyOn(learningProgressStorage, 'get').mockResolvedValue(learningProgress);
    try {
      const content = makeContent({
        content: '<p>Authored body</p>',
        metadata: { ...makeContent().metadata, packageManifest: { id: 'drilldown-metrics', type: 'path' } },
      });
      render(<ContentRenderer fullPageOverview completion={UNTRACKED_COMPLETION} content={content} />);

      fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
      const heading = screen.getByRole('heading', { level: 3, name: 'Badges you can earn' });
      const body = screen.getByText('Authored body');
      const badge = screen.getByRole('button', { name: 'Metric Miner' });
      expect(body.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(heading.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(badge).not.toHaveTextContent('Metric Miner');
      fireEvent.click(badge);
      const details = screen.getByTestId(testIds.learningPaths.badgesModal);
      expect(await within(details).findByText('🔒 Locked')).toBeInTheDocument();
      expect(within(details).getByText('Requirement')).toBeInTheDocument();

      getProgress.mockResolvedValue({
        ...learningProgress,
        earnedBadges: [{ id: 'metric-miner', earnedAt: Date.UTC(2026, 10, 11, 12) }],
      });
      act(() => window.dispatchEvent(new CustomEvent(StorageEvents.LearningProgressUpdated)));
      expect(await within(details).findByText('✨ Unlocked')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId(testIds.learningPaths.badgesModalClose));
      expect(screen.queryByTestId(testIds.learningPaths.badgesModal)).not.toBeInTheDocument();
    } finally {
      getProgress.mockRestore();
    }
  });

  it('shows a badge section below the module list when there is no authored body', async () => {
    const content = makeContent({
      content: '<div></div>',
      metadata: {
        ...makeContent().metadata,
        packageManifest: { id: 'drilldown-metrics', type: 'path', estimatedMinutes: 15 },
      },
    });
    await act(async () => {
      render(<ContentRenderer fullPageOverview completion={UNTRACKED_COMPLETION} content={content} />);
    });

    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-disabled', 'true');
    const modules = screen.getByRole('tabpanel', { name: 'Outline' });
    expect(within(modules).getByRole('heading', { level: 2, name: 'Badges you can earn' })).toBeVisible();
    expect(within(screen.getByTestId(testIds.learningPaths.coverHero)).getByText('15 min')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'About this path' })).not.toBeInTheDocument();
  });

  it('renders path prerequisites before the cover actions', () => {
    const content = makeContent({
      isNativeJson: true,
      metadata: {
        ...makeContent().metadata,
        packageManifest: {
          id: 'demo-path',
          type: 'path',
          prerequisites: [{ id: 'mysql', label: '<b>Literal</b> & **plain text**' }],
        },
      },
    });

    const { container } = render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={content} />);

    const prerequisite = screen.getByText('<b>Literal</b> & **plain text**');
    const tableOfContents = screen.getByTestId(testIds.learningPaths.tableOfContents);
    expect(prerequisite.tagName).toBe('LI');
    expect(container.querySelector('li b')).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1, name: 'Demo' })).toHaveLength(1);
    expect(screen.getByTestId(testIds.learningPaths.coverHero)).toHaveTextContent('Demo');
    expect(prerequisite.compareDocumentPosition(tableOfContents) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders Markdown prerequisite links on the path cover as secure new-tab links', () => {
    const content = makeContent({
      metadata: {
        ...makeContent().metadata,
        packageManifest: {
          id: 'demo-path',
          type: 'path',
          prerequisites: [
            { id: 'docs', label: '[Read the docs](https://example.com/prerequisites)', format: 'markdown' },
          ],
        },
      },
    });

    render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={content} />);

    const link = screen.getByRole('link', { name: 'Read the docs' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows a directly opened milestone’s own prerequisites without path inheritance', () => {
    const content = makeContent({
      isNativeJson: true,
      metadata: {
        ...makeContent().metadata,
        learningJourney: { ...makeContent().metadata.learningJourney!, currentMilestone: 1 },
        packageManifest: {
          id: 'milestone-guide',
          type: 'guide',
          prerequisites: [{ id: 'own', label: 'Guide-only need' }],
        },
      },
    });

    render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={content} />);

    const prerequisite = screen.getByText('Guide-only need');
    const body = screen.getByText('Body');
    expect(prerequisite).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1, name: 'Demo' })).toHaveLength(1);
    expect(screen.queryByText('Path-only need')).not.toBeInTheDocument();
    expect(prerequisite.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId(testIds.markComplete.button)).toBeInTheDocument();
  });

  it('renders Markdown prerequisite links in the guide body as secure new-tab links', () => {
    const content = makeContent({
      metadata: {
        ...makeContent().metadata,
        learningJourney: { ...makeContent().metadata.learningJourney!, currentMilestone: 1 },
        packageManifest: {
          id: 'milestone-guide',
          type: 'guide',
          prerequisites: [{ id: 'docs', label: '[Guide prerequisite](https://example.com/guide)', format: 'markdown' }],
        },
      },
    });

    render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={content} />);

    const link = screen.getByRole('link', { name: 'Guide prerequisite' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it.each([
    { placement: 'path cover', packageType: 'path' as const, currentMilestone: 0 },
    { placement: 'member guide', packageType: 'guide' as const, currentMilestone: 1 },
  ])('does not intercept a new-tab prerequisite link on the $placement', ({ packageType, currentMilestone }) => {
    const href = 'https://interactive-learning.grafana.net/packages/setup/content.json';
    const content = makeContent({
      metadata: {
        ...makeContent().metadata,
        learningJourney: { ...makeContent().metadata.learningJourney!, currentMilestone },
        packageManifest: {
          id: 'prerequisite-link-test',
          type: packageType,
          prerequisites: [{ id: 'setup', label: `[Setup documentation](${href})`, format: 'markdown' }],
        },
      },
    });
    const openDocs = jest.fn();
    document.addEventListener('pathfinder-auto-open-docs', openDocs);

    try {
      render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={content} />);
      const link = screen.getByRole('link', { name: 'Setup documentation' });
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });

      expect(fireEvent(link, click)).toBe(true);
      expect(click.defaultPrevented).toBe(false);
      expect(openDocs).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('pathfinder-auto-open-docs', openDocs);
    }
  });

  it('still opens an ordinary interactive-learning content link inside the panel', () => {
    const href = 'https://interactive-learning.grafana.net/packages/setup/content.json';
    const content = makeContent({ content: `<p><a href="${href}">Open guide</a></p>` });
    const openDocs = jest.fn();
    document.addEventListener('pathfinder-auto-open-docs', openDocs);

    try {
      render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={content} />);
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });

      expect(fireEvent(screen.getByRole('link', { name: 'Open guide' }), click)).toBe(false);
      expect(click.defaultPrevented).toBe(true);
      expect(openDocs).toHaveBeenCalledTimes(1);
      expect((openDocs.mock.calls[0][0] as CustomEvent).detail).toEqual(
        expect.objectContaining({ url: href, source: 'content_link' })
      );
    } finally {
      document.removeEventListener('pathfinder-auto-open-docs', openDocs);
    }
  });

  it('opens a localized interactive-learning content link under its canonical URL', () => {
    const href = 'https://interactive-learning.grafana.net/packages/setup/content.ja.json';
    const content = makeContent({ content: `<p><a href="${href}">Open guide</a></p>` });
    const openDocs = jest.fn();
    document.addEventListener('pathfinder-auto-open-docs', openDocs);

    try {
      render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={content} />);
      fireEvent.click(screen.getByRole('link', { name: 'Open guide' }));

      expect((openDocs.mock.calls[0][0] as CustomEvent).detail).toEqual(
        expect.objectContaining({
          url: 'https://interactive-learning.grafana.net/packages/setup/content.json',
          title: 'Setup',
        })
      );
    } finally {
      document.removeEventListener('pathfinder-auto-open-docs', openDocs);
    }
  });

  it('suppresses owning journey prerequisites on a later milestone while preserving member prerequisites', () => {
    const content = makeContent({
      metadata: {
        ...makeContent().metadata,
        learningJourney: { ...makeContent().metadata.learningJourney!, currentMilestone: 1 },
        packageManifest: {
          id: 'member-guide',
          type: 'guide',
          prerequisites: [{ id: 'own', label: 'Member-only need' }],
        },
        journeyManifest: {
          id: 'owner-journey',
          type: 'journey',
          prerequisites: [{ id: 'parent', label: 'Journey-only need' }],
        },
      },
    });

    render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={content} />);

    expect(screen.getByText('Member-only need')).toBeInTheDocument();
    expect(screen.queryByText('Journey-only need')).not.toBeInTheDocument();
  });

  it('suppresses journey-type owner prerequisites on a later milestone', () => {
    const content = makeContent({
      metadata: {
        ...makeContent().metadata,
        learningJourney: { ...makeContent().metadata.learningJourney!, currentMilestone: 1 },
        packageManifest: {
          id: 'owner-journey',
          type: 'journey',
          prerequisites: [{ id: 'journey', label: 'Journey-only need' }],
        },
      },
    });

    render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={content} />);

    expect(screen.queryByText('Journey-only need')).not.toBeInTheDocument();
  });

  it('does not repeat path prerequisites on a later milestone', () => {
    const content = makeContent({
      metadata: {
        ...makeContent().metadata,
        learningJourney: { ...makeContent().metadata.learningJourney!, currentMilestone: 1 },
        packageManifest: {
          id: 'demo-path',
          type: 'path',
          prerequisites: [{ id: 'path-need', label: 'Path-only need' }],
        },
      },
    });

    render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={content} />);

    expect(screen.queryByText('Path-only need')).not.toBeInTheDocument();
  });

  it.each([undefined, []])('omits prerequisites for missing or empty declarations: %s', (prerequisites) => {
    const content = makeContent({
      metadata: {
        ...makeContent().metadata,
        packageManifest: { id: 'demo-path', type: 'path', ...(prerequisites === undefined ? {} : { prerequisites }) },
      },
    });

    render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={content} />);

    expect(screen.queryByRole('heading', { name: 'Prerequisites' })).not.toBeInTheDocument();
  });

  it('renders for package-backed path covers', () => {
    const content = makeContent({
      metadata: {
        ...makeContent().metadata,
        packageManifest: { id: 'demo-path', type: 'path' },
      },
    });

    render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={content} />);

    expect(screen.getByTestId(testIds.learningPaths.tableOfContents)).toBeInTheDocument();
  });

  it.each([
    [
      'a milestone page',
      makeContent({
        metadata: {
          ...makeContent().metadata,
          learningJourney: { ...makeContent().metadata.learningJourney!, currentMilestone: 1 },
        },
      }),
    ],
    [
      'an empty journey',
      makeContent({
        metadata: {
          ...makeContent().metadata,
          learningJourney: { ...makeContent().metadata.learningJourney!, milestones: [], totalMilestones: 0 },
        },
      }),
    ],
    ['non-journey content', makeContent({ type: 'single-doc' })],
  ])('does not render on %s', (_label, content) => {
    render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={content} />);

    expect(screen.queryByTestId(testIds.learningPaths.tableOfContents)).not.toBeInTheDocument();
  });

  it('does not duplicate the title once the hero card owns it', () => {
    render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={makeContent({ isNativeJson: true })} />);

    // The hero renders its own <h1> with the title; the standalone one above
    // it must be suppressed, not both — a document-wide role query catches
    // duplication regardless of which element it comes from.
    expect(screen.getAllByRole('heading', { level: 1, name: 'Demo' })).toHaveLength(1);
    expect(screen.getByTestId(testIds.learningPaths.coverHero)).toHaveTextContent('Demo');
  });

  it('keeps the native standalone title when a guide has valid prerequisites', () => {
    const content = makeContent({
      isNativeJson: true,
      type: 'single-doc',
      metadata: {
        ...makeContent().metadata,
        packageManifest: {
          id: 'standalone-guide',
          type: 'guide',
          prerequisites: [{ id: 'server', label: 'A running server' }],
        },
      },
    });

    render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={content} />);

    const title = screen.getByRole('heading', { level: 1, name: 'Demo' });
    const prerequisite = screen.getByText('A running server');
    expect(screen.getAllByRole('heading', { level: 1, name: 'Demo' })).toHaveLength(1);
    expect(prerequisite.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(
      prerequisite.compareDocumentPosition(screen.getByText('Body')) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('keeps the native title when a cover has no table of contents', () => {
    const content = makeContent({
      isNativeJson: true,
      metadata: {
        ...makeContent().metadata,
        learningJourney: { ...makeContent().metadata.learningJourney!, milestones: [], totalMilestones: 0 },
        packageManifest: {
          id: 'empty-path',
          type: 'path',
          prerequisites: [{ id: 'server', label: 'A running server' }],
        },
      },
    });

    render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={content} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Demo' })).toHaveLength(1);
    expect(screen.queryByTestId(testIds.learningPaths.tableOfContents)).not.toBeInTheDocument();
  });

  it('uses a 12 px gap below the generated title on non-cover content', () => {
    render(
      <ContentRenderer
        className={docsContentHtml(createTheme())}
        completion={UNTRACKED_COMPLETION}
        content={makeContent({ isNativeJson: true, type: 'single-doc' })}
      />
    );

    const title = screen.getByRole('heading', { level: 1, name: 'Demo' });
    expect(getComputedStyle(title).marginBottom).toBe('12px');
    expect(screen.queryByTestId(testIds.learningPaths.coverHero)).not.toBeInTheDocument();
  });
});
