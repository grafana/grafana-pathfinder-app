import React, { Component, lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react';
import { Alert, Button, LoadingPlaceholder } from '@grafana/ui';
import { loadTranslatedModule } from '../../lib/plugin-translations';
import { logger } from '../../lib/logging';

// eslint-disable-next-line no-restricted-syntax -- React error boundaries require a class lifecycle.
class LoadingBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    logger.exception(error, { source: 'Learning surface load' });
  }

  render() {
    if (this.state.failed) {
      return (
        <Alert title="Unable to load interactive learning" severity="error">
          <Button onClick={this.props.onRetry}>Try again</Button>
        </Alert>
      );
    }
    return this.props.children;
  }
}

export function createTranslatedComponent<P extends object>(load: () => Promise<{ default: ComponentType<P> }>) {
  const createComponent = () => lazy(() => loadTranslatedModule(load));
  let SharedComponent = createComponent();

  return function TranslatedComponent(props: P) {
    const [{ View, attempt }, setAttempt] = useState({ View: SharedComponent, attempt: 0 });
    const retry = () => {
      SharedComponent = createComponent();
      setAttempt(({ attempt }) => ({ View: SharedComponent, attempt: attempt + 1 }));
    };

    return (
      <LoadingBoundary key={attempt} onRetry={retry}>
        <Suspense fallback={<LoadingPlaceholder text="Loading interactive learning" />}>
          <View {...props} />
        </Suspense>
      </LoadingBoundary>
    );
  };
}
