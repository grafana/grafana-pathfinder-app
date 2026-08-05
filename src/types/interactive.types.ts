export type InteractiveActionType =
  | 'button'
  | 'highlight'
  | 'formfill'
  | 'navigate'
  | 'hover'
  | 'sequence'
  | 'multistep'
  | 'guided' // User-performed actions with detection
  | 'popout'; // Toggle the docs panel between sidebar and floating modes

export interface InteractiveElementData {
  // Core interactive attributes
  refTarget: string;
  targetAction: string;
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

/**
 * Everything `executeInteractiveAction` needs, bundled by reference.
 *
 * Callers pass the step object they already hold, so a new field reaches the
 * engine by being on the step rather than by being threaded through every
 * caller. The previous positional list silently degraded a toggle step to
 * blind clicking whenever a call site forgot the tail argument.
 */
export type InteractiveActionRequest = Pick<InteractiveElementData, 'targetAction'> &
  Partial<Pick<InteractiveElementData, 'refTarget' | 'targetValue' | 'targetState' | 'targetComment'>> & {
    buttonType?: 'show' | 'do';
  };
