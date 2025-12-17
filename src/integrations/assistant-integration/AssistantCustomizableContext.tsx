/**
 * React Context for AssistantCustomizable components to communicate with parent InteractiveSteps
 *
 * This allows customized queries to update the parent interactive step's targetValue
 * without DOM manipulation, using proper React patterns.
 */

import React, { createContext, useContext, useMemo, ReactNode } from 'react';

export interface AssistantCustomizableContextValue {
  /** Update the parent interactive step's target value */
  updateTargetValue: (newValue: string) => void;
}

const AssistantCustomizableContext = createContext<AssistantCustomizableContextValue | null>(null);

export interface AssistantCustomizableProviderProps {
  /** Function to update the target value in the parent component */
  updateTargetValue: (newValue: string) => void;
  /** Child components */
  children: ReactNode;
}

/**
 * Provider component for assistant customizable context
 * Used by InteractiveStep to provide update capability to child AssistantCustomizable components
 */
export function AssistantCustomizableProvider({ updateTargetValue, children }: AssistantCustomizableProviderProps) {
  // REACT: memoize context value to prevent unnecessary re-renders (R11)
  const contextValue = useMemo(() => ({ updateTargetValue }), [updateTargetValue]);

  return <AssistantCustomizableContext.Provider value={contextValue}>{children}</AssistantCustomizableContext.Provider>;
}

/**
 * Hook to access assistant customizable context
 * Returns null if not within an interactive step context
 */
export function useAssistantCustomizableContext(): AssistantCustomizableContextValue | null {
  return useContext(AssistantCustomizableContext);
}
