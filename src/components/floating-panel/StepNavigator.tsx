import { useState, useMemo, useCallback } from 'react';
import { isJsonGuideContent } from '../../docs-retrieval';
import type { RawContent } from '../../types/content.types';
import type { JsonGuide, JsonBlock } from '../../types/json-guide.types';

/**
 * A single "step" in the wizard view.
 * Each step maps to either one section block or a group of consecutive
 * non-section blocks from the guide's top-level block array.
 */
export interface WizardStep {
  /** Index in the step list (0-based) */
  index: number;
  /** Title for the step (section title or "Introduction"/"Content") */
  title: string;
  /** The blocks that belong to this step */
  blocks: JsonBlock[];
  /** Whether this step is a section (interactive) or freeform content */
  isSection: boolean;
}

/**
 * Parse a guide's block array into wizard steps.
 *
 * Rules:
 * - Each `section` block becomes its own step, titled by the section title
 * - Consecutive non-section blocks are grouped into a single step
 * - The first non-section group is titled "Introduction", subsequent ones "Content"
 */
function buildSteps(blocks: JsonBlock[]): WizardStep[] {
  const steps: WizardStep[] = [];
  let pendingBlocks: JsonBlock[] = [];
  let freeformCount = 0;

  const flushPending = () => {
    if (pendingBlocks.length === 0) {
      return;
    }
    const title = freeformCount === 0 ? 'Introduction' : 'Content';
    freeformCount++;
    steps.push({
      index: steps.length,
      title,
      blocks: pendingBlocks,
      isSection: false,
    });
    pendingBlocks = [];
  };

  for (const block of blocks) {
    if (block.type === 'section') {
      flushPending();
      steps.push({
        index: steps.length,
        title: block.title || `Step ${steps.length + 1}`,
        blocks: [block],
        isSection: true,
      });
    } else {
      pendingBlocks.push(block);
    }
  }

  // Flush any trailing non-section blocks
  flushPending();

  return steps;
}

export interface UseStepNavigatorResult {
  /** All parsed wizard steps */
  steps: WizardStep[];
  /** Currently visible step */
  currentStep: WizardStep | null;
  /** Current step index (0-based) */
  currentStepIndex: number;
  /** Total number of steps */
  totalSteps: number;
  /** Whether we're on the first step */
  isFirst: boolean;
  /** Whether we're on the last step */
  isLast: boolean;
  /** Whether the content has sections (i.e. should use wizard mode) */
  hasInteractiveSections: boolean;
  /** Navigate to next step */
  goNext: () => void;
  /** Navigate to previous step */
  goPrev: () => void;
  /** Navigate to a specific step */
  goTo: (index: number) => void;
}

/**
 * Hook that parses guide content into navigable wizard steps.
 *
 * If the guide has no section blocks (pure documentation), `hasInteractiveSections`
 * is false and the caller should fall back to a scrollable view.
 */
export function useStepNavigator(content: RawContent | null): UseStepNavigatorResult {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const { steps, hasInteractiveSections } = useMemo(() => {
    if (!content?.content) {
      return { steps: [] as WizardStep[], hasInteractiveSections: false };
    }

    // Only JSON guides can be parsed into steps
    if (!isJsonGuideContent(content.content)) {
      return { steps: [] as WizardStep[], hasInteractiveSections: false };
    }

    let guide: JsonGuide;
    try {
      guide = JSON.parse(content.content);
    } catch {
      return { steps: [] as WizardStep[], hasInteractiveSections: false };
    }

    const parsed = buildSteps(guide.blocks);
    const hasSections = parsed.some((s) => s.isSection);
    return { steps: parsed, hasInteractiveSections: hasSections };
  }, [content?.content]);

  // Reset to step 0 when content changes
  useMemo(() => {
    setCurrentStepIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content?.url]);

  const goNext = useCallback(() => {
    setCurrentStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
  }, [steps.length]);

  const goPrev = useCallback(() => {
    setCurrentStepIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const goTo = useCallback(
    (index: number) => {
      setCurrentStepIndex(Math.max(0, Math.min(index, steps.length - 1)));
    },
    [steps.length]
  );

  const clampedIndex = Math.max(0, Math.min(currentStepIndex, steps.length - 1));

  return {
    steps,
    currentStep: steps[clampedIndex] ?? null,
    currentStepIndex: clampedIndex,
    totalSteps: steps.length,
    isFirst: clampedIndex === 0,
    isLast: clampedIndex === steps.length - 1,
    hasInteractiveSections,
    goNext,
    goPrev,
    goTo,
  };
}
