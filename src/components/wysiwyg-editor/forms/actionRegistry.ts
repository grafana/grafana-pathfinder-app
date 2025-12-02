/**
 * Unified Action Registry
 * Single source of truth for all interactive action definitions
 * Combines UI metadata, form configuration, and component mapping
 */

import type React from 'react';
import type { BaseInteractiveFormConfig } from './BaseInteractiveForm';
import type { InteractiveFormProps } from '../types';
import { DATA_ATTRIBUTES, DEFAULT_VALUES, ACTION_TYPES, getActionIcon } from '../../../constants/interactive-config';
import { sanitizeTextForDisplay } from '../../../security';
import MultistepActionForm from './MultistepActionForm';
import ButtonActionForm from './ButtonActionForm';
import HighlightActionForm from './HighlightActionForm';
import FormFillActionForm from './FormFillActionForm';
import NavigateActionForm from './NavigateActionForm';
import HoverActionForm from './HoverActionForm';
import SequenceActionForm from './SequenceActionForm';
import NoopActionForm from './NoopActionForm';
import GuidedActionForm from './GuidedActionForm';
import QuizActionForm from './QuizActionForm';

/**
 * UI metadata for action selector display
 */
export interface ActionUIMetadata {
  icon: string;
  name: string;
  description: string;
  grafanaIcon?: string;
}

/**
 * Complete action definition combining UI metadata, form config, and component
 */
export interface ActionDefinition {
  type: string;
  ui: ActionUIMetadata;
  formConfig: BaseInteractiveFormConfig;
  formComponent: React.ComponentType<InteractiveFormProps>;
  hiddenInSelector?: boolean; // For actions like SEQUENCE that are only available via toolbar
}

/**
 * Unified action registry
 * Add new actions here - all other places will automatically pick them up
 */
