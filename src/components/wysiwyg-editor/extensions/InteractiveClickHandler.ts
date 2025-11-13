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
import { resolveElementPosition } from '../services/positionResolver';

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

                // Resolve position using centralized position resolver
                const positionResult = resolveElementPosition(view, element, elementTypeResult.type);
                if (!positionResult.success || positionResult.position === null) {
                  logError('[InteractiveClickHandler] Position resolution failed:', positionResult.error);
                  return false;
                }

                const pos = positionResult.position;

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
