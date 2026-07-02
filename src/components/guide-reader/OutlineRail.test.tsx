import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { OutlineRail } from './OutlineRail';
import { testIds } from '../../constants/testIds';
import type { OutlineItem } from '../../hooks';

const ITEMS: OutlineItem[] = [
  { id: 'intro', text: 'Introduction', level: 2, kind: 'heading' },
  { id: 'getting-started', text: 'Getting started', level: 3, kind: 'heading' },
  { id: 'section-1', text: 'Explore your data', level: 2, kind: 'section' },
];

function renderRail(items: OutlineItem[]) {
  const container = document.createElement('div');
  ITEMS.forEach((item) => {
    const el = document.createElement('div');
    el.id = item.id;
    container.appendChild(el);
  });
  const containerRef = { current: container };
  return { ...render(<OutlineRail items={items} containerRef={containerRef} />), containerRef };
}

describe('OutlineRail', () => {
  it('renders nothing when there are no outline items', () => {
    renderRail([]);
    expect(screen.queryByTestId(testIds.guideReader.outline)).not.toBeInTheDocument();
  });

  it('renders one button per outline item, in order', () => {
    renderRail(ITEMS);
    const nav = screen.getByTestId(testIds.guideReader.outline);
    expect(nav).toHaveAttribute('aria-label', 'Document outline');

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Introduction', 'Getting started', 'Explore your data']);
  });

  it('scrolls the target element into view and applies a highlight on click', () => {
    const { containerRef } = renderRail(ITEMS);
    const target = containerRef.current.querySelector('#getting-started') as HTMLElement;
    const scrollIntoView = jest.fn();
    target.scrollIntoView = scrollIntoView;

    fireEvent.click(screen.getByTestId(testIds.guideReader.outlineItem('getting-started')));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(target.classList.contains('fragment-highlight')).toBe(true);
  });

  it('does nothing when the target id is not found in the container', () => {
    const { containerRef } = renderRail([
      { id: 'missing', text: 'Missing target', level: 2, kind: 'heading' },
      ...ITEMS,
    ]);

    fireEvent.click(screen.getByTestId(testIds.guideReader.outlineItem('missing')));

    expect(containerRef.current.querySelector('.fragment-highlight')).toBeNull();
  });
});
