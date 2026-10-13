import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import type { RawContent } from '../../types/content.types';
import { testIds } from '../../constants/testIds';
import { ContentRenderer } from './content-renderer';
import { UNTRACKED_COMPLETION } from '../../test-utils/content-renderer-completion';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
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
  it('renders on a learning journey cover with milestones', () => {
    render(<ContentRenderer completion={UNTRACKED_COMPLETION} content={makeContent()} />);

    expect(screen.getByTestId(testIds.learningPaths.tableOfContents)).toBeInTheDocument();
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

  it('still shows the standalone title on non-cover content', () => {
    render(
      <ContentRenderer
        completion={UNTRACKED_COMPLETION}
        content={makeContent({ isNativeJson: true, type: 'single-doc' })}
      />
    );

    expect(screen.getAllByRole('heading', { level: 1, name: 'Demo' })).toHaveLength(1);
    expect(screen.queryByTestId(testIds.learningPaths.coverHero)).not.toBeInTheDocument();
  });
});
