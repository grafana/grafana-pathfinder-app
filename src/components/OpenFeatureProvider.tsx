import React, { ReactNode } from 'react';
import { OpenFeatureProvider as OFProvider } from '@openfeature/react-sdk';
import { OPENFEATURE_DOMAIN } from '../utils/openfeature';

interface PathfinderFeatureProviderProps {
  children: ReactNode;
}

/**
 * OpenFeature provider wrapper for Grafana Pathfinder
 *
 * Wraps children with OpenFeatureProvider using the pathfinder domain.
 * This enables the use of feature flag hooks (useBooleanFlag, etc.) within
 * the component tree.
 *
 * The provider is automatically aware of the domain set during initialization,
 * so hooks will evaluate flags against the correct provider.
 *
 * @example
 * // Wrap your app or component tree
 * <PathfinderFeatureProvider>
 *   <App />
 * </PathfinderFeatureProvider>
 *
 * // Then use hooks in child components
 * const autoOpen = useBooleanFlag(FeatureFlags.AUTO_OPEN_SIDEBAR_ON_LAUNCH, false);
 */
export const PathfinderFeatureProvider = ({ children }: PathfinderFeatureProviderProps) => {
  return <OFProvider domain={OPENFEATURE_DOMAIN}>{children}</OFProvider>;
};
