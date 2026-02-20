/**
 * Global step registry for tracking interactive steps across all sections.
 *
 * This module manages the document-wide step numbering system. Each section
 * registers its step count, and the registry computes offsets so that step
 * positions are globally unique across the entire document.
 *
 * Also manages the sequential section ID counter used as a fallback when
 * sections don't have explicit HTML id attributes.
 *
 * NOTE: This module contains mutable module-level state by design — it
 * represents a singleton registry that must be consistent across all
 * sections in a single document render. `resetStepRegistry()` must be
 * called when new content loads.
 */

import { resetStepCounter } from './interactive-step';
import { resetMultiStepCounter } from './interactive-multi-step';
import { resetGuidedCounter } from './interactive-guided';
import { resetQuizCounter } from './interactive-quiz';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StepRegistryEntry {
  stepCount: number;
  /** Explicit document-order index used to sort entries when computing offsets.
   *  Entries with lower documentOrder appear first (get lower step offsets). */
  documentOrder: number;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** Simple counter for sequential section IDs */
let interactiveSectionCounter = 0;

/** Registry mapping sectionId → step count + document order */
const globalStepRegistry: Map<string, StepRegistryEntry> = new Map();

/** Total steps across all registered sections */
let totalDocumentSteps = 0;

/** Computed offsets: sectionId → starting step offset */
let documentStepOffsets: Map<string, number> = new Map();

/** Auto-incrementing fallback for entries registered without an explicit documentOrder. */
let autoDocumentOrder = 0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reset all counters and registry state.
 * Must be called when new content loads to prevent stale state.
 */
export function resetStepRegistry(): void {
  interactiveSectionCounter = 0;
  globalStepRegistry.clear();
  totalDocumentSteps = 0;
  documentStepOffsets.clear();
  autoDocumentOrder = 0;
  // Reset anonymous step ID counters across all step types
  resetStepCounter();
  resetMultiStepCounter();
  resetGuidedCounter();
  resetQuizCounter();
}

/**
 * Get the next sequential section ID counter value.
 * Increments the counter each time it is called.
 */
export function nextSectionCounter(): number {
  interactiveSectionCounter++;
  return interactiveSectionCounter;
}

/**
 * Register a section's steps in the global registry (idempotent).
 *
 * `documentOrder` controls how entries are sorted when computing step offsets.
 * ContentProcessor pre-registers ALL entries (sections + standalone) in visual
 * document order *before* children render. When InteractiveSection later re-registers
 * the same sectionId (to update the step count), the original documentOrder is
 * preserved — only the count is updated.
 *
 * Fallback: if no documentOrder is provided and no prior registration exists,
 * an auto-incrementing counter is used so the behaviour degrades gracefully to
 * registration order.
 */
export function registerSectionSteps(
  sectionId: string,
  stepCount: number,
  documentOrder?: number
): { offset: number; total: number } {
  const existing = globalStepRegistry.get(sectionId);
  // Prefer explicit order → existing order → auto-increment fallback
  const order = documentOrder ?? existing?.documentOrder ?? autoDocumentOrder++;
  globalStepRegistry.set(sectionId, { stepCount, documentOrder: order });

  // Sort entries by documentOrder, then recompute offsets from scratch
  const sorted = Array.from(globalStepRegistry.entries()).sort(([, a], [, b]) => a.documentOrder - b.documentOrder);

  let runningTotal = 0;
  documentStepOffsets.clear();
  for (const [secId, entry] of sorted) {
    documentStepOffsets.set(secId, runningTotal);
    runningTotal += entry.stepCount;
  }

  totalDocumentSteps = runningTotal;

  // Return this section's offset and the new total
  const offset = documentStepOffsets.get(sectionId) || 0;
  return { offset, total: totalDocumentSteps };
}

/**
 * Get the total number of interactive steps across all sections (including standalone).
 */
export function getTotalDocumentSteps(): number {
  return totalDocumentSteps;
}

/**
 * Get document-wide position for a step within a section.
 */
export function getDocumentStepPosition(
  sectionId: string,
  sectionStepIndex: number
): { stepIndex: number; totalSteps: number } {
  const offset = documentStepOffsets.get(sectionId) || 0;
  return {
    stepIndex: offset + sectionStepIndex,
    totalSteps: totalDocumentSteps,
  };
}
