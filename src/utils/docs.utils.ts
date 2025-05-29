import React, { useMemo } from 'react';
import { DocsPanel } from '../components/docs-panel/docs-panel';

/**
 * Hook to create and memoize a DocsPanel instance
 * Prevents recreation on every render and ensures proper cleanup
 */
export function useDocsPanel() {
  return useMemo(() => new DocsPanel(), []);
}

/**
 * React component that renders a DocsPanel
 * Useful for extensions and standalone usage
 */
export function DocsPanelComponent() {
  const docsPanel = useDocsPanel();
  return React.createElement(docsPanel.Component, { model: docsPanel });
} 