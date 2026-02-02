/**
 * Tests for MyLearningErrorBoundary component.
 * Tests error boundary behavior and fallback UI rendering.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MyLearningErrorBoundary } from './MyLearningErrorBoundary';

// Component that throws an error for testing
const ThrowError = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <div data-testid="child-content">Child content rendered successfully</div>;
};

describe('MyLearningErrorBoundary', () => {
  // Suppress console.error during error boundary tests
  const originalError = console.error;
  beforeAll(() => {
    console.error = jest.fn();
  });
  afterAll(() => {
    console.error = originalError;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('normal rendering', () => {
    it('renders children when no error occurs', () => {
      render(
        <MyLearningErrorBoundary>
          <ThrowError shouldThrow={false} />
        </MyLearningErrorBoundary>
      );

      expect(screen.getByTestId('child-content')).toBeInTheDocument();
      expect(screen.getByText('Child content rendered successfully')).toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('shows fallback UI when child throws an error', () => {
      render(
        <MyLearningErrorBoundary>
          <ThrowError shouldThrow={true} />
        </MyLearningErrorBoundary>
      );

      expect(screen.getByText('Unable to load learning progress')).toBeInTheDocument();
      expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
    });

    it('shows "Try again" button in fallback UI', () => {
      render(
        <MyLearningErrorBoundary>
          <ThrowError shouldThrow={true} />
        </MyLearningErrorBoundary>
      );

      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });

    it('logs error to console when error is caught', () => {
      render(
        <MyLearningErrorBoundary>
          <ThrowError shouldThrow={true} />
        </MyLearningErrorBoundary>
      );

      expect(console.error).toHaveBeenCalledWith(
        'MyLearningTab error:',
        expect.any(Error),
        expect.objectContaining({ componentStack: expect.any(String) })
      );
    });
  });

  describe('recovery behavior', () => {
    it('clicking "Try again" resets the error boundary state', () => {
      // Use a stateful wrapper to control the throw behavior
      let shouldThrow = true;

      const ToggleableError = () => {
        if (shouldThrow) {
          throw new Error('Test error');
        }
        return <div data-testid="recovered-content">Recovered!</div>;
      };

      // Start with error state
      render(
        <MyLearningErrorBoundary>
          <ToggleableError />
        </MyLearningErrorBoundary>
      );

      // Verify fallback UI is shown
      expect(screen.getByText('Unable to load learning progress')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

      // Set component to not throw on next render
      shouldThrow = false;

      // Click "Try again" - this resets the error boundary state and re-renders children
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

      // Verify child renders after recovery (boundary state reset allows re-render)
      expect(screen.getByTestId('recovered-content')).toBeInTheDocument();
      expect(screen.getByText('Recovered!')).toBeInTheDocument();
    });
  });
});
