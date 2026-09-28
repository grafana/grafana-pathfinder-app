import React from 'react';
import { render, screen } from '@testing-library/react';

import type { RawContent } from '../../types/content.types';
import { testIds } from '../../constants/testIds';
import { ContentRenderer } from './content-renderer';

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
    render(<ContentRenderer content={makeContent()} />);

    expect(screen.getByTestId(testIds.learningPaths.tableOfContents)).toBeInTheDocument();
  });

  it('renders for package-backed path covers', () => {
    const content = makeContent({
      metadata: {
        ...makeContent().metadata,
        packageManifest: { id: 'demo-path', type: 'path' },
      },
    });

    render(<ContentRenderer content={content} />);

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
    render(<ContentRenderer content={content} />);

    expect(screen.queryByTestId(testIds.learningPaths.tableOfContents)).not.toBeInTheDocument();
  });

  it('does not duplicate the title once the hero card owns it', () => {
    render(<ContentRenderer content={makeContent({ isNativeJson: true })} />);

    // The hero renders its own <h1> with the title; the standalone one above
    // it must be suppressed, not both — a document-wide role query catches
    // duplication regardless of which element it comes from.
    expect(screen.getAllByRole('heading', { level: 1, name: 'Demo' })).toHaveLength(1);
    expect(screen.getByTestId(testIds.learningPaths.coverHero)).toHaveTextContent('Demo');
  });

  it('still shows the standalone title on non-cover content', () => {
    render(<ContentRenderer content={makeContent({ isNativeJson: true, type: 'single-doc' })} />);

    expect(screen.getAllByRole('heading', { level: 1, name: 'Demo' })).toHaveLength(1);
    expect(screen.queryByTestId(testIds.learningPaths.coverHero)).not.toBeInTheDocument();
  });
});
