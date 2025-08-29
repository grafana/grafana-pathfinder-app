export interface InteractiveElementData {
  // Core interactive attributes
  reftarget: string;
  targetaction: string;
  targetvalue?: string;
  targetcomment?: string;
  requirements?: string;
  objectives?: string;
  skipable?: boolean; // Whether this step can be skipped if requirements fail

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
