import { Node, mergeAttributes } from '@tiptap/core';
import {
  createClassAttribute,
  createIdAttribute,
  createTargetActionAttribute,
  createRefTargetAttribute,
  createTargetValueAttribute,
  createRequirementsAttribute,
} from './shared/attributes';
import { createSpanNodeView } from './shared/nodeViewFactory';
import {
  createToggleInlineNodeCommand,
  createUnsetInlineNodeCommand,
  createSetInlineNodeCommand,
} from './shared/commandHelpers';

/**
 * Check if the current selection is inside a list item within a sequence section
 * This helper works with TipTap's state object (used in commands)
 */
function isInsideSequenceSectionListItemFromState(state: any): boolean {
  const { $from } = state.selection;
  let foundListItem = false;
  let foundSequenceSection = false;

  // Walk up the node hierarchy
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    const nodeType = node.type.name;

    // First, check if we're inside a list item
    if (nodeType === 'listItem') {
      foundListItem = true;
    }

    // Then check if we're inside a sequence section
    if (nodeType === 'sequenceSection') {
      foundSequenceSection = true;
    }

    // If we found both, we're in the right context
    if (foundListItem && foundSequenceSection) {
      return true;
    }
  }

  return false;
}

export interface InteractiveSpanOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    interactiveSpan: {
      setInteractiveSpan: (attributes?: Record<string, any>) => ReturnType;
      toggleInteractiveSpan: () => ReturnType;
      unsetInteractiveSpan: () => ReturnType;
    };
  }
}

/**
 * InteractiveSpan Extension
 *
 * An inline node that wraps text or other inline content to mark it as interactive.
 *
 * ## Difference from SequenceSection
 *
 * While both render as <span> elements, InteractiveSpan is fundamentally different:
 *
 * 1. **Content Model**:
 *    - InteractiveSpan: inline ('inline*') - can contain text, bold, italic, etc.
 *    - SequenceSection: block ('block+') - contains headings, lists, paragraphs
 *
 * 2. **Usage**:
 *    - InteractiveSpan: Marks specific text/elements within a paragraph for interaction
 *    - SequenceSection: Wraps entire tutorial sections with multiple block elements
 *
 * 3. **Action Types**:
 *    - InteractiveSpan: Variable (button, highlight, formfill, navigate, hover, multistep)
 *    - SequenceSection: Always 'sequence'
 *
 * ## HTML Output
 *
 * ```html
 * <span class="interactive" data-targetaction="button" data-reftarget="Save">
 *   Click the Save button
 * </span>
 * ```
 *
 * ## Parsing
 *
 * Parses <span class="interactive"> elements from HTML, but excludes spans with
 * data-targetaction="sequence" (which are handled by SequenceSection).
 */
export const InteractiveSpan = Node.create<InteractiveSpanOptions>({
  name: 'interactiveSpan',

  group: 'inline',

  inline: true,

  content: 'inline*',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      class: createClassAttribute('interactive'),
      id: createIdAttribute(),
      'data-targetaction': createTargetActionAttribute(),
      'data-reftarget': createRefTargetAttribute(),
      'data-targetvalue': createTargetValueAttribute(),
      'data-requirements': createRequirementsAttribute(),
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span.interactive',
        getAttrs: (node) => {
          if (typeof node === 'string') {
            return false;
          }
          const element = node as HTMLElement;
          // Don't match if it's a sequence section
          if (element.getAttribute('data-targetaction') === 'sequence') {
            return false;
          }
          return null;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addNodeView() {
    return ({ HTMLAttributes }) => {
      return createSpanNodeView(HTMLAttributes, true);
    };
  },

  addCommands() {
    const baseSetCommand = createSetInlineNodeCommand(this.name, [{ type: 'text', text: 'Interactive text' }]);
    const baseToggleCommand = createToggleInlineNodeCommand(this.name, { class: 'interactive' });

    return {
      setInteractiveSpan:
        (attributes: Record<string, any> = {}) =>
        ({ commands, state, chain }: any) => {
          // Check if we're inside a list item within a sequence section
          if (isInsideSequenceSectionListItemFromState(state)) {
            // Convert to interactive list item instead
            const listItemAttributes = {
              ...attributes,
              class: attributes.class || 'interactive',
            };
            return commands.updateAttributes('listItem', listItemAttributes);
          }

          // Normal span behavior
          return baseSetCommand(attributes)({ commands, state, chain });
        },
      toggleInteractiveSpan:
        () =>
        ({ commands, state, chain }: any) => {
          // Check if we're inside a list item within a sequence section
          if (isInsideSequenceSectionListItemFromState(state)) {
            const { $from } = state.selection;

            // Check if the list item already has interactive attributes
            let listItemNode = null;
            for (let depth = $from.depth; depth > 0; depth--) {
              const node = $from.node(depth);
              if (node.type.name === 'listItem') {
                listItemNode = node;
                break;
              }
            }

            if (listItemNode) {
              const hasInteractive = listItemNode.attrs.class?.includes('interactive');
              if (hasInteractive) {
                // Remove interactive attributes
                return commands.updateAttributes('listItem', {
                  class: null,
                  'data-targetaction': null,
                  'data-reftarget': null,
                  'data-targetvalue': null,
                  'data-requirements': null,
                });
              } else {
                // Add interactive attributes with default class
                return commands.updateAttributes('listItem', {
                  class: 'interactive',
                });
              }
            }
          }

          // Normal toggle behavior
          return baseToggleCommand()({ commands, state, chain });
        },
      unsetInteractiveSpan: createUnsetInlineNodeCommand(this.name),
    };
  },
});
