/**
 * Enhanced DOM selector engine with support for complex selectors
 * Provides fallback support for :has() and :contains() pseudo-selectors
 * that aren't universally supported in browsers
 */

export interface SelectorResult {
  elements: HTMLElement[];
  usedFallback: boolean;
  originalSelector: string;
  effectiveSelector?: string;
}

/**
 * Enhanced querySelector that supports complex selectors with fallbacks
 * Handles :has(), :contains(), and other advanced pseudo-selectors
 */
export function querySelectorEnhanced(selector: string): HTMLElement | null {
  const result = querySelectorAllEnhanced(selector);
  return result.elements.length > 0 ? result.elements[0] : null;
}

/**
 * Enhanced querySelectorAll that supports complex selectors with fallbacks
 * Main entry point for complex selector support
 */
export function querySelectorAllEnhanced(selector: string): SelectorResult {
  try {
    // First, try the native browser implementation
    const nativeResult = tryNativeSelector(selector);
    if (nativeResult && nativeResult.length > 0) {
      return {
        elements: Array.from(nativeResult) as HTMLElement[],
        usedFallback: false,
        originalSelector: selector,
      };
    }

    // If native selector worked but found no elements, and it's not a complex selector,
    // return the empty native result without going to complex parsing
    if (nativeResult !== null && !isComplexSelector(selector)) {
      return {
        elements: [],
        usedFallback: false,
        originalSelector: selector,
      };
    }

    // If native selector failed (threw error), check if it's just a simple selector with no elements
    // Don't treat standard CSS selectors as "complex" just because they failed
    if (nativeResult === null && !isComplexSelector(selector)) {
      console.warn(`Native selector failed for standard CSS selector: "${selector}"`);
      return {
        elements: [],
        usedFallback: false,
        originalSelector: selector,
      };
    }

    // If native fails or it's a complex selector (including data-testid selectors we want to trace),
    // parse and handle complex selectors
    return handleComplexSelector(selector);
  } catch (error) {
    console.warn(`Enhanced selector failed for "${selector}":`, error);
    return {
      elements: [],
      usedFallback: true,
      originalSelector: selector,
      effectiveSelector: 'ERROR',
    };
  }
}

/**
 * Check if selector contains complex pseudo-selectors that need special handling
 */
function isComplexSelector(selector: string): boolean {
  return (
    selector.includes(':contains(') ||
    selector.includes(':has(') ||
    selector.includes(':text(') ||
    selector.includes(':nth-match(') ||
    // Treat data-testid selectors as complex to ensure we can debug/trace hierarchy issues
    // especially when they involve parent-child relationships
    (selector.includes('data-testid') && (selector.includes(' ') || selector.includes('>')))
  );
}

/**
 * Try native browser querySelector first
 */
function tryNativeSelector(selector: string): NodeListOf<Element> | null {
  try {
    // Test if browser supports this selector natively
    const testResult = document.querySelectorAll(selector);
    return testResult;
  } catch (error) {
    return null;
  }
}

/**
 * Handle complex selectors that need custom parsing
 */
function handleComplexSelector(selector: string): SelectorResult {
  // Check for :nth-match() first (custom pseudo-selector for getting nth occurrence globally)
  if (selector.includes(':nth-match(')) {
    return handleNthMatchSelector(selector);
  }

  // Check for :has() pseudo-selector (it may contain :contains())
  // Use a more specific pattern to detect top-level :has()
  if (selector.match(/:has\([^)]*\)/)) {
    return handleHasSelector(selector);
  }

  // Check for :contains() pseudo-selector (only if not inside :has())
  if (selector.match(/:contains\([^)]*\)/) && !selector.includes(':has(')) {
    return handleContainsSelector(selector);
  }

  // Check for other custom pseudo-selectors we might want to support
  if (selector.includes(':text(')) {
    return handleTextSelector(selector);
  }

  // Handle data-testid selectors specifically to ensure proper context
  if (selector.includes('data-testid')) {
    return handleTestIdSelector(selector);
  }

  // If no special handling needed but we got here, the native selector must have failed
  // This could be an invalid selector or just a selector with no matches
  // Log more details to help debug
  console.warn(`Unsupported complex selector (no :contains, :has, :text, or :nth-match found): "${selector}"`);
  console.warn('This selector was flagged as complex but has no recognized pseudo-selectors');
  console.warn('It may be corrupted or invalid. Original length:', selector.length);

  return {
    elements: [],
    usedFallback: true,
    originalSelector: selector,
    effectiveSelector: 'UNSUPPORTED',
  };
}

