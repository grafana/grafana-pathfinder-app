import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollapsibleBlock } from './collapsible-block';

describe('CollapsibleBlock', () => {
  it('hides children by default (collapsed)', () => {
    render(
      <CollapsibleBlock title="Show solution">
        <p>secret answer</p>
      </CollapsibleBlock>
    );
    expect(screen.queryByText('secret answer')).not.toBeInTheDocument();
    expect(screen.getByTestId('collapsible-toggle')).toHaveAttribute('aria-expanded', 'false');
  });

  it('reveals children when the toggle is clicked', () => {
    render(
      <CollapsibleBlock title="Show solution">
        <p>secret answer</p>
      </CollapsibleBlock>
    );
    fireEvent.click(screen.getByTestId('collapsible-toggle'));
    expect(screen.getByText('secret answer')).toBeInTheDocument();
    expect(screen.getByTestId('collapsible-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  it('only sets aria-controls while the content region is in the DOM', () => {
    render(
      <CollapsibleBlock title="Show solution">
        <p>secret answer</p>
      </CollapsibleBlock>
    );
    const toggle = screen.getByTestId('collapsible-toggle');
    // Collapsed: content is unmounted, so aria-controls must not dangle
    expect(toggle).not.toHaveAttribute('aria-controls');
    fireEvent.click(toggle);
    // Expanded: aria-controls points at the rendered content region
    const controls = toggle.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls!)).toBeInTheDocument();
  });

  it('renders children immediately when collapsed=false', () => {
    render(
      <CollapsibleBlock title="Notes" collapsed={false}>
        <p>always visible</p>
      </CollapsibleBlock>
    );
    expect(screen.getByText('always visible')).toBeInTheDocument();
  });

  it('falls back to a default label when no title is given', () => {
    render(
      <CollapsibleBlock>
        <p>content</p>
      </CollapsibleBlock>
    );
    expect(screen.getByTestId('collapsible-toggle')).toHaveTextContent('Show more');
  });
});
