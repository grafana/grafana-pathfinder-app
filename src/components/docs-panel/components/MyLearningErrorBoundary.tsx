/**
 * Error boundary for MyLearningTab to prevent panel crashes.
 * REACT: Error boundary to prevent panel crashes (R6)
 */

import React, { Component, ReactNode } from 'react';
import { Icon, Button } from '@grafana/ui';

interface MyLearningErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface MyLearningErrorBoundaryProps {
  children: ReactNode;
}

/**
 * Error boundary component that catches errors in MyLearningTab
 * and displays a fallback UI instead of crashing the entire panel.
 */
export class MyLearningErrorBoundary extends Component<MyLearningErrorBoundaryProps, MyLearningErrorBoundaryState> {
  state: MyLearningErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): MyLearningErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('MyLearningTab error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 16, textAlign: 'center' }}>
          <Icon name="exclamation-triangle" size="xl" />
          <p style={{ marginTop: 8 }}>Unable to load learning progress</p>
          <Button size="sm" variant="secondary" onClick={() => this.setState({ hasError: false, error: null })}>
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
