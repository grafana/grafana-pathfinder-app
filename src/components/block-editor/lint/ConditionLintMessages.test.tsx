/**
 * Tests for the inline ConditionLintMessages presentation component.
 *
 * Focus: that diagnostics render visibly and the "Replace with X" quick-fix
 * fires the apply callback with the right token / suggestion.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConditionLintMessages } from './ConditionLintMessages';
import type { Diagnostic } from './types';

describe('ConditionLintMessages', () => {
  it('renders nothing when diagnostics is empty', () => {
    const { container } = render(<ConditionLintMessages diagnostics={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one row per diagnostic with the message text', () => {
    const diagnostics: Diagnostic[] = [
      { severity: 'warning', code: 'condition.unknown_type', message: 'Unknown condition type x', path: [] },
      {
        severity: 'warning',
        code: 'condition.invalid_format',
        message: "Path argument should start with '/'",
        path: [],
      },
    ];
    render(<ConditionLintMessages diagnostics={diagnostics} />);
    expect(screen.getByText('Unknown condition type x')).toBeInTheDocument();
    expect(screen.getByText("Path argument should start with '/'")).toBeInTheDocument();
  });

  it('renders a Replace button when a diagnostic has a suggestion + tokenAtFault', () => {
    const onApplyFix = jest.fn();
    const diagnostics: Diagnostic[] = [
      {
        severity: 'warning',
        code: 'condition.unknown_type',
        message: "Unknown condition type 'is-amdin'",
        path: [],
        suggestion: 'is-admin',
        tokenAtFault: 'is-amdin',
      },
    ];
    render(<ConditionLintMessages diagnostics={diagnostics} onApplyFix={onApplyFix} />);
    const button = screen.getByRole('button', { name: /Replace with is-admin/i });
    expect(button).toBeInTheDocument();
  });

  it('calls onApplyFix(badToken, replacement) when the Replace button is clicked', () => {
    const onApplyFix = jest.fn();
    const diagnostics: Diagnostic[] = [
      {
        severity: 'warning',
        code: 'condition.unknown_type',
        message: "Unknown condition type 'is-amdin'",
        path: [],
        suggestion: 'is-admin',
        tokenAtFault: 'is-amdin',
      },
    ];
    render(<ConditionLintMessages diagnostics={diagnostics} onApplyFix={onApplyFix} />);
    fireEvent.click(screen.getByRole('button', { name: /Replace with is-admin/i }));
    expect(onApplyFix).toHaveBeenCalledTimes(1);
    expect(onApplyFix).toHaveBeenCalledWith('is-amdin', 'is-admin');
  });

  it('does NOT render a Replace button if the diagnostic has no suggestion', () => {
    const diagnostics: Diagnostic[] = [
      {
        severity: 'warning',
        code: 'condition.invalid_format',
        message: "Path argument should start with '/'",
        path: [],
        tokenAtFault: 'on-page:explore',
      },
    ];
    render(<ConditionLintMessages diagnostics={diagnostics} onApplyFix={jest.fn()} />);
    expect(screen.queryByRole('button', { name: /Replace with/i })).not.toBeInTheDocument();
  });

  it('does NOT render a Replace button if onApplyFix is not provided', () => {
    const diagnostics: Diagnostic[] = [
      {
        severity: 'warning',
        code: 'condition.unknown_type',
        message: "Unknown condition type 'is-amdin'",
        path: [],
        suggestion: 'is-admin',
        tokenAtFault: 'is-amdin',
      },
    ];
    render(<ConditionLintMessages diagnostics={diagnostics} />);
    expect(screen.queryByRole('button', { name: /Replace with/i })).not.toBeInTheDocument();
  });
});
