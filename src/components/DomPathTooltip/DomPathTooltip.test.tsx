/**
 * Tests for DOM path tooltip component
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { DomPathTooltip } from './DomPathTooltip';

describe('DomPathTooltip', () => {
  it('renders tooltip with DOM path', () => {
    const domPath = 'body > div.container > button[data-testid="save"]';
    const position = { x: 100, y: 200 };

    render(<DomPathTooltip domPath={domPath} position={position} visible={true} />);

    // DOM path is split across multiple spans, so we check for parts
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(screen.getByText('div.container')).toBeInTheDocument();
    expect(screen.getByText('button')).toBeInTheDocument();
    expect(screen.getByText('[data-testid="save"]')).toBeInTheDocument();
  });

  it('positions tooltip at specified coordinates with offset', () => {
    const domPath = 'body > div > button';
    const position = { x: 100, y: 200 };

    const { container } = render(<DomPathTooltip domPath={domPath} position={position} visible={true} />);

    const tooltip = container.firstChild as HTMLElement;
    expect(tooltip.style.left).toBe('115px'); // 100 + 15px offset
    expect(tooltip.style.top).toBe('215px'); // 200 + 15px offset
  });

  it('does not render when visible is false', () => {
    const domPath = 'body > div > button';
    const position = { x: 100, y: 200 };

    const { container } = render(<DomPathTooltip domPath={domPath} position={position} visible={false} />);

    expect(container.firstChild).toBeNull();
  });

  it('does not render when domPath is empty', () => {
    const position = { x: 100, y: 200 };

    const { container } = render(<DomPathTooltip domPath="" position={position} visible={true} />);

    expect(container.firstChild).toBeNull();
  });

  it('renders complex DOM paths with runtime classes', () => {
    const domPath = 'body > div.css-abc123.container > main#content > button[data-testid="save"].btn.primary';
    const position = { x: 50, y: 75 };

    render(<DomPathTooltip domPath={domPath} position={position} visible={true} />);

    // Check for key parts of the complex path
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(screen.getByText('div.css-abc123.container')).toBeInTheDocument();
    expect(screen.getByText('main#content')).toBeInTheDocument();
    expect(screen.getByText('[data-testid="save"]')).toBeInTheDocument();
  });

  it('handles very long DOM paths', () => {
    const longPath =
      'body > div.wrapper > div.container.css-123 > main.main-content > section.section-one > div.row > div.col > button[data-testid="very-long-test-id"].btn.primary.large';
    const position = { x: 10, y: 20 };

    render(<DomPathTooltip domPath={longPath} position={position} visible={true} />);

    // Check for key parts of the long path
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(screen.getByText('div.wrapper')).toBeInTheDocument();
    expect(screen.getByText('[data-testid="very-long-test-id"]')).toBeInTheDocument();
    expect(screen.getByText('.btn.primary.large')).toBeInTheDocument();
  });

  it('updates position when prop changes', () => {
    const domPath = 'body > button';
    const initialPosition = { x: 100, y: 200 };

    const { container, rerender } = render(
      <DomPathTooltip domPath={domPath} position={initialPosition} visible={true} />
    );

    const tooltip = container.firstChild as HTMLElement;
    expect(tooltip.style.left).toBe('115px');
    expect(tooltip.style.top).toBe('215px');

    // Update position
    const newPosition = { x: 300, y: 400 };
    rerender(<DomPathTooltip domPath={domPath} position={newPosition} visible={true} />);

    expect(tooltip.style.left).toBe('315px');
    expect(tooltip.style.top).toBe('415px');
  });
});
