/**
 * Block Editor Context
 *
 * React Context for tracking section/conditional editing context.
 * Replaces window.__blockEditorSectionContext and window.__blockEditorConditionalContext.
 */

import React, { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

/**
 * Context for tracking which section is being edited.
 */
export interface SectionContextValue {
  sectionId: string;
  index?: number;
}

/**
 * Context for tracking which conditional branch is being edited.
 */
export interface ConditionalContextValue {
  conditionalId: string;
  branch: 'whenTrue' | 'whenFalse';
  index?: number;
}

interface BlockEditorContextValue {
  /** Current section being edited (for nested block forms) */
  sectionContext: SectionContextValue | null;
  /** Current conditional being edited (for branch block forms) */
  conditionalContext: ConditionalContextValue | null;
  /** Set the section context */
  setSectionContext: (ctx: SectionContextValue | null) => void;
  /** Set the conditional context */
  setConditionalContext: (ctx: ConditionalContextValue | null) => void;
  /** Clear all editing context */
  clearContext: () => void;
}

export const BlockEditorContext = createContext<BlockEditorContextValue | null>(null);

interface BlockEditorContextProviderProps {
  children: ReactNode;
}

export function BlockEditorContextProvider({ children }: BlockEditorContextProviderProps) {
  const [sectionContext, setSectionContextState] = useState<SectionContextValue | null>(null);
  const [conditionalContext, setConditionalContextState] = useState<ConditionalContextValue | null>(null);

  const setSectionContext = useCallback((ctx: SectionContextValue | null) => {
    setSectionContextState(ctx);
  }, []);

  const setConditionalContext = useCallback((ctx: ConditionalContextValue | null) => {
    setConditionalContextState(ctx);
  }, []);

  const clearContext = useCallback(() => {
    setSectionContextState(null);
    setConditionalContextState(null);
  }, []);

  const value = useMemo(
    () => ({
      sectionContext,
      conditionalContext,
      setSectionContext,
      setConditionalContext,
      clearContext,
    }),
    [sectionContext, conditionalContext, setSectionContext, setConditionalContext, clearContext]
  );

  return <BlockEditorContext.Provider value={value}>{children}</BlockEditorContext.Provider>;
}

/**
 * Hook to access block editor context.
 * Must be used within BlockEditorContextProvider.
 */
export function useBlockEditorContext(): BlockEditorContextValue {
  const context = useContext(BlockEditorContext);
  if (!context) {
    throw new Error('useBlockEditorContext must be used within BlockEditorContextProvider');
  }
  return context;
}

/**
 * Safe version that returns no-op functions if used outside provider.
 * Useful for hooks that may be tested without the full provider setup.
 */
export function useBlockEditorContextSafe(): BlockEditorContextValue {
  const context = useContext(BlockEditorContext);
  // Provide no-op fallbacks for testing without provider
  return (
    context ?? {
      sectionContext: null,
      conditionalContext: null,
      setSectionContext: () => {},
      setConditionalContext: () => {},
      clearContext: () => {},
    }
  );
}
