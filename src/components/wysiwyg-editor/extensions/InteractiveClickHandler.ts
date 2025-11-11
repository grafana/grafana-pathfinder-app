import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Extension } from '@tiptap/core';
import { error as logError } from '../utils/logger';
import {
  determineInteractiveElementType,
  handleListItemClick,
  handleSequenceSectionClick,
  handleInteractiveSpanClick,
  handleInteractiveCommentClick,
} from './shared/clickHandlerHelpers';

export interface InteractiveClickHandlerOptions {
  onEditInteractiveListItem?: (attrs: Record<string, string>, pos: number) => void;
  onEditSequenceSection?: (attrs: Record<string, string>, pos: number) => void;
  onEditInteractiveSpan?: (attrs: Record<string, string>, pos: number) => void;
  onEditInteractiveComment?: (attrs: Record<string, string>, pos: number, text?: string) => void;
}

export const InteractiveClickHandler = Extension.create<InteractiveClickHandlerOptions>({
  name: 'interactiveClickHandler',

  addOptions() {
    return {
      onEditInteractiveListItem: undefined,
      onEditSequenceSection: undefined,
      onEditInteractiveSpan: undefined,
      onEditInteractiveComment: undefined,
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: new PluginKey('interactiveClickHandler'),
        props: {
          handleDOMEvents: {
            click: (view, event) => {
              try {
                const target = event.target as HTMLElement;

                // Walk up the DOM tree to find the lightning bolt or info icon
                const lightningBolt = target.closest('.interactive-lightning');
                const infoIcon = target.closest('.interactive-info-icon');
                const clickableIcon = lightningBolt || infoIcon;

                if (!clickableIcon) {
                  return false;
                }

                event.preventDefault();
                event.stopPropagation();

                // Find the parent interactive element
                const element = clickableIcon.parentElement;
                if (!element) {
                  logError('[InteractiveClickHandler] No parent element found for icon');
                  return false;
                }

                // Determine the type of interactive element
                const elementTypeResult = determineInteractiveElementType(element);
                if (!elementTypeResult) {
                  logError('[InteractiveClickHandler] Could not determine element type for element:', element);
                  return false;
                }

                // Get the position in the document with multiple fallback strategies
                let pos: number | null | undefined = null;

                // Strategy 1: Try getting position from the element directly
                pos = view.posAtDOM(element, 0);

                // Strategy 2: If that fails, try with the first child (content wrapper)
                if (pos === null || pos === undefined || pos < 0) {
                  const contentWrapper = element.querySelector('[style*="display"]');
                  if (contentWrapper) {
                    pos = view.posAtDOM(contentWrapper as HTMLElement, 0);
                  }
                }

                // Strategy 3: Try finding the node by walking the document
                if (pos === null || pos === undefined || pos < 0) {
                  let foundPos: number | null = null;
                  view.state.doc.descendants((node, position) => {
                    const domNode = view.nodeDOM(position);
                    if (domNode === element) {
                      foundPos = position;
                      return false; // stop iteration
                    }
                    return true; // continue iteration
                  });
                  if (foundPos !== null) {
                    pos = foundPos;
                  }
                }

                // Strategy 4: For sequence sections, try finding by comparing attributes
                if ((pos === null || pos === undefined || pos < 0) && elementTypeResult.type === 'sequence') {
                  const elementId = element.getAttribute('id');
                  const elementAction = element.getAttribute('data-targetaction');

                  view.state.doc.descendants((node, position) => {
                    if (node.type.name === 'sequenceSection') {
                      const nodeId = node.attrs.id;
                      const nodeAction = node.attrs['data-targetaction'];
                      if (
                        (nodeId && nodeId === elementId) ||
                        (nodeAction === elementAction && nodeAction === 'sequence')
                      ) {
                        pos = position;
                        return false;
                      }
                    }
                    return true; // continue iteration
                  });
                }

                if (pos === null || pos === undefined || pos < 0) {
                  logError(
                    '[InteractiveClickHandler] Could not determine valid position for element. All position resolution strategies failed.'
                  );
                  return false;
                }

                // Handle based on element type
                switch (elementTypeResult.type) {
                  case 'listItem':
                    return handleListItemClick(elementTypeResult.element, pos, options.onEditInteractiveListItem!);

                  case 'sequence':
                    return handleSequenceSectionClick(elementTypeResult.element, pos, options.onEditSequenceSection!);

                  case 'span':
                    return handleInteractiveSpanClick(view, pos, options.onEditInteractiveSpan!);

                  case 'comment':
                    return handleInteractiveCommentClick(view, pos, (attrs, pos, text) => {
                      // Pass comment text along with attributes and position
                      if (options.onEditInteractiveComment) {
                        options.onEditInteractiveComment(attrs, pos, text);
                      }
                    });

                  default:
                    logError('[InteractiveClickHandler] Unknown element type:', elementTypeResult.type);
                    return false;
                }
              } catch (err) {
                // Log error but don't crash the editor
                logError('[InteractiveClickHandler] Exception in click handler:', err);
                return false;
              }
            },
          },
        },
      }),
    ];
  },
});
