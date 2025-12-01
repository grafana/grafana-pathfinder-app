import { Node, mergeAttributes } from '@tiptap/core';
import { createClassAttribute, createTextAttribute } from './shared/attributes';
import { createAtomicCommentNodeView } from './shared/nodeViewFactory';
import { createToggleInlineNodeCommand, createUnsetInlineNodeCommand } from './shared/commandHelpers';

export interface InteractiveCommentOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    interactiveComment: {
      setInteractiveComment: (attributes?: Record<string, any>) => ReturnType;
      toggleInteractiveComment: () => ReturnType;
      unsetInteractiveComment: () => ReturnType;
    };
  }
}

export const InteractiveComment = Node.create<InteractiveCommentOptions>({
  name: 'interactiveComment',

  group: 'inline',

  inline: true,

  // Atomic node - cannot edit content directly, behaves as single unit
  atom: true,

  // Selectable and draggable for better UX
  selectable: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      // Text attribute stores the comment text (atomic nodes have no content)
      text: createTextAttribute(),
      class: createClassAttribute('interactive-comment'),
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span.interactive-comment',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    // For atomic comment nodes, text is stored in attribute but not displayed
    // The badge indicates there's a note, text is shown in modal on edit
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },

  addNodeView() {
    return ({ HTMLAttributes }) => {
      // Use atomic comment node view - no contentDOM, just badge
      return createAtomicCommentNodeView(HTMLAttributes);
    };
  },

  addCommands() {
    return {
      setInteractiveComment:
        (attributes: Record<string, any> = {}) =>
        ({ chain, state }: any) => {
          // For atomic nodes, get selected text or use provided text attribute
          const { from, to, empty } = state.selection;
          let text = attributes.text || 'Comment text';

          // If there's a selection, use the selected text
          if (!empty) {
            text = state.doc.textBetween(from, to, ' ');
          }

          // Insert atomic node with text attribute
          return chain()
            .deleteSelection()
            .insertContent({
              type: 'interactiveComment',
              attrs: {
                ...attributes,
                text,
                class: attributes.class || 'interactive-comment',
              },
            })
            .run();
        },
      toggleInteractiveComment: createToggleInlineNodeCommand(this.name, { class: 'interactive-comment' }),
      unsetInteractiveComment: createUnsetInlineNodeCommand(this.name),
    };
  },
});
