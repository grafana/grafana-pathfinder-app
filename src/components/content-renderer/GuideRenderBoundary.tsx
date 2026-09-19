import React, { Component, createContext } from 'react';
import type { GuideLoadContext } from '../../types/guide-diagnostics.types';
import { reportGuideRenderCrash } from '../../lib/telemetry/guide-load';

export const GuideLoadTelemetryContext = createContext<GuideLoadContext | undefined>(undefined);

// eslint-disable-next-line no-restricted-syntax -- React error boundaries require componentDidCatch
export class GuideRenderBoundary extends Component<
  {
    context?: GuideLoadContext;
    children: React.ReactNode;
  },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    reportGuideRenderCrash(this.props.context);
  }

  render() {
    return this.state.failed ? (
      <div role="alert">This guide could not be displayed. Try opening it again.</div>
    ) : (
      this.props.children
    );
  }
}
