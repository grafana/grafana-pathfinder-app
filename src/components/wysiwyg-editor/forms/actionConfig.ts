/**
 * Action Type Configuration
 * Single source of truth for all interactive action form configurations
 */

import type { BaseInteractiveFormConfig } from './BaseInteractiveForm';
import { DATA_ATTRIBUTES, DEFAULT_VALUES, ACTION_TYPES } from '../../../constants/interactive-config';
import { sanitizeTextForDisplay } from '../../../security';

/**
 * Complete registry of all action configurations
 */
export const ACTION_CONFIGS: Record<string, BaseInteractiveFormConfig> = {
  [ACTION_TYPES.BUTTON]: {
    title: 'Button Click Action',
    description: 'Click a button with specific text',
    actionType: ACTION_TYPES.BUTTON,
    fields: [
      {
        id: DATA_ATTRIBUTES.REF_TARGET,
        label: 'Button Text:',
        type: 'text',
        placeholder: 'e.g., Save, Create, Submit',
        hint: 'The exact text displayed on the button',
        required: true,
        autoFocus: true,
      },
      {
        id: DATA_ATTRIBUTES.REQUIREMENTS,
        label: 'Requirements:',
        type: 'text',
        placeholder: `e.g., ${DEFAULT_VALUES.REQUIREMENT}`,
        defaultValue: DEFAULT_VALUES.REQUIREMENT,
        showCommonOptions: true,
      },
    ],
    buildAttributes: (values) => ({
      [DATA_ATTRIBUTES.TARGET_ACTION]: ACTION_TYPES.BUTTON,
      [DATA_ATTRIBUTES.REF_TARGET]: values[DATA_ATTRIBUTES.REF_TARGET],
      [DATA_ATTRIBUTES.REQUIREMENTS]: values[DATA_ATTRIBUTES.REQUIREMENTS],
      class: DEFAULT_VALUES.CLASS,
    }),
  },

  [ACTION_TYPES.HIGHLIGHT]: {
    title: 'Highlight Element Action',
    description: 'Highlight a specific UI element',
    actionType: ACTION_TYPES.HIGHLIGHT,
    fields: [
      {
        id: DATA_ATTRIBUTES.REF_TARGET,
        label: 'Selector:',
        type: 'text',
        placeholder: 'e.g., [data-testid="panel"], .my-class',
        hint: 'Click the target to live choose an element from the left.',
        required: true,
        autoFocus: true,
      },
      {
        id: DATA_ATTRIBUTES.REQUIREMENTS,
        label: 'Requirements:',
        type: 'text',
        placeholder: `e.g., ${DEFAULT_VALUES.REQUIREMENT}`,
        defaultValue: DEFAULT_VALUES.REQUIREMENT,
        showCommonOptions: true,
      },
      {
        id: DATA_ATTRIBUTES.DO_IT,
        label: 'Show-only (educational, no interaction required)',
        type: 'checkbox',
        defaultValue: false,
      },
    ],
    buildAttributes: (values) => ({
      [DATA_ATTRIBUTES.TARGET_ACTION]: ACTION_TYPES.HIGHLIGHT,
      [DATA_ATTRIBUTES.REF_TARGET]: values[DATA_ATTRIBUTES.REF_TARGET],
      [DATA_ATTRIBUTES.REQUIREMENTS]: values[DATA_ATTRIBUTES.REQUIREMENTS],
      [DATA_ATTRIBUTES.DO_IT]: values[DATA_ATTRIBUTES.DO_IT] ? DEFAULT_VALUES.DO_IT_FALSE : null,
      class: DEFAULT_VALUES.CLASS,
    }),
  },

  [ACTION_TYPES.FORM_FILL]: {
    title: 'Form Fill Action',
    description: 'Fill a form input field',
    actionType: ACTION_TYPES.FORM_FILL,
    fields: [
      {
        id: DATA_ATTRIBUTES.REF_TARGET,
        label: 'Selector:',
        type: 'text',
        placeholder: 'e.g., input[name="title"], #query',
        hint: 'Selector for the input field',
        required: true,
        autoFocus: true,
      },
      {
        id: DATA_ATTRIBUTES.TARGET_VALUE,
        label: 'Value to Set:',
        type: 'text',
        placeholder: 'e.g., http://prometheus:9090, my-datasource',
        hint: 'The value to fill into the input field',
        required: true,
      },
      {
        id: DATA_ATTRIBUTES.REQUIREMENTS,
        label: 'Requirements:',
        type: 'text',
        placeholder: `e.g., ${DEFAULT_VALUES.REQUIREMENT}`,
        defaultValue: DEFAULT_VALUES.REQUIREMENT,
        showCommonOptions: true,
      },
    ],
    buildAttributes: (values) => ({
      [DATA_ATTRIBUTES.TARGET_ACTION]: ACTION_TYPES.FORM_FILL,
      [DATA_ATTRIBUTES.REF_TARGET]: values[DATA_ATTRIBUTES.REF_TARGET],
      [DATA_ATTRIBUTES.TARGET_VALUE]: values[DATA_ATTRIBUTES.TARGET_VALUE],
      [DATA_ATTRIBUTES.REQUIREMENTS]: values[DATA_ATTRIBUTES.REQUIREMENTS],
      class: DEFAULT_VALUES.CLASS,
    }),
  },

  [ACTION_TYPES.NAVIGATE]: {
    title: 'Navigate Action',
    description: 'Navigate to a specific page',
    actionType: ACTION_TYPES.NAVIGATE,
    fields: [
      {
        id: DATA_ATTRIBUTES.REF_TARGET,
        label: 'Page Path:',
        type: 'text',
        placeholder: 'e.g., /dashboards, /datasources',
        hint: 'The URL path to navigate to',
        required: true,
        autoFocus: true,
      },
      {
        id: DATA_ATTRIBUTES.REQUIREMENTS,
        label: 'Requirements:',
        type: 'text',
        placeholder: 'Auto: on-page:/path',
        hint: 'Leave blank to auto-generate on-page requirement',
      },
    ],
    buildAttributes: (values) => {
      // SECURITY: Sanitize ref target before concatenation to prevent requirement string injection (F4)
      const refTarget = values[DATA_ATTRIBUTES.REF_TARGET] || '';
      const sanitizedRefTarget = sanitizeTextForDisplay(refTarget.trim());

      return {
        [DATA_ATTRIBUTES.TARGET_ACTION]: ACTION_TYPES.NAVIGATE,
        [DATA_ATTRIBUTES.REF_TARGET]: sanitizedRefTarget,
        [DATA_ATTRIBUTES.REQUIREMENTS]: values[DATA_ATTRIBUTES.REQUIREMENTS] || `on-page:${sanitizedRefTarget}`,
        class: DEFAULT_VALUES.CLASS,
      };
    },
  },

  [ACTION_TYPES.HOVER]: {
    title: 'Hover Action',
    description: 'Reveal hover-hidden UI elements',
    actionType: ACTION_TYPES.HOVER,
    fields: [
      {
        id: DATA_ATTRIBUTES.REF_TARGET,
        label: 'Selector:',
        type: 'text',
        placeholder: 'e.g., div[data-cy="item"]:has(p:contains("name"))',
        hint: 'Selector for the element to hover over',
        required: true,
        autoFocus: true,
      },
      {
        id: DATA_ATTRIBUTES.REQUIREMENTS,
        label: 'Requirements:',
        type: 'text',
        placeholder: `e.g., ${DEFAULT_VALUES.REQUIREMENT}`,
        defaultValue: DEFAULT_VALUES.REQUIREMENT,
        showCommonOptions: true,
      },
    ],
    buildAttributes: (values) => ({
      [DATA_ATTRIBUTES.TARGET_ACTION]: ACTION_TYPES.HOVER,
      [DATA_ATTRIBUTES.REF_TARGET]: values[DATA_ATTRIBUTES.REF_TARGET],
      [DATA_ATTRIBUTES.REQUIREMENTS]: values[DATA_ATTRIBUTES.REQUIREMENTS],
      class: DEFAULT_VALUES.CLASS,
    }),
  },

  [ACTION_TYPES.MULTISTEP]: {
    title: 'Multistep Action',
    description: 'Multiple related actions in sequence (typically contains nested interactive spans)',
    actionType: ACTION_TYPES.MULTISTEP,
    fields: [
      {
        id: DATA_ATTRIBUTES.REQUIREMENTS,
        label: 'Requirements:',
        type: 'text',
        placeholder: `e.g., ${DEFAULT_VALUES.REQUIREMENT} (optional)`,
        hint: 'Requirements are usually set on child interactive spans',
        autoFocus: true,
        showCommonOptions: true,
      },
    ],
    infoBox:
      'Multistep actions typically contain nested interactive spans. After applying, add child elements with their own interactive markup inside this list item.',
    buildAttributes: (values) => ({
      [DATA_ATTRIBUTES.TARGET_ACTION]: ACTION_TYPES.MULTISTEP,
      [DATA_ATTRIBUTES.REQUIREMENTS]: values[DATA_ATTRIBUTES.REQUIREMENTS],
      class: DEFAULT_VALUES.CLASS,
    }),
  },

  [ACTION_TYPES.SEQUENCE]: {
    title: 'Sequence Section',
    description: 'A section containing multiple steps with a checkpoint',
    actionType: ACTION_TYPES.SEQUENCE,
    fields: [
      {
        id: 'id',
        label: 'Section ID:',
        type: 'text',
        placeholder: 'e.g., section-1, getting-started',
        hint: 'Unique identifier for this section',
        required: true,
        autoFocus: true,
      },
      {
        id: DATA_ATTRIBUTES.REQUIREMENTS,
        label: 'Requirements:',
        type: 'text',
        placeholder: 'Optional',
        hint: 'Requirements for displaying this section',
        showCommonOptions: true,
      },
    ],
    buildAttributes: (values) => ({
      id: values.id,
      [DATA_ATTRIBUTES.TARGET_ACTION]: ACTION_TYPES.SEQUENCE,
      [DATA_ATTRIBUTES.REF_TARGET]: `span#${values.id}`,
      [DATA_ATTRIBUTES.REQUIREMENTS]: values[DATA_ATTRIBUTES.REQUIREMENTS],
      class: DEFAULT_VALUES.CLASS,
    }),
  },
};

/**
 * Get action configuration by type
 */
export function getActionConfig(actionType: string): BaseInteractiveFormConfig | undefined {
  return ACTION_CONFIGS[actionType];
}
