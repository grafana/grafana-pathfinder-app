import ListItem from '@tiptap/extension-list-item';
import {
  createClassAttribute,
  createTargetActionAttribute,
  createRefTargetAttribute,
  createTargetValueAttribute,
  createRequirementsAttribute,
  createDoItAttribute,
} from './shared/attributes';
import { createListItemNodeView } from './shared/nodeViewFactory';

export interface InteractiveListItemOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    interactiveListItem: {
      setInteractiveListItem: (attributes?: Record<string, any>) => ReturnType;
      toggleInteractiveClass: () => ReturnType;
      setTargetAction: (action: string) => ReturnType;
      setRefTarget: (target: string) => ReturnType;
      setRequirements: (requirements: string) => ReturnType;
      setDoIt: (value: boolean) => ReturnType;
      convertToInteractiveListItem: (attributes: Record<string, any>) => ReturnType;
    };
  }
}

export const InteractiveListItem = ListItem.extend<InteractiveListItemOptions>({
  name: 'listItem',

  addAttributes() {
    return {
      ...this.parent?.(),
      class: createClassAttribute(null),
      'data-targetaction': createTargetActionAttribute(),
      'data-reftarget': createRefTargetAttribute(),
      'data-targetvalue': createTargetValueAttribute(),
      'data-requirements': createRequirementsAttribute(),
      'data-doit': createDoItAttribute(),
    };
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      return createListItemNodeView(HTMLAttributes);
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      toggleInteractiveClass:
        () =>
        ({ commands, state }) => {
          const { selection } = state;
          const { $from } = selection;
          const listItem = $from.node($from.depth - 1);

          if (listItem.type.name === 'listItem') {
            const currentClass = listItem.attrs.class;
            const hasInteractive = currentClass?.includes('interactive');
            const newClass = hasInteractive ? null : 'interactive';

            return commands.updateAttributes('listItem', { class: newClass });
          }

          return false;
        },
      setTargetAction:
        (action: string) =>
        ({ commands }) => {
          return commands.updateAttributes('listItem', {
            'data-targetaction': action || null,
          });
        },
      setRefTarget:
        (target: string) =>
        ({ commands }) => {
          return commands.updateAttributes('listItem', {
            'data-reftarget': target || null,
          });
        },
      setRequirements:
        (requirements: string) =>
        ({ commands }) => {
          return commands.updateAttributes('listItem', {
            'data-requirements': requirements || null,
          });
        },
      setDoIt:
        (value: boolean) =>
        ({ commands }) => {
          return commands.updateAttributes('listItem', {
            'data-doit': value ? 'false' : null,
          });
        },
      convertToInteractiveListItem:
        (attributes: Record<string, any>) =>
        ({ commands, state, chain }) => {
          const { selection } = state;
          const { $from } = selection;

          // Check if we're already in a list item
          let isInListItem = false;
          for (let i = $from.depth; i > 0; i--) {
            if ($from.node(i).type.name === 'listItem') {
              isInListItem = true;
              break;
            }
          }

          // If not in a list item, convert current block to list item
          if (!isInListItem) {
            // First, try to convert to list item and wrap in bullet list
            const converted = chain().focus().clearNodes().toggleBulletList().run();

            if (!converted) {
              return false;
            }
          }

          // Now apply all the interactive attributes
          return commands.updateAttributes('listItem', attributes);
        },
    };
  },
});
