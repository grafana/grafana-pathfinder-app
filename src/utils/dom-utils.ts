import { InteractiveElementData } from '../types/interactive.types';

/**
 * Recursively get all text content from an element and its descendants
 */
export function getAllTextContent(element: Element): string {
  let text = '';
  
  // Process all child nodes
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Add text node content
      text += (node.textContent || '').trim() + ' ';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Recursively get text from child elements
      text += getAllTextContent(node as Element) + ' ';
    }
  }
  
  return text.trim();
}

/**
 * Extract interactive data from a DOM element
 */
export function extractInteractiveDataFromElement(element: HTMLElement): InteractiveElementData {
  const customData: Record<string, string> = {};
  
  // Extract all data-* attributes except the core ones
  Array.from(element.attributes).forEach(attr => {
    if (attr.name.startsWith('data-') && 
        !['data-reftarget', 'data-targetaction', 'data-targetvalue', 'data-requirements', 'data-objectives'].includes(attr.name)) {
      const key = attr.name.substring(5); // Remove 'data-' prefix
      customData[key] = attr.value;
    }
  });

  // Extract core attributes with validation
  const reftarget = element.getAttribute('data-reftarget') || '';
  const targetaction = element.getAttribute('data-targetaction') || '';
  const targetvalue = element.getAttribute('data-targetvalue') || undefined;
  const requirements = element.getAttribute('data-requirements') || undefined;
  const objectives = element.getAttribute('data-objectives') || undefined;
  const textContent = element.textContent?.trim() || undefined;

  // Basic validation: Check if reftarget looks suspicious (only warn on obvious issues)
  if (reftarget && textContent && reftarget === textContent && reftarget.length > 5) {
    console.warn(`⚠️ reftarget "${reftarget}" matches element text - check data-reftarget attribute`);
  }

  return {
    reftarget: reftarget,
    targetaction: targetaction,
    targetvalue: targetvalue,
    requirements: requirements,
    objectives: objectives,
    tagName: element.tagName.toLowerCase(),
    className: element.className || undefined,
    id: element.id || undefined,
    textContent: textContent,
    parentTagName: element.parentElement?.tagName.toLowerCase() || undefined,
    timestamp: Date.now(),
    customData: Object.keys(customData).length > 0 ? customData : undefined,
  };
}

/**
 * Find button elements that contain the specified text (case-insensitive)
 * Prioritizes exact matches over partial matches
 */
export function findButtonByText(targetText: string): HTMLButtonElement[] {
  if (!targetText || typeof targetText !== 'string') {
    return [];
  }

  // In this special case we want to look through the entire document, since for finding
  // buttons we want to click, we have to look outside the docs plugin frame.
  const buttons = document.querySelectorAll('button');
  const searchText = targetText.toLowerCase().trim();
  
  const exactMatches: HTMLButtonElement[] = [];
  const partialMatches: HTMLButtonElement[] = [];
  
  Array.from(buttons).forEach((button) => {
    // Get all text content from the button and its descendants
    const allText = getAllTextContent(button).toLowerCase().trim();
    
    if (!allText) { return; }
    
    if (allText === searchText) {
      // Exact match
      exactMatches.push(button as HTMLButtonElement);
    } else if (allText.includes(searchText)) {
      // Partial match
      partialMatches.push(button as HTMLButtonElement);
    }
  });
  
  // Return exact matches if any exist, otherwise return partial matches
  if (exactMatches.length > 0) {
    console.warn(`🎯 Found ${exactMatches.length} exact matches for "${targetText}"`);
    return exactMatches;
  } else if (partialMatches.length > 0) {
    console.warn(`🔍 Found ${partialMatches.length} partial matches for "${targetText}"`);
    return partialMatches;
  }
  
  return [];
}

/**
 * Reset React's value tracker if present (must be done after setting value)
 */
export function resetValueTracker(targetElement: HTMLElement): void {
  if ((targetElement as any)._valueTracker) {
    (targetElement as any)._valueTracker.setValue('');
  }
} 
