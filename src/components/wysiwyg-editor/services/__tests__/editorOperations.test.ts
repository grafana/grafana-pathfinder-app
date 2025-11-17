/**
 * Tests for editorOperations service
 * Focuses on multistep insertion behavior to prevent nested lists
 */

import { insertNewInteractiveElement } from '../editorOperations';
import { ACTION_TYPES } from '../../../../constants/interactive-config';
import { CSS_CLASSES } from '../../../../constants/editor-config';

// Mock logger
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
}));

describe('insertNewInteractiveElement - Multistep insertion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Helper to create a mock editor with minimal required methods
  const createMockEditor = (options: {
    isInListItem?: boolean;
    listItemPos?: number;
    listItemSize?: number;
    hasSelection?: boolean;
    selectionFrom?: number;
    selectionTo?: number;
  }) => {
    const { isInListItem = false, listItemPos = 0, listItemSize = 10, selectionFrom = 0, selectionTo = 0 } = options;

    const mockListItemNode = {
      type: { name: 'listItem' },
      nodeSize: listItemSize,
      content: {
        size: 1,
        forEach: jest.fn((callback: any) => {
          // Mock paragraph node
          callback({
            content: {
              size: 1,
              forEach: jest.fn((inlineCallback: any) => {
                inlineCallback({
                  toJSON: () => ({ type: 'text', text: 'Existing text' }),
                });
              }),
            },
          });
        }),
      },
    };

    // Create proper $from structure for getCurrentNode to work
    const createFromNode = (depth: number) => {
      if (isInListItem && depth === 2) {
        return mockListItemNode;
      }
      if (depth === 1) {
        return { type: { name: 'bulletList' } };
      }
      return { type: { name: 'doc' } };
    };

    const mockState = {
      selection: {
        from: selectionFrom,
        to: selectionTo,
        $from: {
          depth: isInListItem ? 3 : 1,
          node: createFromNode,
          before: (depth: number) => {
            if (isInListItem && depth === 2) {
              return listItemPos;
            }
            return 0;
          },
        },
      },
      doc: {
        slice: jest.fn((from: number, to: number) => ({
          content: {
            toJSON: () => [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Selected text' }],
              },
            ],
          },
        })),
      },
    };

    const chainCommands: any[] = [];
    const mockChain = {
      focus: jest.fn().mockReturnThis(),
      deleteRange: jest.fn().mockReturnThis(),
      insertContentAt: jest.fn().mockReturnThis(),
      insertContent: jest.fn().mockReturnThis(),
      run: jest.fn().mockReturnValue(true),
    };

    return {
      state: mockState,
      can: jest.fn().mockReturnValue({
        insertContent: jest.fn().mockReturnValue(true),
      }),
      chain: jest.fn(() => {
        chainCommands.push(mockChain);
        return mockChain;
      }),
      commands: {
        updateAttributes: jest.fn().mockReturnValue(true),
      },
      // Expose chain for assertions
      _getChain: () => mockChain,
    } as any;
  };

  describe('when inserting multistep inside existing listItem', () => {
    it('should replace listItem in place instead of creating nested bulletList', () => {
      const mockEditor = createMockEditor({
        isInListItem: true,
        listItemPos: 10,
        listItemSize: 20,
        hasSelection: true,
        selectionFrom: 12,
        selectionTo: 15,
      });

      const attributes = {
        'data-targetaction': ACTION_TYPES.MULTISTEP,
        class: CSS_CLASSES.INTERACTIVE,
        'data-requirements': 'exists-reftarget',
        __internalActions: [
          {
            targetAction: 'highlight',
            refTarget: 'button.submit',
          },
          {
            targetAction: 'formfill',
            refTarget: 'input[name="email"]',
            targetValue: 'test@example.com',
          },
        ],
      };

      insertNewInteractiveElement(mockEditor, attributes);

      const chain = mockEditor._getChain();
      // Should delete the existing listItem
      expect(chain.deleteRange).toHaveBeenCalledWith({ from: 10, to: 30 });
      // Should insert new listItem at the same position
      expect(chain.insertContentAt).toHaveBeenCalledWith(
        10,
        expect.objectContaining({
          type: 'listItem',
          attrs: expect.objectContaining({
            'data-targetaction': ACTION_TYPES.MULTISTEP,
            class: CSS_CLASSES.INTERACTIVE,
          }),
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'paragraph',
              content: expect.arrayContaining([
                expect.objectContaining({ type: 'interactiveSpan' }),
                expect.objectContaining({ type: 'interactiveSpan' }),
              ]),
            }),
          ]),
        })
      );
      // Should NOT create a bulletList wrapper
      expect(chain.insertContent).not.toHaveBeenCalled();
    });

    it('should preserve existing text content when replacing listItem', () => {
      const mockEditor = createMockEditor({
        isInListItem: true,
        listItemPos: 5,
        listItemSize: 15,
        hasSelection: false,
      });

      const attributes = {
        'data-targetaction': ACTION_TYPES.MULTISTEP,
        class: CSS_CLASSES.INTERACTIVE,
        __internalActions: [
          {
            targetAction: 'highlight',
            refTarget: 'button',
          },
        ],
      };

      insertNewInteractiveElement(mockEditor, attributes);

      const chain = mockEditor._getChain();
      // Should extract existing content and include it
      expect(chain.insertContentAt).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          type: 'listItem',
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'paragraph',
              content: expect.arrayContaining([
                expect.objectContaining({ type: 'interactiveSpan' }),
                expect.objectContaining({ type: 'text' }),
              ]),
            }),
          ]),
        })
      );
    });
  });

  describe('when inserting multistep outside listItem', () => {
    it('should create new bulletList wrapper (existing behavior)', () => {
      const mockEditor = createMockEditor({
        isInListItem: false,
        hasSelection: true,
        selectionFrom: 5,
        selectionTo: 10,
      });

      const attributes = {
        'data-targetaction': ACTION_TYPES.MULTISTEP,
        class: CSS_CLASSES.INTERACTIVE,
        __internalActions: [
          {
            targetAction: 'highlight',
            refTarget: 'button',
          },
        ],
      };

      insertNewInteractiveElement(mockEditor, attributes);

      const chain = mockEditor._getChain();
      // Should create bulletList wrapper
      expect(chain.insertContentAt).toHaveBeenCalledWith(
        { from: 5, to: 10 },
        expect.objectContaining({
          type: 'bulletList',
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'listItem',
              attrs: expect.objectContaining({
                'data-targetaction': ACTION_TYPES.MULTISTEP,
              }),
            }),
          ]),
        })
      );
      // Should NOT delete and replace
      expect(chain.deleteRange).not.toHaveBeenCalled();
    });

    it('should create bulletList when cursor is at root level', () => {
      const mockEditor = createMockEditor({
        isInListItem: false,
        hasSelection: false,
      });

      const attributes = {
        'data-targetaction': ACTION_TYPES.MULTISTEP,
        class: CSS_CLASSES.INTERACTIVE,
        __internalActions: [
          {
            targetAction: 'highlight',
            refTarget: 'button',
          },
        ],
      };

      insertNewInteractiveElement(mockEditor, attributes);

      const chain = mockEditor._getChain();
      // Should insert bulletList at cursor
      expect(chain.insertContent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'bulletList',
          content: expect.arrayContaining([
            expect.objectContaining({
              type: 'listItem',
            }),
          ]),
        })
      );
    });
  });

  describe('when selection spans outside listItem', () => {
    it('should fall back to creating new bulletList', () => {
      // This scenario is when we're inside a listItem but selection extends beyond it
      // For simplicity, we'll test that it doesn't try to replace when selection is outside
      const mockEditor = createMockEditor({
        isInListItem: true,
        listItemPos: 10,
        listItemSize: 20,
        hasSelection: true,
        selectionFrom: 5, // Before listItem
        selectionTo: 25, // After listItem
      });

      const attributes = {
        'data-targetaction': ACTION_TYPES.MULTISTEP,
        class: CSS_CLASSES.INTERACTIVE,
        __internalActions: [
          {
            targetAction: 'highlight',
            refTarget: 'button',
          },
        ],
      };

      insertNewInteractiveElement(mockEditor, attributes);

      const chain = mockEditor._getChain();
      // Should fall back to creating bulletList (not replacing)
      expect(chain.insertContentAt).toHaveBeenCalledWith(
        { from: 5, to: 25 },
        expect.objectContaining({
          type: 'bulletList',
        })
      );
    });
  });

  describe('multistep with internal actions', () => {
    it('should include all internal action spans in paragraph content', () => {
      const mockEditor = createMockEditor({
        isInListItem: true,
        listItemPos: 0,
        listItemSize: 10,
        hasSelection: false,
      });

      const attributes = {
        'data-targetaction': ACTION_TYPES.MULTISTEP,
        class: CSS_CLASSES.INTERACTIVE,
        __internalActions: [
          {
            targetAction: 'highlight',
            refTarget: 'a[href="/admin"]',
          },
          {
            targetAction: 'formfill',
            refTarget: 'input[name="username"]',
            targetValue: 'admin',
          },
          {
            targetAction: 'button',
            refTarget: 'button.submit',
            requirements: 'exists-reftarget',
          },
        ],
      };

      insertNewInteractiveElement(mockEditor, attributes);

      const chain = mockEditor._getChain();
      const insertCall = chain.insertContentAt.mock.calls[0];
      const insertedContent = insertCall[1];

      // Should have paragraph with 3 interactive spans
      const paragraph = insertedContent.content[0];
      expect(paragraph.type).toBe('paragraph');
      expect(paragraph.content).toHaveLength(4); // 3 spans + 1 text node

      // Verify spans have correct attributes
      const spans = paragraph.content.filter((node: any) => node.type === 'interactiveSpan');
      expect(spans).toHaveLength(3);
      expect(spans[0].attrs).toMatchObject({
        'data-targetaction': 'highlight',
        'data-reftarget': 'a[href="/admin"]',
      });
      expect(spans[1].attrs).toMatchObject({
        'data-targetaction': 'formfill',
        'data-reftarget': 'input[name="username"]',
        'data-targetvalue': 'admin',
      });
      expect(spans[2].attrs).toMatchObject({
        'data-targetaction': 'button',
        'data-reftarget': 'button.submit',
        'data-requirements': 'exists-reftarget',
      });
    });

    it('should strip __internalActions from final attributes', () => {
      const mockEditor = createMockEditor({
        isInListItem: true,
        listItemPos: 0,
        listItemSize: 10,
        hasSelection: false,
      });

      const attributes = {
        'data-targetaction': ACTION_TYPES.MULTISTEP,
        class: CSS_CLASSES.INTERACTIVE,
        'data-requirements': 'exists-reftarget',
        __internalActions: [
          {
            targetAction: 'highlight',
            refTarget: 'button',
          },
        ],
      };

      insertNewInteractiveElement(mockEditor, attributes);

      const chain = mockEditor._getChain();
      const insertCall = chain.insertContentAt.mock.calls[0];
      const insertedContent = insertCall[1];

      // Final attributes should not include __internalActions
      expect(insertedContent.attrs).not.toHaveProperty('__internalActions');
      expect(insertedContent.attrs).toMatchObject({
        'data-targetaction': ACTION_TYPES.MULTISTEP,
        class: CSS_CLASSES.INTERACTIVE,
        'data-requirements': 'exists-reftarget',
      });
    });
  });
});
