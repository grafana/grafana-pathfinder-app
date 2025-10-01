export type InteractiveActionType =
  | 'button'
  | 'highlight'
  | 'formfill'
  | 'navigate'
  | 'hover'
  | 'sequence'
  | 'multistep'
  | 'guided'; // User-performed actions with detection

export interface InteractiveElementData {
  // Core interactive attributes
  reftarget: string;
  targetaction: string;
  targetvalue?: string;
  targetcomment?: string;
  requirements?: string;
  objectives?: string;
  skippable?: boolean; // Whether this step can be skipped if requirements fail

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
