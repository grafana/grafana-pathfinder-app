export const INTERACTIVE_ACTION_TYPES = [
  'button',
  'highlight',
  'formfill',
  'navigate',
  'hover',
  'sequence',
  'multistep',
  'guided',
  'popout',
  'noop',
] as const;

export type InteractiveActionType = (typeof INTERACTIVE_ACTION_TYPES)[number];

export interface InteractiveElementData {
  // Core interactive attributes
  refTarget: string;
  targetAction: InteractiveActionType;
  targetValue?: string;
  /** Desired end state for a toggle target; see `lib/dom/toggle-state`. */
  targetState?: boolean | string;
  targetComment?: string;
  requirements?: string;
  objectives?: string;
  skippable?: boolean; // Whether this step can be skipped if requirements fail

  // Lazy render support for virtualized containers
  lazyRender?: boolean; // Enable progressive scroll discovery
  scrollContainer?: string; // CSS selector for scroll container (default: ".scrollbar-view")

  // Navigate: guide opening
  openGuide?: string; // Guide to open in sidebar after navigation (e.g., "bundled:my-guide")

  // Full-screen → sidebar handoff (see interactive-engine/interactive.hook.ts)
  /** Resolved step/milestone/course location to navigate to as part of the handoff. Absent when none could be resolved. */
  fullScreenFallbackLocation?: string;
  /**
   * Skip `markAsCompleted` when the target wasn't found, instead of completing
   * anyway. Set only on the full-screen handoff path above — navigation there
   * has latency, so a target that isn't found yet shouldn't be reported done.
   */
  skipCompletionOnEmptyTarget?: boolean;
  /**
   * Set by a handler (never by a caller) when it took the `skipCompletionOnEmptyTarget`
   * branch above. `executeInteractiveAction` reads this after the handler
   * returns to report `'error'` instead of `'ok'` — otherwise the caller's own
   * completion persistence (gated on the outcome, not on this internal signal)
   * would mark the step done anyway.
   */
  completionSuppressed?: boolean;

  // Element context
  tagName: string;
  className?: string;
  id?: string;
  textContent?: string;

  // Position/hierarchy context
  elementPath?: string; // CSS selector path to element
  parentTagName?: string;

  // Timing context
  timestamp?: number;

  // Custom data attributes (extensible)
  customData?: Record<string, string>;
}

/** Requirements also serve component-owned pseudo-actions such as `section`. */
export type InteractiveRequirementsData = Omit<InteractiveElementData, 'targetAction'> & { targetAction: string };

/**
 * Everything `executeInteractiveAction` needs, bundled by reference.
 *
 * Callers pass the step object they already hold, so a new field reaches the
 * engine by being on the step rather than by being threaded through every
 * caller. The previous positional list silently degraded a toggle step to
 * blind clicking whenever a call site forgot the tail argument.
 */
export type InteractiveActionRequest = Pick<InteractiveElementData, 'targetAction'> &
  Partial<
    Pick<
      InteractiveElementData,
      'refTarget' | 'targetValue' | 'targetState' | 'targetComment' | 'openGuide' | 'fullScreenFallbackLocation'
    >
  > & {
    buttonType?: 'show' | 'do';
  };
