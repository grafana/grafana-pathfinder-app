/**
 * Website Shortcode Export Utilities
 * Converts recorded steps from the debug panel into shortcode format
 * for use in Grafana documentation website
 */

import type { RecordedStep } from './devtools';

export interface WebsiteExportOptions {
  includeComments?: boolean;
  includeHints?: boolean;
  wrapInSequence?: boolean;
  sequenceId?: string;
}

/**
 * Map internal action names to shortcode names
 */
const ACTION_TO_SHORTCODE: Record<string, string> = {
  button: 'interactive/button',
  highlight: 'interactive/highlight',
  formfill: 'interactive/formfill',
  navigate: 'interactive/navigate',
  hover: 'interactive/hover',
  comment: 'interactive/comment',
  guided: 'interactive/guided',
  multistep: 'interactive/multistep',
  sequence: 'interactive/sequence',
  noop: 'interactive/noop',
  ignore: 'interactive/ignore',
};

/**
 * Convert recorded steps to website shortcode format
 */
export function exportStepsForWebsite(steps: RecordedStep[], options: WebsiteExportOptions = {}): string {
  const {
    includeComments = true,
    includeHints = false,
    wrapInSequence = true,
    sequenceId = 'tutorial-section',
  } = options;

  let output = '';

  if (wrapInSequence) {
    output += `{{< interactive/sequence id="${sequenceId}" >}}\n\n`;
  }

  for (const step of steps) {
    output += formatStepForWebsite(step, includeComments, includeHints);
  }

  if (wrapInSequence) {
    output += `{{< /interactive/sequence >}}\n`;
  }

  return output;
}

/**
 * Format a single step as a website shortcode
 */
function formatStepForWebsite(step: RecordedStep, includeComments: boolean, includeHints: boolean): string {
  let output = '';

  // Add comment about selector quality if not unique
  if (includeComments && !step.isUnique && step.matchCount) {
    output += `<!-- Warning: Non-unique selector (${step.matchCount} matches) -->\n`;
  }

  if (step.action === 'multistep') {
    return formatMultistepForWebsite(step, includeComments);
  }

  const shortcodeName = ACTION_TO_SHORTCODE[step.action] || step.action;

  output += `{{< ${shortcodeName}`;
  if (step.selector && step.action !== 'comment' && step.action !== 'noop') {
    output += ` reftarget="${convertToSingleQuotes(step.selector)}"`;
  }
  if (step.value && step.action === 'formfill') {
    output += ` targetvalue="${convertToSingleQuotes(step.value)}"`;
  }
  if (includeHints && !step.isUnique && step.matchCount && step.matchCount > 1) {
    output += ` hint="This selector matches ${step.matchCount} elements. Make sure you're targeting the right one."`;
  }
  output += ' >}}\n';
  output += `${step.description}\n`;
  output += `{{< /${shortcodeName} >}}\n\n`;

  return output;
}

/**
 * Format a multistep structure as website shortcodes
 * The multistep action stores its substeps as HTML in the selector field
 */
function formatMultistepForWebsite(step: RecordedStep, _includeComments: boolean): string {
  let output = '';
  const multistepShortcode = ACTION_TO_SHORTCODE['multistep'];

  output += `{{< ${multistepShortcode} >}}\n`;
  output += `${step.description}\n`;

  if (step.selector) {
    const substeps = parseMultistepHTML(step.selector);

    for (const substep of substeps) {
      const shortcodeName = ACTION_TO_SHORTCODE[substep.action] || substep.action;

      output += `{{< ${shortcodeName}`;
      if (substep.selector) {
        output += ` reftarget="${convertToSingleQuotes(substep.selector)}"`;
      }
      if (substep.value) {
        output += ` targetvalue="${convertToSingleQuotes(substep.value)}"`;
      }
      output += ' >}}';
      output += `{{< /${shortcodeName} >}}\n`;
    }
  }

  output += `{{< /${multistepShortcode} >}}\n\n`;

  return output;
}

/**
 * Parse multistep HTML to extract substeps
 * Multistep HTML format: <li class="interactive" data-targetaction="multistep">
 *   <span class="interactive" data-targetaction="..." data-reftarget="..." data-targetvalue="..."></span>
 *   Description
 * </li>
 */
function parseMultistepHTML(html: string): Array<{ action: string; selector: string; value?: string }> {
  const substeps: Array<{ action: string; selector: string; value?: string }> = [];

  const spanRegex = /<span[^>]*class="interactive"[^>]*>/gi;
  const matches = html.matchAll(spanRegex);

  for (const match of matches) {
    const spanTag = match[0];

    // Extract attributes - handle both single and double quoted values
    // For single-quoted: match until closing single quote
    // For double-quoted: match until closing double quote
    const actionMatch = spanTag.match(/data-targetaction=(['"])(.+?)\1/);
    const action = actionMatch ? actionMatch[2] : '';

    const selectorMatch = spanTag.match(/data-reftarget=(['"])(.+?)\1/);
    const selector = selectorMatch ? unescapeHtml(selectorMatch[2]) : '';

    const valueMatch = spanTag.match(/data-targetvalue=(['"])(.+?)\1/);
    const value = valueMatch ? unescapeHtml(valueMatch[2]) : undefined;

    if (action && selector) {
      substeps.push({ action, selector, value });
    }
  }

  return substeps;
}

/**
 * Unescape HTML entities
 */
function unescapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&#039;': "'",
    '&quot;': '"',
  };
  return text.replace(/&[^;]+;/g, (entity) => map[entity] || entity);
}

/**
 * Convert double quotes to single quotes for use in shortcode parameters.
 * Since shortcode arguments are wrapped in double quotes, inner quotes must be single quotes.
 */
function convertToSingleQuotes(text: string): string {
  return text.replace(/"/g, "'");
}

/**
 * Export a single step as a website shortcode (for simple selector tester)
 */
export function exportSingleStepForWebsite(
  action: string,
  selector: string,
  value?: string,
  description?: string
): string {
  const step: RecordedStep = {
    action,
    selector,
    value,
    description: description || `Perform ${action} action`,
    isUnique: true,
  };

  return formatStepForWebsite(step, false, false);
}
