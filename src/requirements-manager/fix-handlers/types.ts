/**
 * Fix handler interfaces.
 *
 * A fix handler is the unit of recovery for a failing requirement: given the
 * current state and dependencies (NavigationManager, hook callbacks), execute
 * a side-effect that should make the requirement satisfiable on the next check.
 *
 * The registry in `fix-registry.ts` iterates `FIX_HANDLERS` (from `index.ts`)
 * and runs the first handler whose `canHandle` returns true. Specific-fixType
 * handlers come before catch-all ones in the array.
 */

import type { FixTypeValue } from '../fix-types';

/**
 * Minimal NavigationManager surface used by fix handlers. Defined here rather
 * than imported to avoid a circular dependency between requirements-manager and
 * interactive-engine. The actual NavigationManager class implements all of
 * these methods.
 */
export interface FixHandlerNavigationManager {
  expandParentNavigationSection(targetHref: string): Promise<boolean>;
  fixLocationRequirement(targetPath: string): Promise<void>;
  fixNavigationRequirements(): Promise<void>;
}

/**
 * Inputs to every fix handler. Built by the hook from current state + refs.
 */
export interface FixContext {
  fixType?: string;
  targetHref?: string;
  scrollContainer?: string;
  /** Raw requirements string from the step; used by the navigation handler's legacy fallback. */
  requirements?: string;
  stepId: string;
  /** May be null if the lazy `import('../interactive-engine')` has not yet resolved. */
  navigationManager: FixHandlerNavigationManager | null;
  fixNavigationRequirements: () => Promise<void>;
}

export type FixResult = { ok: true } | { ok: false; error: string };

export interface FixHandler {
  /** Tag for traceability and tests. */
  fixType: FixTypeValue;
  /** Returns true if this handler should run for the given context. */
  canHandle: (ctx: FixContext) => boolean;
  /** Run the side-effect that fixes the requirement. */
  execute: (ctx: FixContext) => Promise<FixResult>;
}
