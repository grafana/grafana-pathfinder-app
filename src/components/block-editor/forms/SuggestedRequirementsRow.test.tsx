/**
 * Tests for the in-form Suggested-requirements row.
 *
 * Drive `suggestRequirementsFromContext` indirectly: the row is wired to
 * call it under the hood with the supplied action/reftarget/context.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SuggestedRequirementsRow } from './SuggestedRequirementsRow';

describe('SuggestedRequirementsRow', () => {
  it('renders nothing when there are no missing suggestions', () => {
    const { container } = render(
      <SuggestedRequirementsRow
        action="highlight"
        reftarget="button"
        requirements="exists-reftarget"
        onApply={jest.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows a chip per missing suggestion', () => {
    // formfill always suggests on-page: when currentPath is set; jsdom
    // gives `window.location.pathname === '/'` though, which the
    // suggester treats as "no useful path". Use a nav-menu reftarget so
    // exists-reftarget + navmenu-open suggest deterministically.
    render(
      <SuggestedRequirementsRow
        action="button"
        reftarget='a[data-testid="data-testid Nav menu item"]'
        requirements=""
        onApply={jest.fn()}
      />
    );
    expect(screen.getByText('exists-reftarget')).toBeInTheDocument();
    expect(screen.getByText('navmenu-open')).toBeInTheDocument();
  });

  it('clicking a chip calls onApply with the merged value', () => {
    const onApply = jest.fn();
    render(
      <SuggestedRequirementsRow
        action="button"
        reftarget='a[data-testid="data-testid Nav menu item"]'
        requirements=""
        onApply={onApply}
      />
    );
    fireEvent.click(screen.getByText('exists-reftarget'));
    expect(onApply).toHaveBeenCalledWith('exists-reftarget');
  });

  it('clicking "Apply all" merges every suggestion at once', () => {
    const onApply = jest.fn();
    render(
      <SuggestedRequirementsRow
        action="button"
        reftarget='a[data-testid="data-testid Nav menu item"]'
        requirements=""
        onApply={onApply}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Apply all/i }));
    expect(onApply).toHaveBeenCalledWith('navmenu-open, exists-reftarget');
  });
});
