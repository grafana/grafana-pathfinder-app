/**
 * Module-level step registry for interactive sections.
 *
 * Tracks every `InteractiveSection` mounted in the current document so
 * that step counters and document-wide step positions ("step 3 of 12")
 * remain consistent across sections. Sections register themselves with
 * `registerSectionSteps`; the consumer ContentProcessor pre-registers
 * every section in visual document order before children render, and
 * the section re-registers (idempotently) once its child count is
 * known.
 *
 * State here is intentionally module-scope mutable. It survives across
 * React renders within a single document, and `resetRegistry()` is
 * called by `resetInteractiveCounters()` whenever new content loads.
 *
 * Public functions exposed from `interactive-section.tsx` for
 * back-compat (`registerSectionSteps`, `getTotalDocumentSteps`,
 * `getDocumentStepPosition`) are re-exported there as well so existing
 * importers (`content-renderer.tsx`) do not need to change.
 */

/** One section's entry in the global step registry. */
export interface StepRegistryEntry {
  stepCount: number;
  /** Explicit document-order index used to sort entries when computing
   *  offsets. Entries with lower documentOrder appear first (get lower
   *  step offsets). */
  documentOrder: number;
}

// Counter for sequential section IDs when authors don't provide an
// explicit HTML `id` attribute.
let interactiveSectionCounter = 0;

const globalStepRegistry: Map<string, StepRegistryEntry> = new Map();
let totalDocumentSteps = 0;
const documentStepOffsets: Map<string, number> = new Map();

/** Auto-incrementing fallback for entries registered without an explicit
 *  documentOrder. Ensures registration-order acts as document-order
 *  when callers don't provide explicit ordering. */
let autoDocumentOrder = 0;

/** Reset every counter, map, and offset to a pristine state.
 *  Call when loading new content. Step-type-specific anonymous ID
 *  counters live in their own modules and are reset alongside this
 *  call via `resetInteractiveCounters()` in `interactive-section.tsx`. */
export function resetRegistry(): void {
  interactiveSectionCounter = 0;
  globalStepRegistry.clear();
  totalDocumentSteps = 0;
  documentStepOffsets.clear();
  autoDocumentOrder = 0;
}

/** Increment and return the next sequential section counter. Used as a
 *  fallback section-ID generator when the author has not provided an
 *  explicit `id` attribute on the section. */
export function nextSectionCounter(): number {
  interactiveSectionCounter++;
  return interactiveSectionCounter;
}

/**
 * Register a section's steps in the global registry (idempotent).
 *
 * `documentOrder` controls how entries are sorted when computing step
 * offsets. ContentProcessor pre-registers ALL entries (sections +
 * standalone) in visual document order *before* children render. When
 * `InteractiveSection` later re-registers the same sectionId (to
 * update the step count), the original `documentOrder` is preserved —
 * only the count is updated.
 *
 * Fallback: if no `documentOrder` is provided and no prior registration
 * exists, an auto-incrementing counter is used so the behaviour
 * degrades gracefully to registration order.
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

  // Sort entries by documentOrder, then recompute offsets from scratch.
  const sorted = Array.from(globalStepRegistry.entries()).sort(([, a], [, b]) => a.documentOrder - b.documentOrder);

  let runningTotal = 0;
  documentStepOffsets.clear();
  for (const [secId, entry] of sorted) {
    documentStepOffsets.set(secId, runningTotal);
    runningTotal += entry.stepCount;
  }

  totalDocumentSteps = runningTotal;

  // Return this section's offset and the new total.
  const offset = documentStepOffsets.get(sectionId) || 0;
  return { offset, total: totalDocumentSteps };
}

/** Total number of interactive steps across every registered section
 *  (including standalone). Read fresh at call time — this is a
 *  module-level mutable counter, not React state. */
export function getTotalDocumentSteps(): number {
  return totalDocumentSteps;
}

/** Document-wide position of a step within a section.
 *  Returns `{ stepIndex: offset + sectionStepIndex, totalSteps: totalDocumentSteps }`.
 *  For unknown sectionIds, offset defaults to 0 (preserving the
 *  pre-extraction `|| 0` fallback). */
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
