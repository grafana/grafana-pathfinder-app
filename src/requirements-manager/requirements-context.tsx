/**
 * React Context for SequentialRequirementsManager
 * Replaces singleton pattern with proper React context for better testability
 * and component isolation.
 */

import React, { createContext, useContext, useState, useEffect, PropsWithChildren } from 'react';
import { SequentialRequirementsManager } from './requirements-checker.hook';

/**
 * Context value type
 */
interface RequirementsContextValue {
  manager: SequentialRequirementsManager;
}

/**
 * React Context for the requirements manager
 * Null when used outside of a RequirementsProvider
 */
export const RequirementsContext = createContext<RequirementsContextValue | null>(null);

/**
 * Provider component that creates and manages the SequentialRequirementsManager instance
 *
 * Usage:
 * ```tsx
 * <RequirementsProvider>
 *   <YourInteractiveContent />
 * </RequirementsProvider>
 * ```
 */
export const RequirementsProvider: React.FC<PropsWithChildren> = ({ children }) => {
  // Create a single instance of the manager for this provider tree
  const [manager] = useState(() => {
    // For backward compatibility, use the singleton instance
    // This allows gradual migration from getInstance() to useRequirementsManager()
    return SequentialRequirementsManager.getInstance();
  });

  // Start monitoring when provider mounts, stop when it unmounts
  useEffect(() => {
    manager.startDOMMonitoring();

    return () => {
      manager.stopDOMMonitoring();
    };
  }, [manager]);

  const contextValue: RequirementsContextValue = {
    manager,
  };

  return <RequirementsContext.Provider value={contextValue}>{children}</RequirementsContext.Provider>;
};

/**
 * Hook to access the requirements manager from context
 *
 * @returns The SequentialRequirementsManager instance
 * @throws Error if used outside of RequirementsProvider
 *
 * Usage:
 * ```tsx
 * function MyComponent() {
 *   const { manager } = useRequirementsManager();
 *   // Use manager...
 * }
 * ```
 */
export function useRequirementsManager(): RequirementsContextValue {
  const context = useContext(RequirementsContext);

  if (!context) {
    // Fallback to singleton for backward compatibility during migration
    // This allows components to work both inside and outside RequirementsProvider
    return {
      manager: SequentialRequirementsManager.getInstance(),
    };
  }

  return context;
}

/**
 * Hook to check if we're inside a RequirementsProvider
 * Useful for conditional behavior during migration
 */
export function useIsInsideRequirementsProvider(): boolean {
  const context = useContext(RequirementsContext);
  return context !== null;
}
