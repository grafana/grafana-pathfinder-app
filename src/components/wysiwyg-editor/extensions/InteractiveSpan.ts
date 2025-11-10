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
          if (typeof node === 'string') return false;
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
    return {
      setInteractiveSpan: createSetInlineNodeCommand(this.name, [{ type: 'text', text: 'Interactive text' }]),
      toggleInteractiveSpan: createToggleInlineNodeCommand(this.name, { class: 'interactive' }),
      unsetInteractiveSpan: createUnsetInlineNodeCommand(this.name),
    };
  },
});

