/**
 * React Context for AssistantBlockWrapper to provide customized values DOWN to child InteractiveSteps
 *
 * This allows the wrapper to communicate the AI-customized query value to the interactive step
 * so it can render with proper styling while using the customized value.
 */

import React, { createContext, useContext, useMemo, ReactNode } from 'react';

export interface AssistantBlockValueContextValue {
  /** The customized value from the assistant (null if not customized) */
  customizedValue: string | null;
  /** Whether the content is currently being generated */
  isGenerating: boolean;
  /** The datasource type used for customization (for syntax highlighting) */
  datasourceType: string | null;
}

const AssistantBlockValueContext = createContext<AssistantBlockValueContextValue | null>(null);

export interface AssistantBlockValueProviderProps {
  /** The customized value to provide to children */
  customizedValue: string | null;
  /** Whether content is being generated */
  isGenerating: boolean;
  /** The datasource type used for customization (for syntax highlighting) */
  datasourceType?: string | null;
  /** Child components */
  children: ReactNode;
}

/**
 * Provider component for assistant block value context
 * Used by AssistantBlockWrapper to provide customized values to child InteractiveStep components
 */
export function AssistantBlockValueProvider({
  customizedValue,
  isGenerating,
  datasourceType = null,
  children,
}: AssistantBlockValueProviderProps) {
  // REACT: memoize context value to prevent unnecessary re-renders (R11)
  const contextValue = useMemo(
    () => ({ customizedValue, isGenerating, datasourceType }),
    [customizedValue, isGenerating, datasourceType]
  );

  return <AssistantBlockValueContext.Provider value={contextValue}>{children}</AssistantBlockValueContext.Provider>;
}

/**
 * Hook to access assistant block value context
 * Returns null if not within an AssistantBlockWrapper context
 */
export function useAssistantBlockValue(): AssistantBlockValueContextValue | null {
  return useContext(AssistantBlockValueContext);
}
