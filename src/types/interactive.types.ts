export interface InteractiveElementData {
  // Core interactive attributes
  reftarget: string;
  targetaction: string;
  targetvalue?: string;
  requirements?: string;
  objectives?: string;
  
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
