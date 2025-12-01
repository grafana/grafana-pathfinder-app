import { Node, mergeAttributes } from '@tiptap/core';
import { createClassAttribute } from './shared/attributes';
import { createNoteBadge, applyAttributes } from './shared/nodeViewFactory';
import {
  createToggleInlineNodeCommand,
  createUnsetInlineNodeCommand,
  createSetInlineNodeCommand,
} from './shared/commandHelpers';

export interface InteractiveCommentOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    interactiveComment: {
      setInteractiveComment: () => ReturnType;
      toggleInteractiveComment: () => ReturnType;
      unsetInteractiveComment: () => ReturnType;
    };
  }
}

export const InteractiveComment = Node.create<InteractiveCommentOptions>({
  name: 'interactiveComment',

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

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement('span');
      applyAttributes(dom, HTMLAttributes);

      // Add note badge instead of info icon
      const badge = createNoteBadge();
      dom.appendChild(badge);

      // Create content wrapper but hide text (keep for editing)
      const contentDOM = document.createElement('span');
      contentDOM.style.display = 'none'; // Hide text, show only icon
      dom.appendChild(contentDOM);

      return { dom, contentDOM };
    };
  },

  addCommands() {
    return {
      setInteractiveComment: createSetInlineNodeCommand(this.name, [{ type: 'text', text: 'Comment text' }]),
      toggleInteractiveComment: createToggleInlineNodeCommand(this.name, { class: 'interactive-comment' }),
      unsetInteractiveComment: createUnsetInlineNodeCommand(this.name),
    };
  },
});