/**
 * Handle :contains() pseudo-selector
 * Example: div[data-cy="wb-list-item"]:contains("checkoutservice")
 */
function handleContainsSelector(selector: string): SelectorResult {
  // Parse :contains() syntax - handle both quoted and unquoted text
  const containsMatch = selector.match(/^(.+?):contains\((['"]?)(.*?)\2\)(.*)$/);

  if (!containsMatch) {
    console.warn(`Invalid :contains() syntax: ${selector}`);
    return {
      elements: [],
      usedFallback: true,
      originalSelector: selector,
      effectiveSelector: 'INVALID_CONTAINS_SYNTAX',
    };
  }

  const [, baseSelector, , searchText] = containsMatch;

  try {
    // Get all elements matching the base selector
    const candidateElements = document.querySelectorAll(baseSelector);
    const matchingElements: HTMLElement[] = [];

    for (const element of candidateElements) {
      // Check if element's text content contains the search text
      const textContent = element.textContent || '';
      if (textContent.toLowerCase().includes(searchText.toLowerCase())) {
        // Element matches the text content requirement
        matchingElements.push(element as HTMLElement);
      }
    }

    return {
      elements: matchingElements,
      usedFallback: true,
      originalSelector: selector,
      effectiveSelector: `${baseSelector} (text contains "${searchText}")`,
    };
  } catch (error) {
    console.warn(`Error processing :contains() selector "${selector}":`, error);
    return {
      elements: [],
      usedFallback: true,
      originalSelector: selector,
      effectiveSelector: 'ERROR_IN_CONTAINS',
    };
  }
}

/**
 * Parse :has() selector with proper parentheses handling
 * Handles nested pseudo-selectors like :contains() within :has()
 */
function parseHasSelector(selector: string): { baseSelector: string; hasSelector: string; afterHas: string } | null {
  const hasIndex = selector.indexOf(':has(');
  if (hasIndex === -1) {
    return null;
  }

  const baseSelector = selector.substring(0, hasIndex);
  let parenCount = 0;
  let hasContent = '';
  let i = hasIndex + 5; // Start after ':has('

  // Find the matching closing parenthesis
  while (i < selector.length) {
    const char = selector[i];
    if (char === '(') {
      parenCount++;
    } else if (char === ')') {
      if (parenCount === 0) {
        // Found the matching closing paren
        break;
      }
      parenCount--;
    }
    hasContent += char;
    i++;
  }

  if (i >= selector.length) {
    // Didn't find matching closing paren
    return null;
  }

  // Get what comes after the :has() part
  const afterHas = selector.substring(i + 1).trim(); // Skip the closing paren and trim whitespace

  return { baseSelector, hasSelector: hasContent, afterHas };
}

/**
 * Handle :has() pseudo-selector with fallback
 * Example: div[data-cy="wb-list-item"]:has(p:contains("checkoutservice"))
 */
function handleHasSelector(selector: string): SelectorResult {
  // First try native :has() support
  try {
    const nativeElements = document.querySelectorAll(selector);
    if (nativeElements.length > 0) {
      return {
        elements: Array.from(nativeElements) as HTMLElement[],
        usedFallback: false,
        originalSelector: selector,
      };
    }
  } catch (error) {
    // Native :has() not supported, use fallback
  }

  // Parse :has() syntax for fallback implementation
  // Handle nested parentheses in :has() content (like :contains() within :has())
  const hasMatch = parseHasSelector(selector);

  if (!hasMatch) {
    console.warn(`Invalid :has() syntax: ${selector}`);
    return {
      elements: [],
      usedFallback: true,
      originalSelector: selector,
      effectiveSelector: 'INVALID_HAS_SYNTAX',
    };
  }

  const { baseSelector, hasSelector, afterHas } = hasMatch;

  // Check if afterHas is another chained pseudo-selector (like :has, :contains, :nth-match)
  // If so, it's a filter condition, not a descendant selector
  const isChainedPseudoSelector =
    afterHas &&
    (afterHas.startsWith(':has(') || afterHas.startsWith(':contains(') || afterHas.startsWith(':nth-match('));

  // If there's a selector after :has() that's NOT a chained pseudo-selector, it's a descendant selector
  const needsNestedSearch = afterHas && afterHas.trim() && !isChainedPseudoSelector;

  try {
    // Get all elements matching the base selector
    const candidateElements = document.querySelectorAll(baseSelector);
    const matchingElements: HTMLElement[] = [];

    for (const element of candidateElements) {
      // Check if element has descendants matching the :has() selector
      let hasDescendant = false;

      // Handle :contains() within :has() - this covers your specific use case
      if (hasSelector.includes(':contains(')) {
        // Parse the inner :contains() manually for :has() context
        const innerContainsMatch = hasSelector.match(/^(.+?):contains\((['\"]?)([^'\"]*)\2\)(.*)$/);
        if (innerContainsMatch) {
          const [, innerBaseSelector, , innerSearchText] = innerContainsMatch;
          try {
            // Find descendants matching the base selector
            const descendants = element.querySelectorAll(innerBaseSelector);
            // Check if any descendant contains the text
            hasDescendant = Array.from(descendants).some((desc) =>
              (desc.textContent || '').toLowerCase().includes(innerSearchText.toLowerCase())
            );
          } catch (error) {
            console.warn(`Error checking inner :contains() selector "${hasSelector}":`, error);
            continue;
          }
        } else {
          // Fallback to treating the whole hasSelector as a contains check
          const containsResult = handleContainsSelector(hasSelector);
          hasDescendant = containsResult.elements.some(
            (descendant) => element.contains(descendant) || element === descendant
          );
        }
      } else {
        // Standard CSS selector within :has()
        try {
          const descendants = element.querySelectorAll(hasSelector);
          hasDescendant = descendants.length > 0;
        } catch (error) {
          console.warn(`Error checking descendant selector "${hasSelector}":`, error);
          continue;
        }
      }

      if (hasDescendant) {
        // Store element temporarily - we may need to apply additional filters
        matchingElements.push(element as HTMLElement);
      }
    }

    // If there's a chained pseudo-selector, filter the matched elements through it
    if (isChainedPseudoSelector) {
      // For chained :has(), we need to check each element individually to see if it ALSO matches the next condition
      // Extract the next :has() condition if present
      if (afterHas.startsWith(':has(')) {
        const nextHasMatch = parseHasSelector(afterHas);
        if (nextHasMatch) {
          const { hasSelector: nextHasSelector, afterHas: remainingSelector } = nextHasMatch;
          const filteredElements: HTMLElement[] = [];

          for (const element of matchingElements) {
            // Check if this element ALSO has descendants matching the next :has() condition
            let alsoHasDescendant = false;

            // Handle :contains() within the next :has()
            if (nextHasSelector.includes(':contains(')) {
              const innerContainsResult = handleContainsSelector(nextHasSelector);
              const matchedDescendants = innerContainsResult.elements.filter(
                (desc) => element.contains(desc) || element === desc
              );
              alsoHasDescendant = matchedDescendants.length > 0;
            } else {
              try {
                const descendants = element.querySelectorAll(nextHasSelector);
                alsoHasDescendant = descendants.length > 0;
              } catch (error) {
                console.warn(`Error checking descendant selector "${nextHasSelector}":`, error);
              }
            }

            if (alsoHasDescendant) {
              filteredElements.push(element);
            }
          }

          // If there's more selector after the second :has(), process it
          if (remainingSelector && remainingSelector.trim()) {
            // Recursively handle remaining selector
            const finalSelector =
              baseSelector + ':has(' + hasSelector + ')' + ':has(' + nextHasSelector + ')' + remainingSelector;
            const finalResult = querySelectorAllEnhanced(finalSelector);
            return finalResult;
          }

          return {
            elements: filteredElements,
            usedFallback: true,
            originalSelector: selector,
            effectiveSelector: `${baseSelector} (has: ${hasSelector}) AND (has: ${nextHasSelector})`,
          };
        }
      }

      // For other chained selectors (:contains, :nth-match), apply them to the current results
      // Build a selector that will match the current elements with the chained condition
      const finalSelector = baseSelector + ':has(' + hasSelector + ')' + afterHas;
      const finalResult = querySelectorAllEnhanced(finalSelector);
      return finalResult;
    }

    // If there's a nested search selector (descendant selector), find elements within containers
    if (needsNestedSearch) {
      const nestedElements: HTMLElement[] = [];
      for (const container of matchingElements) {
        try {
          // Use enhanced selector recursively to support complex selectors in afterHas
          const nestedResult = querySelectorAllEnhanced(afterHas.trim());
          // Filter to only elements that are descendants of the current container
          const nestedInContainer = nestedResult.elements.filter(
            (nested) => container.contains(nested) && container !== nested
          );
          nestedElements.push(...nestedInContainer);
        } catch (nestedError) {
          console.warn(`Error applying nested selector "${afterHas}":`, nestedError);
        }
      }
      return {
        elements: nestedElements,
        usedFallback: true,
        originalSelector: selector,
        effectiveSelector: `${baseSelector} (has descendant: ${hasSelector}) ${afterHas}`,
      };
    }

    return {
      elements: matchingElements,
      usedFallback: true,
      originalSelector: selector,
      effectiveSelector: `${baseSelector} (has descendant: ${hasSelector})`,
    };
  } catch (error) {
    console.warn(`Error processing :has() selector "${selector}":`, error);
    return {
      elements: [],
      usedFallback: true,
      originalSelector: selector,
      effectiveSelector: 'ERROR_IN_HAS',
    };
  }
}

/**
 * Handle :text() pseudo-selector (custom extension)
 * Example: button:text("Save Dashboard")
 */
function handleTextSelector(selector: string): SelectorResult {
  const textMatch = selector.match(/^(.+?):text\((['"]?)([^'"]*)\2\)(.*)$/);

  if (!textMatch) {
    return {
      elements: [],
      usedFallback: true,
      originalSelector: selector,
      effectiveSelector: 'INVALID_TEXT_SYNTAX',
    };
  }

  const [, baseSelector, , searchText] = textMatch;

  try {
    const candidateElements = document.querySelectorAll(baseSelector);
    const matchingElements: HTMLElement[] = [];

    for (const element of candidateElements) {
      // Check direct text content (not descendants)
      const directText = Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || '')
        .join('')
        .trim();

      if (directText.toLowerCase().includes(searchText.toLowerCase())) {
        matchingElements.push(element as HTMLElement);
      }
    }

    return {
      elements: matchingElements,
      usedFallback: true,
      originalSelector: selector,
      effectiveSelector: `${baseSelector} (direct text contains "${searchText}")`,
    };
  } catch (error) {
    console.warn(`Error processing :text() selector "${selector}":`, error);
    return {
      elements: [],
      usedFallback: true,
      originalSelector: selector,
      effectiveSelector: 'ERROR_IN_TEXT',
    };
  }
}

/**
 * Handle data-testid selectors with enhanced validation
 * Ensures that parent-child relationships are respected
 */
function handleTestIdSelector(selector: string): SelectorResult {
  // 1. Try native selector first as it's the most reliable for standard CSS
  try {
    const nativeResult = document.querySelectorAll(selector);
    if (nativeResult.length > 0) {
      return {
        elements: Array.from(nativeResult) as HTMLElement[],
        usedFallback: false,
        originalSelector: selector,
      };
    }
  } catch (error) {
    console.warn(`Native selector failed for testid selector: "${selector}"`, error);
  }

  // 2. Fallback: If selector uses strict child combinator (>), try relaxing to descendant (space)
  // This handles cases where intermediate divs (wrappers) exist but were missed by the generator
  // e.g. "section > a" fails because of "section > div > a"
  if (selector.includes('>')) {
    const relaxedSelector = selector.replace(/\s*>\s*/g, ' ');

    try {
      const relaxedResult = document.querySelectorAll(relaxedSelector);
      if (relaxedResult.length > 0) {
        return {
          elements: Array.from(relaxedResult) as HTMLElement[],
          usedFallback: true,
          originalSelector: selector,
          effectiveSelector: relaxedSelector,
        };
      }
    } catch (e) {
      // Ignore relaxed attempt errors
    }
  }

  // 3. If native failed or we want to be smarter about "wrong element" detection
  // If the selector is a loose descendant selector "A B", try stricter "A > B" if appropriate?
  if (selector.includes(' ') && !selector.includes('>') && selector.includes('data-testid')) {
    // Attempt to "tighten" the selector to a direct child if it helps
    const strictSelector = selector.replace(' ', ' > ');
    try {
      const strictResult = document.querySelectorAll(strictSelector);
      if (strictResult.length > 0) {
        return {
          elements: Array.from(strictResult) as HTMLElement[],
          usedFallback: true, // We modified the logic
          originalSelector: selector,
          effectiveSelector: strictSelector,
        };
      }
    } catch (e) {
      // Ignore strict attempt errors
    }
  }

  // If native failed, return empty result (we could add manual traversal here if needed)
  return {
    elements: [],
    usedFallback: true,
    originalSelector: selector,
    effectiveSelector: 'TESTID_NOT_FOUND',
  };
}

/**
 * Test if browser supports :has() natively
 * Internal helper - not part of public API
 */
function supportsHasSelector(): boolean {
  try {
    // Create a test element structure
    const testContainer = document.createElement('div');
    const testChild = document.createElement('p');
    testChild.textContent = 'test';
    testContainer.appendChild(testChild);
    document.body.appendChild(testContainer);

    // Try to use :has() selector
    const result = document.querySelector('div:has(p)');

    // Clean up
    document.body.removeChild(testContainer);

    return !!result;
  } catch (error) {
    return false;
  }
}

/**
 * Test if browser supports specific CSS features
 */
export function getBrowserSelectorSupport() {
  return {
    hasSelector: supportsHasSelector(),
    containsSelector: false, // :contains() is never supported in native CSS
    version: navigator.userAgent,
  };
}

/**
 * Custom pseudo-selector :nth-match(n) - selects the nth element matching the selector
 *
 * This is different from :nth-child(n) which only matches if the element is the nth child of its parent.
 * :nth-match(n) finds all elements matching the base selector, then returns the nth one.
 *
 * Example: div[data-testid="uplot-main-div"]:nth-match(3) finds the 3rd div with that testid anywhere
 *
 * @param selector - Base selector with :nth-match(n) pseudo-selector
 * @returns SelectorResult with the nth matching element
 */
function handleNthMatchSelector(selector: string): SelectorResult {
  const nthMatchPattern = /^(.+?):nth-match\((\d+)\)(.*)$/;
  const match = selector.match(nthMatchPattern);

  if (!match) {
    console.warn(`Invalid :nth-match() syntax: ${selector}`);
    return {
      elements: [],
      usedFallback: true,
      originalSelector: selector,
      effectiveSelector: 'INVALID_NTH_MATCH_SYNTAX',
    };
  }

  const [, baseSelector, indexStr, afterMatch] = match;
  const index = parseInt(indexStr, 10);

  if (isNaN(index) || index < 1) {
    console.warn(`Invalid :nth-match() index: ${indexStr}. Must be a positive integer.`);
    return {
      elements: [],
      usedFallback: true,
      originalSelector: selector,
      effectiveSelector: 'INVALID_NTH_MATCH_INDEX',
    };
  }

  try {
    // Find all elements matching the base selector
    // Use enhanced selector recursively to support complex selectors like :has() and :contains()
    const baseSelectorResult = querySelectorAllEnhanced(baseSelector);
    const allElements = baseSelectorResult.elements;

    if (allElements.length < index) {
      // Not enough elements found
      return {
        elements: [],
        usedFallback: true,
        originalSelector: selector,
        effectiveSelector: `${baseSelector} (wanted ${index}, found ${allElements.length})`,
      };
    }

    // Get the nth element (1-indexed)
    const targetElement = allElements[index - 1];

    // If there's a selector after :nth-match(), find elements within the target
    if (afterMatch && afterMatch.trim()) {
      try {
        const nestedElements = targetElement.querySelectorAll(afterMatch.trim());
        return {
          elements: Array.from(nestedElements) as HTMLElement[],
          usedFallback: true,
          originalSelector: selector,
          effectiveSelector: `${baseSelector} (${index}th match) ${afterMatch}`,
        };
      } catch (nestedError) {
        console.warn(`Error applying nested selector "${afterMatch}":`, nestedError);
        return {
          elements: [targetElement],
          usedFallback: true,
          originalSelector: selector,
          effectiveSelector: `${baseSelector} (${index}th match)`,
        };
      }
    }

    return {
      elements: [targetElement],
      usedFallback: true,
      originalSelector: selector,
      effectiveSelector: `${baseSelector} (${index}th match)`,
    };
  } catch (error) {
    console.warn(`Error processing :nth-match() selector "${selector}":`, error);
    return {
      elements: [],
      usedFallback: true,
      originalSelector: selector,
      effectiveSelector: 'ERROR_IN_NTH_MATCH',
    };
  }
}

// ============================================================================
// Visibility-Aware Matching
// ============================================================================

/**
 * Check if an element is currently displayed in the DOM.
 * This is a basic visibility check focused on CSS display properties.
 * For more comprehensive visibility checking (including ancestors),
 * use isElementVisible from element-validator.ts.
 *
 * An element is considered displayed if:
 * - display is not 'none'
 * - visibility is not 'hidden'
 * - opacity is not '0'
 * - element has a layout (offsetParent is not null, unless it's fixed/sticky positioned)
 *
 * @param element - The element to check
 * @returns true if the element is displayed
 */
function isElementDisplayed(element: HTMLElement): boolean {
  if (!element) {
    return false;
  }

  // Check if element is in the DOM
  if (!element.isConnected) {
    return false;
  }

  const style = window.getComputedStyle(element);

  // Check display
  if (style.display === 'none') {
    return false;
  }

  // Check visibility
  if (style.visibility === 'hidden') {
    return false;
  }

  // Check opacity
  if (style.opacity === '0') {
    return false;
  }

  // Check if element has layout (offsetParent check)
  // Note: offsetParent is null for fixed/sticky positioned elements, so check those separately
  const position = style.position;
  if (element.offsetParent === null && position !== 'fixed' && position !== 'sticky') {
    // Could be hidden or not in layout - check if it has dimensions
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return false;
    }
  }

  return true;
}

/**
 * Enhanced querySelectorAll that returns only visible elements.
 * Useful for overlay/portal contexts where hidden duplicates may exist in the DOM.
 *
 * @param selector - CSS selector (supports enhanced pseudo-selectors)
 * @returns SelectorResult with only visible elements
 */
export function querySelectorAllEnhancedVisible(selector: string): SelectorResult {
  const result = querySelectorAllEnhanced(selector);
  const visibleElements = result.elements.filter(isElementDisplayed);

  return {
    ...result,
    elements: visibleElements,
    effectiveSelector: result.effectiveSelector
      ? `${result.effectiveSelector} (visible only)`
      : `${selector} (visible only)`,
  };
}

/**
 * Count visible matches for a selector.
 * Useful for uniqueness checking in overlay contexts.
 *
 * @param selector - CSS selector (supports enhanced pseudo-selectors)
 * @returns Number of visible elements matching the selector
 */
export function countVisibleMatches(selector: string): number {
  const result = querySelectorAllEnhancedVisible(selector);
  return result.elements.length;
}
