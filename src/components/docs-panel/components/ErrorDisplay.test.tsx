/**
 * Tests for ErrorDisplay component.
 * Tests error rendering and retry functionality.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorDisplay } from './ErrorDisplay';
import { testIds } from '../../testIds';

// Mock @grafana/i18n
jest.mock('@grafana/i18n', () => ({
  t: jest.fn((key: string, fallback: string) => fallback),
}));

describe('ErrorDisplay', () => {
  describe('rendering', () => {
    it('renders with correct test ID', () => {
      render(<ErrorDisplay error="Something went wrong" contentType="documentation" />);

      const container = screen.getByTestId(testIds.docsPanel.errorState);
      expect(container).toBeInTheDocument();
    });

    it('displays error message text', () => {
      render(<ErrorDisplay error="Failed to fetch documentation" contentType="documentation" />);

      expect(screen.getByText('Failed to fetch documentation')).toBeInTheDocument();
    });

    it('applies className prop to container', () => {
      render(<ErrorDisplay error="Error" contentType="documentation" className="custom-error-class" />);

      const container = screen.getByTestId(testIds.docsPanel.errorState);
      expect(container).toHaveClass('custom-error-class');
    });

    it('shows appropriate title for documentation content type', () => {
      render(<ErrorDisplay error="Error" contentType="documentation" />);

      expect(screen.getByText('Unable to load documentation')).toBeInTheDocument();
    });

    it('shows appropriate title for learning-journey content type', () => {
      render(<ErrorDisplay error="Error" contentType="learning-journey" />);

      expect(screen.getByText('Unable to load learning path')).toBeInTheDocument();
    });
  });

  describe('retry button for retryable errors', () => {
    const retryableErrors = ['Request timeout', 'Unable to connect to server', 'A network error occurred'];

    it.each(retryableErrors)('shows retry button for retryable error: %s', (error) => {
      const onRetry = jest.fn();
      render(<ErrorDisplay error={error} contentType="documentation" onRetry={onRetry} />);

      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('calls onRetry callback when retry button is clicked', () => {
      const onRetry = jest.fn();
      render(<ErrorDisplay error="Request timeout" contentType="documentation" onRetry={onRetry} />);

      const retryButton = screen.getByRole('button', { name: 'Retry' });
      fireEvent.click(retryButton);

      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('shows retry hint text for retryable errors', () => {
      render(<ErrorDisplay error="network error" contentType="documentation" onRetry={jest.fn()} />);

      expect(screen.getByText('Check your connection and try again')).toBeInTheDocument();
    });
  });

  describe('no retry button for non-retryable errors', () => {
    const nonRetryableErrors = ['Page not found', 'Invalid URL', 'Access denied', 'Unknown error'];

    it.each(nonRetryableErrors)('does NOT show retry button for non-retryable error: %s', (error) => {
      const onRetry = jest.fn();
      render(<ErrorDisplay error={error} contentType="documentation" onRetry={onRetry} />);

      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });

    it('does NOT show retry button when onRetry is not provided', () => {
      render(<ErrorDisplay error="Request timeout" contentType="documentation" />);

      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    });
  });
});
