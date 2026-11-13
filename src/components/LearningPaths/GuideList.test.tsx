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
    render(<GuideList guides={guides} enableRowLinks />);

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
  // treatment, gated by enableRowLinks — same as the click affordance.
  // LearningPathCard on My Learning renders GuideList without that flag, so
  // its current row must fall back to a plain circle with no extra chrome.
  it('shows a plain circle (not play) for the current row by default, with no "Up next" label', () => {
    render(<GuideList guides={guides} />);

    expect(document.querySelectorAll('[data-icon="play"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-icon="circle"]')).toHaveLength(2);
    expect(screen.queryByText('Up next')).not.toBeInTheDocument();
  });

  // Regression test (Cursor Bugbot, "Current row loses accent styling"):
  // enableRowLinks gates the play icon, card background, click
  // affordance, and "Up next" label — but the icon badge's own accent color
  // (guideIconBadgeCurrent) is not cover-only chrome and must stay on by
  // default, or the current module looks identical to a pending one on
  // My Learning cards.
  it('keeps the current row icon badge accented by default (not gated by enableRowLinks)', () => {
    render(<GuideList guides={guides} />);

    const currentBadge = screen.getByText('Second module').closest('div')!.querySelector('span');
    expect(currentBadge?.className).toContain('guideIconBadgeCurrent');
    expect(currentBadge?.className).not.toContain('guideIconBadgeLocked');
  });

  it('marks every unlocked row with a url as a journey-start target when enableRowLinks is set, never a locked one', () => {
    const withUrl: PathGuide[] = [
      { id: 'a', title: 'Done module', completed: true, isCurrent: false, url: 'bundled:a/content.json' },
      { id: 'b', title: 'Current module', completed: false, isCurrent: true, url: 'bundled:b/content.json' },
      { id: 'c', title: 'Later module', completed: false, isCurrent: false, url: 'bundled:c/content.json' },
      {
        id: 'd',
        title: 'Locked module',
        completed: false,
        isCurrent: false,
        locked: true,
        url: 'bundled:d/content.json',
      },
      { id: 'e', title: 'No url module', completed: false, isCurrent: false },
    ];
    render(<GuideList guides={withUrl} enableRowLinks />);

    const targets = Array.from(document.querySelectorAll('[data-journey-start="true"]'));
    expect(targets.map((el) => el.getAttribute('data-milestone-url'))).toEqual([
      'bundled:a/content.json',
      'bundled:b/content.json',
      'bundled:c/content.json',
    ]);
    targets.forEach((el) => expect(el).toHaveAttribute('data-interaction-location', 'module_row_click'));
    expect(document.querySelectorAll('[data-icon="angle-right"]')).toHaveLength(3);
    expect(screen.getByText('Locked module').closest('div')).not.toHaveAttribute('data-journey-start');
    expect(screen.getByText('No url module').closest('div')).not.toHaveAttribute('data-journey-start');
  });

  it('names each row link by its title, adding "completed" or "up next" where it applies', () => {
    const withUrl: PathGuide[] = [
      { id: 'a', title: 'Done module', completed: true, isCurrent: false, url: 'bundled:a/content.json' },
      { id: 'b', title: 'Current module', completed: false, isCurrent: true, url: 'bundled:b/content.json' },
      { id: 'c', title: 'Later module', completed: false, isCurrent: false, url: 'bundled:c/content.json' },
    ];
    render(<GuideList guides={withUrl} enableRowLinks />);

    expect(screen.getByRole('button', { name: 'Done module, completed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Current module, up next' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Later module' })).toBeInTheDocument();
  });

  it("tags each row link with its state at render time, for link-handler.hook.ts's row_state", () => {
    const withUrl: PathGuide[] = [
      { id: 'a', title: 'Done module', completed: true, isCurrent: false, url: 'bundled:a/content.json' },
      { id: 'b', title: 'Current module', completed: false, isCurrent: true, url: 'bundled:b/content.json' },
      { id: 'c', title: 'Later module', completed: false, isCurrent: false, url: 'bundled:c/content.json' },
    ];
    render(<GuideList guides={withUrl} enableRowLinks />);

    expect(screen.getByRole('button', { name: 'Done module, completed' })).toHaveAttribute(
      'data-row-state',
      'completed'
    );
    expect(screen.getByRole('button', { name: 'Current module, up next' })).toHaveAttribute(
      'data-row-state',
      'up_next'
    );
    expect(screen.getByRole('button', { name: 'Later module' })).toHaveAttribute('data-row-state', 'ahead');
  });

  it('makes the journey-start row keyboard-operable: focusable, and Enter/Space dispatch a click', () => {
    const withUrl: PathGuide[] = [
      { id: 'a', title: 'Current module', completed: false, isCurrent: true, url: 'bundled:a/content.json' },
    ];
    render(<GuideList guides={withUrl} enableRowLinks />);

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

  it('describes each row link by its description and meta, and forwards only a real guideId as data-milestone-id', () => {
    const withUrl: PathGuide[] = [
      {
        id: '1',
        guideId: 'real-id',
        title: 'Described module',
        description: 'What this module covers.',
        estimatedMinutes: 12,
        completed: false,
        isCurrent: false,
        url: 'bundled:a/content.json',
      },
      { id: '2', title: 'Plain module', completed: false, isCurrent: false, url: 'bundled:b/content.json' },
    ];
    render(<GuideList guides={withUrl} enableRowLinks />);

    const described = screen.getByRole('button', { name: 'Described module' });
    expect(described).toHaveAccessibleDescription('What this module covers. 12 min');
    expect(described).toHaveAttribute('data-milestone-id', 'real-id');

    const plain = screen.getByRole('button', { name: 'Plain module' });
    expect(plain).not.toHaveAttribute('aria-describedby');
    expect(plain).not.toHaveAttribute('data-milestone-id');
  });

  // Regression test (Cursor Bugbot, "GuideList click affordance leaks"):
  // GuideList also renders inside LearningPathCard on My Learning, a
  // separate DOM tree with no listener for data-journey-start (only the
  // cover page's contentRef subtree has one), so rows there must not look
  // clickable.
  it('marks no row as a journey-start target by default (enableRowLinks defaults to false)', () => {
    const withUrl: PathGuide[] = [
      { id: 'a', title: 'Current module', completed: false, isCurrent: true, url: 'bundled:a/content.json' },
      { id: 'b', title: 'Later module', completed: false, isCurrent: false, url: 'bundled:b/content.json' },
    ];
    render(<GuideList guides={withUrl} />);

    expect(document.querySelector('[data-journey-start]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-icon="angle-right"]')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
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

  it('shows an "Up next" label on the current row only, when enableRowLinks is set', () => {
    render(<GuideList guides={guides} enableRowLinks />);

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
