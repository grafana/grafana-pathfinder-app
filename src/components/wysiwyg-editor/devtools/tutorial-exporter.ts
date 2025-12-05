/**
 * Tutorial HTML export utilities
 * Converts recorded steps from the debug panel into tutorial-ready HTML format
 */

export interface RecordedStep {
  action: string;
  selector: string;
  value?: string;
  description: string;
  isUnique?: boolean;
  matchCount?: number;
  contextStrategy?: string;
  /** If set, this step is part of a group (e.g., modal interaction) */
  groupId?: string;
}

export interface MultistepGroup {
  type: 'multistep';
  steps: RecordedStep[];
  description: string;
}

export type ExportStep = RecordedStep | MultistepGroup;

export interface ExportOptions {
  includeComments?: boolean;
  includeHints?: boolean;
  wrapInSection?: boolean;
  sectionId?: string;
  sectionTitle?: string;
  sectionDescription?: string;
}

/**
 * Convert recorded steps to tutorial HTML format
 */
export function exportStepsToHTML(steps: RecordedStep[], options: ExportOptions = {}): string {
  const {
    includeComments = true,
    includeHints = true,
    wrapInSection = true,
    sectionId = 'tutorial-section',
    sectionTitle = 'Tutorial Section',
    sectionDescription,
  } = options;

  let html = '';
  const indent = wrapInSection ? 12 : 8;

  if (wrapInSection) {
    html += `        <h2>${escapeHtml(sectionTitle)}</h2>\n\n`;
    if (sectionDescription) {
      html += `        <p>${escapeHtml(sectionDescription)}</p>\n\n`;
    }
    html += `        <span id="${sectionId}"\n`;
    html += `              class="interactive"\n`;
    html += `              data-targetaction="sequence"\n`;
    html += `              data-reftarget="span#${sectionId}">\n`;
    html += `            <ul>\n`;
  }

  for (const step of steps) {
    html += formatStepAsHTML(step, indent, includeComments, includeHints);
  }

  if (wrapInSection) {
    html += `            </ul>\n`;
    html += `        </span>\n`;
  }

  return html;
}

/**
 * Format a single step as HTML
 */
function formatStepAsHTML(step: RecordedStep, indent: number, includeComments: boolean, includeHints: boolean): string {
  const indentStr = ' '.repeat(indent);
  let html = '';

  // Add comment about selector quality if not unique
  if (includeComments && !step.isUnique && step.matchCount) {
    html += `${indentStr}<!-- Warning: Non-unique selector (${step.matchCount} matches) -->\n`;
  }

  html += `${indentStr}<li class="interactive"\n`;
  html += `${indentStr}    data-targetaction='${escapeAttribute(step.action)}'\n`;
  html += `${indentStr}    data-reftarget='${escapeAttribute(step.selector)}'`;

  // Add value for formfill actions
  if (step.value) {
    html += `\n${indentStr}    data-targetvalue='${escapeAttribute(step.value)}'`;
  }

  html += `>\n`;

  // Add interactive comment span if enabled
  if (includeComments) {
    html += `${indentStr}    <span class="interactive-comment">\n`;
    html += `${indentStr}        <!-- Add explanation about what this step does and why -->\n`;
    html += `${indentStr}    </span>\n`;
  }

  // Add description
  html += `${indentStr}    ${escapeHtml(step.description)}\n`;
  html += `${indentStr}</li>\n\n`;

  return html;
}

/**
 * Convert selected steps into a multistep structure
 */
export function combineStepsIntoMultistep(
  allSteps: RecordedStep[],
  selectedIndices: number[],
  description: string
): RecordedStep[] {
  if (selectedIndices.length < 2) {
    return allSteps;
  }

  // Sort indices to maintain order
  const sortedIndices = [...selectedIndices].sort((a, b) => a - b);

  // Create the multistep structure
  const multistepHtml = formatMultistepAsHTML(
    sortedIndices.map((i) => allSteps[i]),
    description
  );

  // Build new steps array with multistep in place
  const newSteps: RecordedStep[] = [];

  for (let i = 0; i < allSteps.length; i++) {
    if (i === sortedIndices[0]) {
      // Insert multistep at first selected position
      newSteps.push({
        action: 'multistep',
        selector: multistepHtml,
        description: description || 'Combined steps',
        isUnique: true,
      });
    } else if (!sortedIndices.includes(i)) {
      // Include non-selected steps
      newSteps.push(allSteps[i]);
    }
  }

  return newSteps;
}

/**
 * Format multiple steps as a multistep structure
 */
function formatMultistepAsHTML(steps: RecordedStep[], description: string): string {
  let html = '<li class="interactive" data-targetaction="multistep">\n';

  for (const step of steps) {
    html += `    <span class="interactive"\n`;
    html += `          data-targetaction='${escapeAttribute(step.action)}'\n`;
    html += `          data-reftarget='${escapeAttribute(step.selector)}'`;

    if (step.value) {
      html += `\n          data-targetvalue='${escapeAttribute(step.value)}'`;
    }

    html += `></span>\n`;
  }

  html += `    ${escapeHtml(description)}\n`;
  html += `</li>`;

  return html;
}

/**
 * Detect potential multistep groups based on timing and context
 * TODO: Implement when timestamp tracking is added to RecordedStep
 */
export function detectMultistepGroups(steps: RecordedStep[]): number[][] {
  // For now, we don't have timestamps on steps, so return empty
  // This can be enhanced later if we add timestamp tracking
  return [];
}

/**
 * Escape HTML special characters for content (NOT attributes)
 * For attribute values, we use single quotes to wrap, so double quotes inside are fine
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
  };
  return text.replace(/[&<>]/g, (m) => map[m]);
}

/**
 * Escape attribute values - use single quotes to wrap so double quotes work inside
 */
function escapeAttribute(text: string): string {
  // Only escape single quotes and & < > since we'll wrap in single quotes
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#039;',
  };
  return text.replace(/[&<>']/g, (m) => map[m]);
}

/**
 * Generate a full HTML document with the tutorial
 */
export function exportAsFullHTML(steps: RecordedStep[], options: ExportOptions = {}): string {
  const { sectionTitle = 'Tutorial' } = options;

  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(sectionTitle)}</title>
</head>
<body>
`;

  html += exportStepsToHTML(steps, options);

  html += `
</body>
</html>`;

  return html;
}