export const ACTION_REGISTRY: Record<string, ActionDefinition> = {
  [ACTION_TYPES.BUTTON]: {
    type: ACTION_TYPES.BUTTON,
    ui: {
      icon: getActionIcon(ACTION_TYPES.BUTTON),
      name: 'Button',
      description: 'Click a button by text or selector',
      grafanaIcon: 'gf-button',
    },
    formConfig: {
      title: ACTION_TYPES.BUTTON,
      description: 'Click a button using text or CSS selector',
      actionType: ACTION_TYPES.BUTTON,
      fields: [
        {
          id: DATA_ATTRIBUTES.REF_TARGET,
          label: 'Button Text or Selector:',
          type: 'text',
          placeholder: 'e.g., "Save Dashboard" or button[data-testid="save"]',
          hint: 'Selector which targets the element you want to interact with',
          required: true,
          autoFocus: true,
          disableSelectorCapture: false,
          selectorCaptureDisabledTooltip: undefined,
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
    formComponent: ButtonActionForm,
  },

  [ACTION_TYPES.HIGHLIGHT]: {
    type: ACTION_TYPES.HIGHLIGHT,
    ui: {
      icon: getActionIcon(ACTION_TYPES.HIGHLIGHT),
      name: 'Highlight',
      description: 'Click/Highlight an element',
      grafanaIcon: 'star',
    },
    formConfig: {
      title: ACTION_TYPES.HIGHLIGHT,
      description: 'Highlight a specific UI element',
      actionType: ACTION_TYPES.HIGHLIGHT,
      fields: [
        {
          id: DATA_ATTRIBUTES.REF_TARGET,
          label: 'Selector:',
          type: 'text',
          placeholder: 'e.g., [data-testid="panel"], .my-class, div:has(p)',
          hint: 'Supports CSS selectors and enhanced selectors (:has(), :contains(), :nth-match()). Click the target to live choose an element from the left.',
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
    formComponent: HighlightActionForm,
  },

  [ACTION_TYPES.FORM_FILL]: {
    type: ACTION_TYPES.FORM_FILL,
    ui: {
      icon: getActionIcon(ACTION_TYPES.FORM_FILL),
      name: 'Form Fill',
      description: 'Fill an input field',
      grafanaIcon: 'document-info',
    },
    formConfig: {
      title: ACTION_TYPES.FORM_FILL,
      description: 'Fill a form input field',
      actionType: ACTION_TYPES.FORM_FILL,
      fields: [
        {
          id: DATA_ATTRIBUTES.REF_TARGET,
          label: 'Selector:',
          type: 'text',
          placeholder: 'e.g., input[name="title"], #query, form:has(button)',
          hint: 'Supports CSS selectors and enhanced selectors (:has(), :contains(), :nth-match())',
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
    formComponent: FormFillActionForm,
  },

  [ACTION_TYPES.NAVIGATE]: {
    type: ACTION_TYPES.NAVIGATE,
    ui: {
      icon: getActionIcon(ACTION_TYPES.NAVIGATE),
      name: 'Navigate',
      description: 'Go to a page',
      grafanaIcon: 'compass',
    },
    formConfig: {
      title: ACTION_TYPES.NAVIGATE,
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
          disableSelectorCapture: true,
          selectorCaptureDisabledTooltip: 'Navigate expects a URL path, not a DOM selector',
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
    formComponent: NavigateActionForm,
  },

  [ACTION_TYPES.HOVER]: {
    type: ACTION_TYPES.HOVER,
    ui: {
      icon: getActionIcon(ACTION_TYPES.HOVER),
      name: 'Hover',
      description: 'Reveal on hover',
      grafanaIcon: 'mouse',
    },
    formConfig: {
      title: ACTION_TYPES.HOVER,
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
    formComponent: HoverActionForm,
  },

  [ACTION_TYPES.MULTISTEP]: {
    type: ACTION_TYPES.MULTISTEP,
    ui: {
      icon: getActionIcon(ACTION_TYPES.MULTISTEP),
      name: 'Multistep',
      description: 'Multiple actions',
      grafanaIcon: 'clipboard-list',
    },
    formConfig: {
      title: ACTION_TYPES.MULTISTEP,
      description: 'Multiple related actions in sequence',
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
    formComponent: MultistepActionForm,
  },

  [ACTION_TYPES.GUIDED]: {
    type: ACTION_TYPES.GUIDED,
    ui: {
      icon: getActionIcon(ACTION_TYPES.GUIDED),
      name: 'Guided',
      description: 'Step-by-step guided tour',
      grafanaIcon: 'crosshair',
    },
    formConfig: {
      title: ACTION_TYPES.GUIDED,
      description: 'Guided interaction that waits for user to complete each step',
      actionType: ACTION_TYPES.GUIDED,
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
        'Guided actions walk users through steps one at a time, waiting for them to complete each action. ' +
        'Add nested interactive spans inside this element to define the individual steps.',
      buildAttributes: (values) => ({
        [DATA_ATTRIBUTES.TARGET_ACTION]: ACTION_TYPES.GUIDED,
        [DATA_ATTRIBUTES.REQUIREMENTS]: values[DATA_ATTRIBUTES.REQUIREMENTS],
        class: DEFAULT_VALUES.CLASS,
      }),
    },
    formComponent: GuidedActionForm,
  },

  [ACTION_TYPES.QUIZ]: {
    type: ACTION_TYPES.QUIZ,
    ui: {
      icon: getActionIcon(ACTION_TYPES.QUIZ),
      name: 'Quiz',
      description: 'Knowledge check question',
      grafanaIcon: 'question-circle',
    },
    formConfig: {
      title: ACTION_TYPES.QUIZ,
      description: 'Create a multiple-choice quiz question',
      actionType: ACTION_TYPES.QUIZ,
      // QuizActionForm handles all fields itself - no generic fields needed
      fields: [],
      buildAttributes: (values) => ({
        [DATA_ATTRIBUTES.TARGET_ACTION]: ACTION_TYPES.QUIZ,
        [DATA_ATTRIBUTES.REQUIREMENTS]: values[DATA_ATTRIBUTES.REQUIREMENTS],
        class: DEFAULT_VALUES.CLASS,
        // Quiz-specific data passed through from form
        ...values,
      }),
    },
    formComponent: QuizActionForm,
  },

  [ACTION_TYPES.SEQUENCE]: {
    type: ACTION_TYPES.SEQUENCE,
    ui: {
      icon: getActionIcon(ACTION_TYPES.SEQUENCE),
      name: 'Sequence',
      description: 'Section with steps',
      grafanaIcon: 'folder-open',
    },
    formConfig: {
      title: ACTION_TYPES.SEQUENCE,
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
    formComponent: SequenceActionForm,
    hiddenInSelector: true, // Only available via toolbar "Add Section" button
  },

  [ACTION_TYPES.NOOP]: {
    type: ACTION_TYPES.NOOP,
    ui: {
      icon: '📖',
      name: 'No action',
      description: 'Instructional only (no buttons)',
      grafanaIcon: 'book',
    },
    formConfig: {
      title: ACTION_TYPES.NOOP,
      description: 'Instructional step with no Show me or Do it buttons',
      actionType: ACTION_TYPES.NOOP,
      fields: [],
      infoBox:
        'This creates an instructional step that displays content without Show me or Do it buttons. ' +
        'Useful for manual steps that users must complete themselves, or for providing context between automated steps.',
      buildAttributes: (values) => ({
        [DATA_ATTRIBUTES.TARGET_ACTION]: ACTION_TYPES.NOOP,
        [DATA_ATTRIBUTES.REQUIREMENTS]: values[DATA_ATTRIBUTES.REQUIREMENTS],
        'data-doit': DEFAULT_VALUES.DO_IT_FALSE,
        'data-showme': DEFAULT_VALUES.DO_IT_FALSE,
        class: DEFAULT_VALUES.CLASS,
      }),
    },
    formComponent: NoopActionForm,
  },
};

/**
 * Get action definition by type
 */
export function getActionDefinition(actionType: string): ActionDefinition | undefined {
  return ACTION_REGISTRY[actionType];
}

/**
 * Get all actions for selector (excluding hidden ones)
 */
export function getSelectableActions(): ActionDefinition[] {
  return Object.values(ACTION_REGISTRY).filter((action) => !action.hiddenInSelector);
}

/**
 * Get action UI metadata (for backward compatibility)
 */
export function getActionUIMetadata(actionType: string): ActionUIMetadata | undefined {
  return ACTION_REGISTRY[actionType]?.ui;
}

/**
 * Get action form config (for backward compatibility)
 */
export function getActionFormConfig(actionType: string): BaseInteractiveFormConfig | undefined {
  return ACTION_REGISTRY[actionType]?.formConfig;
}
