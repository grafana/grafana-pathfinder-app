/**
 * Block Editor Context
 *
 * React Context for tracking section/conditional editing context, plus the
 * shared guide-lint result so per-block badges and the JSON-mode validator
 * read from a single cached source of truth.
 *
 * Replaces window.__blockEditorSectionContext and window.__blockEditorConditionalContext.
 */

import React, { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import type { GuideLintResult } from './lint';

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
  /**
   * Latest guide-lint result, or null until a guide-aware container has
   * published one via `setGuideLintResult`. Consumers (BlockItem, future
   * Health panel) read this to render badges without re-walking the tree.
   */
  guideLintResult: GuideLintResult | null;
  /** Publish a new guide-lint result. Called by the BlockEditor on every guide change. */
  setGuideLintResult: (result: GuideLintResult | null) => void;
}

export const BlockEditorContext = createContext<BlockEditorContextValue | null>(null);

interface BlockEditorContextProviderProps {
  children: ReactNode;
}

export function BlockEditorContextProvider({ children }: BlockEditorContextProviderProps) {
  const [sectionContext, setSectionContextState] = useState<SectionContextValue | null>(null);
  const [conditionalContext, setConditionalContextState] = useState<ConditionalContextValue | null>(null);
  const [guideLintResult, setGuideLintResultState] = useState<GuideLintResult | null>(null);

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

  const setGuideLintResult = useCallback((result: GuideLintResult | null) => {
    setGuideLintResultState(result);
  }, []);

  const value = useMemo(
    () => ({
      sectionContext,
      conditionalContext,
      setSectionContext,
      setConditionalContext,
      clearContext,
      guideLintResult,
      setGuideLintResult,
    }),
    [
      sectionContext,
      conditionalContext,
      setSectionContext,
      setConditionalContext,
      clearContext,
      guideLintResult,
      setGuideLintResult,
    ]
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
      guideLintResult: null,
      setGuideLintResult: () => {},
    }
  );
}

/**
 * Convenience hook for components that just want to read the current lint
 * result without touching the rest of the context surface.
 */
export function useGuideLintResult(): GuideLintResult | null {
  return useBlockEditorContextSafe().guideLintResult;
}
