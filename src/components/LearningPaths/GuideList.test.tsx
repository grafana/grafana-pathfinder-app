import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { GuideList } from './GuideList';
import type { PathGuide } from '../../types/learning-paths.types';

jest.mock('@grafana/ui', () => ({
  useStyles2: () => new Proxy({}, { get: (_t, p) => String(p) }),
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k])) : fallback,
}));

const guides: PathGuide[] = [
  { id: 'a', title: 'First module', completed: true, isCurrent: false },
  { id: 'b', title: 'Second module', completed: false, isCurrent: true },
  { id: 'c', title: 'Third module', completed: false, isCurrent: false },
  { id: 'd', title: 'Fourth module', completed: false, isCurrent: false, locked: true },
];

describe('GuideList', () => {
  it('renders a row per guide: check when completed, play when current, circle when pending, lock when locked (cover-page treatment)', () => {
    render(<GuideList guides={guides} enableCurrentRowLink />);

    expect(screen.getByText('First module')).toBeInTheDocument();
    expect(screen.getByText('Second module')).toBeInTheDocument();
    expect(screen.getByText('Third module')).toBeInTheDocument();
    expect(screen.getByText('Fourth module')).toBeInTheDocument();

    expect(document.querySelectorAll('[data-icon="check"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-icon="play"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-icon="circle"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-icon="lock"]')).toHaveLength(1);
    expect(screen.getByText('Locked')).toBeInTheDocument();
  });

  // Regression test (Cursor Bugbot, "Cover chrome leaks into cards"):
  // the play icon, accent card background, and "Up next" label are cover-page
  // treatment, gated by enableCurrentRowLink — same as the click affordance.
  // LearningPathCard on My Learning renders GuideList without that flag, so
  // its current row must fall back to a plain circle with no extra chrome.
  it('shows a plain circle (not play) for the current row by default, with no "Up next" label', () => {
    render(<GuideList guides={guides} />);

    expect(document.querySelectorAll('[data-icon="play"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-icon="circle"]')).toHaveLength(2);
    expect(screen.queryByText('Up next')).not.toBeInTheDocument();
  });

  // Regression test (Cursor Bugbot, "Current row loses accent styling"):
  // enableCurrentRowLink gates the play icon, card background, click
  // affordance, and "Up next" label — but the icon badge's own accent color
  // (guideIconBadgeCurrent) is not cover-only chrome and must stay on by
  // default, or the current module looks identical to a pending one on
  // My Learning cards.
  it('keeps the current row icon badge accented by default (not gated by enableCurrentRowLink)', () => {
    render(<GuideList guides={guides} />);

    const currentBadge = screen.getByText('Second module').closest('div')!.querySelector('span');
    expect(currentBadge?.className).toContain('guideIconBadgeCurrent');
    expect(currentBadge?.className).not.toContain('guideIconBadgeLocked');
  });

  it('marks only the current row as a journey-start target, when it has a url and enableCurrentRowLink is set', () => {
    const withUrl: PathGuide[] = [
      { id: 'a', title: 'Current module', completed: false, isCurrent: true, url: 'bundled:a/content.json' },
      { id: 'b', title: 'Other module', completed: false, isCurrent: false, url: 'bundled:b/content.json' },
    ];
    render(<GuideList guides={withUrl} enableCurrentRowLink />);

    const currentRow = screen.getByText('Current module').closest('div[data-journey-start]');
    expect(currentRow).toHaveAttribute('data-milestone-url', 'bundled:a/content.json');
    expect(currentRow).toHaveAttribute('data-interaction-location', 'module_row_click');
    expect(screen.getByText('Other module').closest('div')).not.toHaveAttribute('data-journey-start');
  });

  it('makes the journey-start row keyboard-operable: focusable, and Enter/Space dispatch a click', () => {
    const withUrl: PathGuide[] = [
      { id: 'a', title: 'Current module', completed: false, isCurrent: true, url: 'bundled:a/content.json' },
    ];
    render(<GuideList guides={withUrl} enableCurrentRowLink />);

    const currentRow = screen.getByText('Current module').closest('div[data-journey-start]') as HTMLElement;
    expect(currentRow).toHaveAttribute('role', 'button');
    expect(currentRow).toHaveAttribute('tabIndex', '0');

    const clickSpy = jest.fn();
    currentRow.addEventListener('click', clickSpy);

    fireEvent.keyDown(currentRow, { key: 'Enter' });
    expect(clickSpy).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(currentRow, { key: ' ' });
    expect(clickSpy).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(currentRow, { key: 'Tab' });
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });

  // Regression test (Cursor Bugbot, "GuideList click affordance leaks"):
  // GuideList also renders inside LearningPathCard on My Learning, a
  // separate DOM tree with no listener for data-journey-start (only the
  // cover page's contentRef subtree has one) — without enableCurrentRowLink,
  // the current row used to look clickable there but do nothing on click.
  it('does not mark the current row as a journey-start target by default (enableCurrentRowLink defaults to false)', () => {
    const withUrl: PathGuide[] = [
      { id: 'a', title: 'Current module', completed: false, isCurrent: true, url: 'bundled:a/content.json' },
    ];
    render(<GuideList guides={withUrl} />);

    expect(screen.getByText('Current module').closest('div')).not.toHaveAttribute('data-journey-start');
  });

  it('shows the estimated minutes tag when present and not locked', () => {
    const timed: PathGuide[] = [
      { id: 'a', title: 'Timed module', completed: false, isCurrent: false, estimatedMinutes: 12 },
    ];
    render(<GuideList guides={timed} />);

    expect(screen.getByText('12 min')).toBeInTheDocument();
  });

  it('shows both the duration and the locked status inline for a locked, timed module', () => {
    const timedAndLocked: PathGuide[] = [
      { id: 'a', title: 'Timed locked module', completed: false, isCurrent: false, locked: true, estimatedMinutes: 10 },
    ];
    render(<GuideList guides={timedAndLocked} />);

    const row = screen.getByText('Timed locked module').closest('div')!;
    expect(row).toHaveTextContent('10 min');
    expect(row).toHaveTextContent('Locked');
  });

  it('shows an "Up next" label on the current row only, when enableCurrentRowLink is set', () => {
    render(<GuideList guides={guides} enableCurrentRowLink />);

    expect(screen.getByText('Up next')).toBeInTheDocument();
    expect(screen.getByText('Second module').closest('div')).toHaveTextContent('Up next');
    expect(screen.getByText('First module').closest('div')).not.toHaveTextContent('Up next');
    expect(screen.getByText('Fourth module').closest('div')).not.toHaveTextContent('Up next');
  });

  it('shows a loading row instead of the list when isLoading is set', () => {
    render(<GuideList guides={[]} isLoading />);

    expect(screen.getByText('Loading guides...')).toBeInTheDocument();
    expect(document.querySelector('[data-icon="fa fa-spinner"]')).toBeInTheDocument();
  });

  it("renders a guide's description when present, and omits it when absent", () => {
    const withDescription: PathGuide[] = [
      {
        id: 'a',
        title: 'First module',
        description: 'What data sources are and why they matter.',
        completed: false,
        isCurrent: true,
      },
      { id: 'b', title: 'Second module', completed: false, isCurrent: false },
    ];
    render(<GuideList guides={withDescription} />);

    expect(screen.getByText('What data sources are and why they matter.')).toBeInTheDocument();
    expect(screen.getByText('Second module').closest('div')).not.toHaveTextContent('undefined');
  });
});
