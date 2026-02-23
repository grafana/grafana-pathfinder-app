import { AppRootProps, GrafanaTheme2 } from '@grafana/data';
// TODO: Re-enable Faro once collector CORS is configured correctly
// import { faro } from '@grafana/faro-react';
import React, { useMemo, useEffect, Component, ReactNode } from 'react';
import { SceneApp } from '@grafana/scenes';
import { Button, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { homePage } from '../../pages/homePage';
import { docsPage } from '../../pages/docsPage';
import { PluginPropsContext } from '../../utils/utils.plugin';
import { getConfigWithDefaults } from '../../constants';
import { onPluginStart } from '../../context-engine';
import { PathfinderFeatureProvider } from '../OpenFeatureProvider';

/**
 * Error Boundary to catch render errors in the plugin tree (R6)
 * Prevents white screen of death and provides recovery option
 */
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

// eslint-disable-next-line no-restricted-syntax -- Error boundaries require componentDidCatch (no hook equivalent)
class PluginErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Pathfinder plugin error:', error, errorInfo);
    this.setState({ errorInfo });

    // TODO: Re-enable Faro once collector CORS is configured correctly
    // Report error to Faro if available
    // try {
    //   faro.api?.pushError(error, {
    //     context: {
    //       componentStack: errorInfo.componentStack ?? 'unknown',
    //       source: 'PluginErrorBoundary',
    //     },
    //   });
    // } catch {
    //   // Faro may not be initialized, ignore silently
    // }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} onReset={this.handleReset} />;
    }
    return this.props.children;
  }
}

/**
 * Fallback UI when an error occurs
 */
function ErrorFallback({ error, onReset }: { error: Error | null; onReset: () => void }) {
  const styles = useStyles2(getErrorStyles);

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h3 className={styles.title}>Something went wrong</h3>
        <p className={styles.message}>
          The Pathfinder plugin encountered an error. You can try again or refresh the page.
        </p>
        {error && <code className={styles.errorCode}>{error.message}</code>}
        <div className={styles.actions}>
          <Button variant="primary" onClick={onReset}>
            Try Again
          </Button>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Refresh Page
          </Button>
        </div>
      </div>
    </div>
  );
}

const getErrorStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: theme.spacing(4),
  }),
  content: css({
    textAlign: 'center',
    maxWidth: '400px',
  }),
  title: css({
    color: theme.colors.text.primary,
    marginBottom: theme.spacing(2),
  }),
  message: css({
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing(2),
  }),
  errorCode: css({
    display: 'block',
    padding: theme.spacing(1),
    marginBottom: theme.spacing(2),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.error.text,
    wordBreak: 'break-word',
  }),
  actions: css({
    display: 'flex',
    gap: theme.spacing(1),
    justifyContent: 'center',
  }),
});

function getSceneApp() {
  return new SceneApp({
    pages: [homePage, docsPage],
  });
}

function App(props: AppRootProps) {
  const scene = useMemo(() => getSceneApp(), []);

  // Get configuration
  const config = useMemo(() => getConfigWithDefaults(props.meta.jsonData || {}), [props.meta.jsonData]);

  // Set global config early for module-level utilities
  useEffect(() => {
    (window as any).__pathfinderPluginConfig = config;
  }, [config]);

  // SECURITY: Initialize plugin on mount (includes dev mode from server)
  useEffect(() => {
    onPluginStart();
  }, []);

  return (
    <PathfinderFeatureProvider>
      <PluginPropsContext.Provider value={props}>
        <PluginErrorBoundary>
          <scene.Component model={scene} />
        </PluginErrorBoundary>
      </PluginPropsContext.Provider>
    </PathfinderFeatureProvider>
  );
}

export default App;
