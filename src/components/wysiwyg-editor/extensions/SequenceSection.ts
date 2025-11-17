import { Node, mergeAttributes } from '@tiptap/core';
import {
  createIdAttribute,
  createClassAttribute,
  createTargetActionAttribute,
  createRefTargetAttribute,
  createTargetValueAttribute,
  createRequirementsAttribute,
} from './shared/attributes';
import { createSequenceSectionNodeView } from './shared/nodeViewFactory';

export interface SequenceSectionOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sequenceSection: {
      setSequenceSection: (attributes?: Record<string, any>) => ReturnType;
      insertSequenceSection: (attributes: Record<string, any>) => ReturnType;
    };
  }
}

/**
 * SequenceSection Extension
 *
 * A special interactive element that represents a section containing multiple steps with a checkpoint.
 *
 * ## Why a separate extension from InteractiveSpan?
 *
 * While both render as <span> elements in HTML, SequenceSection has fundamentally different behavior:
 *
 * 1. **Content Model**:
 *    - SequenceSection: block-level content ('block+') - contains headings, lists, paragraphs
 *    - InteractiveSpan: inline content ('inline*') - contains text and inline marks
 *
 * 2. **Purpose**:
 *    - SequenceSection: Wraps entire tutorial sections with multiple steps (container)
 *    - InteractiveSpan: Marks specific inline elements for interaction (marker)
 *
 * 3. **Action Type**:
 *    - SequenceSection: Always 'sequence' action (data-targetaction="sequence")
 *    - InteractiveSpan: Variable action types (button, highlight, etc.)
 *
 * 4. **Parsing Priority**:
 *    - SequenceSection: Higher priority (100) to match sequence spans first
 *    - InteractiveSpan: Default priority, matches other interactive spans
 *
 * ## HTML Output
 *
 * Despite being a block-level node in the editor, SequenceSection renders as a <span>
 * for compatibility with the Grafana interactive guides system, which expects:
 *
 * ```html
 * <span id="section-id" class="interactive" data-targetaction="sequence" data-reftarget="span#section-id">
 *   <h3>Section Title</h3>
 *   <ul>
 *     <li>Step 1</li>
 *     <li>Step 2</li>
 *   </ul>
 * </span>
 * ```
 */
export const SequenceSection = Node.create<SequenceSectionOptions>({
  name: 'sequenceSection',

  group: 'block',

  content: 'block+', // Can contain multiple block-level elements

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      id: createIdAttribute(),
      class: createClassAttribute('interactive'),
      'data-targetaction': createTargetActionAttribute('sequence'),
      'data-reftarget': createRefTargetAttribute(),
      'data-targetvalue': createTargetValueAttribute(),
      'data-requirements': createRequirementsAttribute(),
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-targetaction="sequence"]',
        priority: 100,
      },
      {
        tag: 'span.interactive[data-targetaction="sequence"]',
        priority: 100,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addNodeView() {
    return ({ HTMLAttributes }) => {
      return createSequenceSectionNodeView(HTMLAttributes);
    };
  },

  addCommands() {
    return {
      setSequenceSection:
        (attributes) =>
        ({ commands }) => {
          return commands.setNode(this.name, attributes);
        },
      insertSequenceSection:
        (attributes) =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs: attributes,
              content: [
                {
                  type: 'heading',
                  attrs: { level: 3 },
                  content: [{ type: 'text', text: 'Section Title Goes Here' }],
                },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Step 1' }] }],
                    },
                    {
                      type: 'listItem',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Step 2' }] }],
                    },
                    {
                      type: 'listItem',
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Step 3' }] }],
                    },
                  ],
                },
              ],
            })
            .run();
        },
    };
  },
});
