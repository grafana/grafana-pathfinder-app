/**
 * Command Helper Factories
 * Provides reusable command factories for Tiptap extensions
 * Eliminates duplication between InteractiveSpan and InteractiveComment
 */

/**
 * Creates a toggle command for inline nodes
 * Toggles between wrapping selection in the node or unwrapping it
 *
 * @param nodeName - The name of the Tiptap node type
 * @param defaultAttrs - Default attributes to apply when wrapping
 */
export function createToggleInlineNodeCommand(nodeName: string, defaultAttrs: Record<string, any> = {}) {
  return () =>
    ({ commands, state, chain }: any) => {
      const { from, to, $from } = state.selection;

      // Check if we're inside the target node
      for (let depth = $from.depth; depth > 0; depth--) {
        const node = $from.node(depth);
        if (node.type.name === nodeName) {
          // We're inside the node, so unwrap it
          const pos = $from.before(depth);
          const nodeSize = node.nodeSize;
          const content = node.content;

          return chain().deleteRange({ from: pos, to: pos + nodeSize }).insertContentAt(pos, content.toJSON()).run();
        }
      }

      // Not inside the node, so wrap the selection
      if (from !== to) {
        return commands.insertContentAt(
          { from, to },
          {
            type: nodeName,
            attrs: defaultAttrs,
            content: state.doc.slice(from, to).content.toJSON(),
          }
        );
      }

      return false;
    };
}

/**
 * Creates an unset command for inline nodes
 * Unwraps the node if cursor is inside it
 *
 * @param nodeName - The name of the Tiptap node type
 */
export function createUnsetInlineNodeCommand(nodeName: string) {
  return () =>
    ({ state, chain }: any) => {
      const { $from } = state.selection;

      // Find if we're inside the target node
      for (let depth = $from.depth; depth > 0; depth--) {
        const node = $from.node(depth);
        if (node.type.name === nodeName) {
          const pos = $from.before(depth);
          const nodeSize = node.nodeSize;
          const content = node.content;

          return chain().deleteRange({ from: pos, to: pos + nodeSize }).insertContentAt(pos, content.toJSON()).run();
        }
      }

      return false;
    };
}

/**
 * Creates a set command for inline nodes
 * Wraps selection or inserts default content
 *
 * @param nodeName - The name of the Tiptap node type
 * @param defaultContent - Default content to insert if no selection
 */
export function createSetInlineNodeCommand(
  nodeName: string,
  defaultContent: any[] = [{ type: 'text', text: 'Text' }]
) {
  return (attributes: Record<string, any> = {}) =>
    ({ commands, state }: any) => {
      const { from, to } = state.selection;

      // If there's a selection, wrap it
      if (from !== to) {
        return commands.insertContentAt(
          { from, to },
          {
            type: nodeName,
            attrs: attributes,
            content: state.doc.slice(from, to).content.toJSON(),
          }
        );
      }

      // Otherwise insert with default content
      return commands.insertContent({
        type: nodeName,
        attrs: attributes,
        content: defaultContent,
      });
    };
}

/**
 * Helper to check if cursor is inside a specific node type
 */
export function isInsideNode(state: any, nodeName: string): boolean {
  const { $from } = state.selection;

  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === nodeName) {
      return true;
    }
  }

  return false;
}

/**
 * Helper to get the node and position if cursor is inside it
 */
export function findContainingNode(
  state: any,
  nodeName: string
): { node: any; pos: number; depth: number } | null {
  const { $from } = state.selection;

  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === nodeName) {
      return {
        node,
        pos: $from.before(depth),
        depth,
      };
    }
  }

  return null;
}

