import React, { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { useMilestoneScroll } from './useMilestoneScroll';

function Reader({ reader, milestone }: { reader: string; milestone?: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  useMilestoneScroll(contentRef, reader, milestone);
  return <div ref={contentRef} />;
}

function Scroller({ reader, milestone }: { reader: string; milestone?: string }) {
  return (
    <div data-testid="scroller" data-milestone-scroll-container>
      <Reader reader={reader} milestone={milestone} />
    </div>
  );
}

function scrollTo(scroller: HTMLElement, top: number) {
  scroller.scrollTop = top;
  fireEvent.scroll(scroller);
}

it('starts a different milestone at the top, including when returning to a previously read milestone', () => {
  const { rerender } = render(<Scroller reader="navigation" milestone="one" />);
  const scroller = screen.getByTestId('scroller');
  scrollTo(scroller, 300);

  rerender(<Scroller reader="navigation" milestone="two" />);
  expect(scroller.scrollTop).toBe(0);
  scrollTo(scroller, 500);

  rerender(<Scroller reader="navigation" milestone="one" />);
  expect(scroller.scrollTop).toBe(0);
});

it('carries the same milestone position between scroll containers', () => {
  const first = render(<Scroller reader="handoff" milestone="one" />);
  scrollTo(screen.getByTestId('scroller'), 300);
  first.unmount();

  render(<Scroller reader="handoff" milestone="one" />);
  expect(screen.getByTestId('scroller').scrollTop).toBe(300);
});

it('keeps the previous position while there is no newly rendered milestone', () => {
  const { rerender } = render(<Scroller reader="loading" milestone="one" />);
  const scroller = screen.getByTestId('scroller');
  scrollTo(scroller, 300);

  rerender(<Scroller reader="loading" />);
  expect(scroller.scrollTop).toBe(300);
  scroller.scrollTop = 0;

  rerender(<Scroller reader="loading" milestone="one" />);
  expect(scroller.scrollTop).toBe(300);
});
