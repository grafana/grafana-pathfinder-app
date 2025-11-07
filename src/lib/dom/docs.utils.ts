import React, { useMemo } from 'react';
import { usePluginContext } from '@grafana/data';
import { ContextPanel } from '../../components/docs-panel/context-panel';
import { CombinedLearningJourneyPanel } from '../../components/docs-panel/docs-panel';
import { getConfigWithDefaults } from '../../constants';

/**
 * Hook to create and memoize a ContextPanel Scene instance
 * Prevents recreation on every render and ensures proper cleanup
 */
export function useContextPanelScene() {
  return useMemo(() => new ContextPanel(), []);
}

/**
 * Hook to create and memoize a CombinedLearningJourneyPanel instance
 * Prevents recreation on every render and ensures proper cleanup
 */
export function useLearningJourneyPanel() {
  const pluginContext = usePluginContext();
  const pluginConfig = useMemo(() => {
    return getConfigWithDefaults(pluginContext?.meta?.jsonData || {});
  }, [pluginContext?.meta?.jsonData]);

  return useMemo(() => new CombinedLearningJourneyPanel(pluginConfig), [pluginConfig]);
}

/**
 * React component that renders a CombinedLearningJourneyPanel
 * This is the main component that includes both recommendations and learning journeys
 */
export function ContextPanelComponent() {
  const learningJourneyPanel = useLearningJourneyPanel();
  return React.createElement(learningJourneyPanel.Component, { model: learningJourneyPanel });
}

/**
 * React component that renders a CombinedLearningJourneyPanel
 * Useful for extensions and standalone usage
 */
export function LearningJourneyPanelComponent() {
  const learningJourneyPanel = useLearningJourneyPanel();
  return React.createElement(learningJourneyPanel.Component, { model: learningJourneyPanel });
}

// Keep the old exports for backward compatibility
export function useDocsPanel() {
  return useLearningJourneyPanel();
}

export function DocsPanelComponent() {
  return ContextPanelComponent();
}
