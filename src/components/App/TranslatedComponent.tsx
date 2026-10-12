import React, { Component, lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react';
import { Alert, Button, LoadingPlaceholder, Stack } from '@grafana/ui';
import { loadTranslatedModule } from '../../lib/plugin-translations';
import { logger } from '../../lib/logging';

// eslint-disable-next-line no-restricted-syntax -- React error boundaries require a class lifecycle.
class LoadingBoundary extends Component<
  { children: ReactNode; onRetry: () => void; onDismiss?: () => void },
  { failed: boolean }
> {
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
          <Stack gap={1}>
            <Button onClick={this.props.onRetry}>Try again</Button>
            {this.props.onDismiss && (
              <Button variant="secondary" onClick={this.props.onDismiss}>
                Close
              </Button>
            )}
          </Stack>
        </Alert>
      );
    }
    return this.props.children;
  }
}

export function createTranslatedComponent<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  options: { dismiss?: (props: P) => void } = {}
) {
  const createComponent = () => lazy(() => loadTranslatedModule(load));
  let SharedComponent = createComponent();
  const { dismiss } = options;

  return function TranslatedComponent(props: P) {
    const [{ View, attempt }, setAttempt] = useState({ View: SharedComponent, attempt: 0 });
    const retry = () => {
      SharedComponent = createComponent();
      setAttempt(({ attempt }) => ({ View: SharedComponent, attempt: attempt + 1 }));
    };

    return (
      <LoadingBoundary key={attempt} onRetry={retry} onDismiss={dismiss && (() => dismiss(props))}>
        <Suspense fallback={<LoadingPlaceholder text="Loading interactive learning" />}>
          <View {...props} />
        </Suspense>
      </LoadingBoundary>
    );
  };
}
