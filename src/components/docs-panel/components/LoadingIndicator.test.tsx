/**
 * Tests for LoadingIndicator component.
 * Tests rendering behavior and prop forwarding.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { LoadingIndicator } from './LoadingIndicator';
import { testIds } from '../../../constants/testIds';

// Mock the SkeletonLoader to avoid complex styling dependencies
jest.mock('../../SkeletonLoader', () => ({
  SkeletonLoader: ({ type }: { type: string }) => (
    <div data-testid="skeleton-loader" data-skeleton-type={type}>
      Loading skeleton for {type}
    </div>
  ),
}));

describe('LoadingIndicator', () => {
  describe('rendering', () => {
    it('renders with correct test ID', () => {
      render(<LoadingIndicator contentType="documentation" />);

      const container = screen.getByTestId(testIds.docsPanel.loadingState);
      expect(container).toBeInTheDocument();
    });

    it('applies className prop to container', () => {
      render(<LoadingIndicator contentType="documentation" className="custom-loading-class" />);

      const container = screen.getByTestId(testIds.docsPanel.loadingState);
      expect(container).toHaveClass('custom-loading-class');
    });
  });

  describe('SkeletonLoader type', () => {
    it('passes "documentation" type to SkeletonLoader', () => {
      render(<LoadingIndicator contentType="documentation" />);

      const skeleton = screen.getByTestId('skeleton-loader');
      expect(skeleton).toHaveAttribute('data-skeleton-type', 'documentation');
    });

    it('passes "learning-journey" type to SkeletonLoader', () => {
      render(<LoadingIndicator contentType="learning-journey" />);

      const skeleton = screen.getByTestId('skeleton-loader');
      expect(skeleton).toHaveAttribute('data-skeleton-type', 'learning-journey');
    });
  });
});
