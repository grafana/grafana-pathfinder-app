/**
 * Hugo shortcode export utilities
 * Converts recorded steps from the debug panel into Hugo shortcode format
 */

import type { RecordedStep } from './tutorial-exporter';

export interface HugoExportOptions {
  includeComments?: boolean;
  wrapInSequence?: boolean;
  sequenceId?: string;
  sequenceTitle?: string;
  sequenceDescription?: string;
}

/**
 * Convert recorded steps to Hugo shortcode format
 */
export function exportStepsToHugoShortcodes(steps: RecordedStep[], options: HugoExportOptions = {}): string {
  const {
    includeComments = true,
    wrapInSequence = true,
    sequenceId = 'tutorial-sequence',
    sequenceTitle = 'Tutorial Section',
    sequenceDescription,
  } = options;

  let output = '';

  if (wrapInSequence) {
    output += `## ${sequenceTitle}\n\n`;
    
    if (sequenceDescription) {
      output += `${sequenceDescription}\n\n`;
    }
    
    output += `{{< sequence id="${escapeShortcodeValue(sequenceId)}" >}}\n\n`;
  }

  for (const step of steps) {
    output += formatStepAsHugoShortcode(step, includeComments);
  }

  if (wrapInSequence) {
    output += `{{< /sequence >}}\n`;
  }

  return output;
}

/**
 * Format a single step as Hugo shortcode
 */
function formatStepAsHugoShortcode(step: RecordedStep, includeComments: boolean): string {
  let output = '';

  if (includeComments && !step.isUnique && step.matchCount) {
    output += `<!-- Warning: Non-unique selector (${step.matchCount} matches) -->\n`;
  }

  if (step.action === 'multistep') {
    output += formatMultistepAsHugoShortcode(step);
    return output;
  }

  const shortcodeName = getShortcodeNameForAction(step.action);
  
  const params = buildShortcodeParams(step);
  
  output += `{{< ${shortcodeName}${params} >}}\n`;
  output += `${step.description}\n`;
  output += `{{< /${shortcodeName} >}}\n\n`;

  return output;
}

/**
 * Format a multistep as Hugo shortcode
 * Note: Multisteps store their HTML in the selector field when combined
 */
function formatMultistepAsHugoShortcode(step: RecordedStep): string {
  let output = '';

  output += `{{< multistep >}}\n`;
  output += `${step.description}\n`;
  output += `{{< /multistep >}}\n\n`;

  return output;
}

/**
 * Get Hugo shortcode name for action type
 */
function getShortcodeNameForAction(action: string): string {
  const mapping: Record<string, string> = {
    'button': 'button',
    'formfill': 'formfill',
    'highlight': 'highlight',
    'navigate': 'navigate',
    'multistep': 'multistep',
  };

  return mapping[action] || action;
}

/**
 * Build shortcode parameters from step data
 */
function buildShortcodeParams(step: RecordedStep): string {
  const params: string[] = [];

  // reftarget is required for most actions
  if (step.selector) {
    params.push(`reftarget="${escapeShortcodeValue(step.selector)}"`);
  }

  // targetvalue is required for formfill
  if (step.value !== undefined && step.value !== '') {
    params.push(`targetvalue="${escapeShortcodeValue(step.value)}"`);
  }

  if (params.length === 0) {
    return '';
  }

  return ' ' + params.join(' ');
}

/**
 * Escape values for use in Hugo shortcode parameters
 * Converts double quotes to single quotes to avoid escaping in shortcode attributes
 */
function escapeShortcodeValue(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, "'");
}

/**
 * Convert a single step DSL string (action|selector|value) to Hugo shortcode
 */
export function dslToHugoShortcode(dsl: string, description?: string): string {
  const parts = dsl.split('|').map(p => p.trim());
  
  if (parts.length < 2) {
    return `<!-- Invalid DSL format: ${dsl} -->`;
  }

  const action = parts[0];
  const selector = parts[1];
  const value = parts[2] || undefined;

  const step: RecordedStep = {
    action,
    selector,
    value,
    description: description || `Perform ${action} action`,
    isUnique: true,
  };

  return formatStepAsHugoShortcode(step, false);
}

/**
 * Convert multiple DSL strings to Hugo shortcodes
 */
export function dslListToHugoShortcodes(dslList: string[], options: HugoExportOptions = {}): string {
  const steps: RecordedStep[] = dslList.map((dsl, index) => {
    const parts = dsl.split('|').map(p => p.trim());
    
    if (parts.length < 2) {
      return {
        action: 'comment',
        selector: '',
        description: `Invalid DSL: ${dsl}`,
        isUnique: true,
      };
    }

    const action = parts[0];
    const selector = parts[1];
    const value = parts[2] || undefined;

    return {
      action,
      selector,
      value,
      description: `Step ${index + 1}: ${action} ${selector}`,
      isUnique: true,
    };
  });

  return exportStepsToHugoShortcodes(steps, options);
}

/**
 * Format steps to string DSL format (action|selector|value)
 * This is the inverse operation of parsing DSL strings
 */
export function formatStepsToHugoDSL(steps: RecordedStep[]): string {
  return steps
    .map((step) => {
      const valuePart = step.value ? `|${step.value}` : '|';
      return `${step.action}|${step.selector}${valuePart}`;
    })
    .join('\n');
}

