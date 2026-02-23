/**
 * JSON Position Utilities
 *
 * Functions for mapping JSON paths to line/column positions using jsonc-parser.
 * Used to enrich validation errors with position information for Monaco markers.
 */

import { parseTree, findNodeAtLocation, type ParseError, ParseErrorCode, type Node } from 'jsonc-parser';

/**
 * Positioned error with line/column information for Monaco markers
 */
export interface PositionedError {
  message: string;
  path: Array<string | number>;
  line?: number;
  column?: number;
}

/**
 * Convert a character offset to line/column (1-indexed).
 */
function offsetToPosition(text: string, offset: number): { line: number; column: number } {
  const beforeOffset = text.slice(0, offset);
  const lines = beforeOffset.split('\n');
  return {
    line: lines.length,
    column: (lines[lines.length - 1] ?? '').length + 1,
  };
}

/**
 * Get a human-readable message for jsonc-parser error codes.
 */
function getParseErrorMessage(errorCode: ParseErrorCode): string {
  const messages: Record<ParseErrorCode, string> = {
    [ParseErrorCode.InvalidSymbol]: 'Invalid symbol',
    [ParseErrorCode.InvalidNumberFormat]: 'Invalid number format',
    [ParseErrorCode.PropertyNameExpected]: 'Property name expected',
    [ParseErrorCode.ValueExpected]: 'Value expected',
    [ParseErrorCode.ColonExpected]: 'Colon expected',
    [ParseErrorCode.CommaExpected]: 'Comma expected',
    [ParseErrorCode.CloseBraceExpected]: 'Closing brace expected',
    [ParseErrorCode.CloseBracketExpected]: 'Closing bracket expected',
    [ParseErrorCode.EndOfFileExpected]: 'End of file expected',
    [ParseErrorCode.InvalidCommentToken]: 'Invalid comment',
    [ParseErrorCode.UnexpectedEndOfComment]: 'Unexpected end of comment',
    [ParseErrorCode.UnexpectedEndOfString]: 'Unexpected end of string',
    [ParseErrorCode.UnexpectedEndOfNumber]: 'Unexpected end of number',
    [ParseErrorCode.InvalidUnicode]: 'Invalid unicode escape',
    [ParseErrorCode.InvalidEscapeCharacter]: 'Invalid escape character',
    [ParseErrorCode.InvalidCharacter]: 'Invalid character',
  };
  return messages[errorCode] || 'Unknown parse error';
}

export interface ParseWithPositionsResult {
  /** Parse error with position, if JSON is malformed */
  parseError: PositionedError | null;
  /** Map a validation path to line/column position */
  pathToPosition: (path: Array<string | number>) => { line: number; column: number } | null;
  /** The parsed AST (undefined if parse failed) */
  tree: Node | undefined;
}

/**
 * Parse JSON and provide path-to-position mapping for validation errors.
 */
export function parseWithPositions(jsonString: string): ParseWithPositionsResult {
  const parseErrors: ParseError[] = [];
  const tree = parseTree(jsonString, parseErrors, { allowTrailingComma: false });

  // If there are parse errors, return the first one with position
  if (parseErrors.length > 0) {
    const error = parseErrors[0]!;
    const position = offsetToPosition(jsonString, error.offset);
    return {
      parseError: {
        message: getParseErrorMessage(error.error),
        path: [],
        line: position.line,
        column: position.column,
      },
      pathToPosition: () => null,
      tree: undefined,
    };
  }

  // Create path-to-position mapper
  const pathToPosition = (path: Array<string | number>): { line: number; column: number } | null => {
    if (!tree) {
      return null;
    }

    const node = findNodeAtLocation(tree, path);
    if (!node) {
      return null;
    }

    return offsetToPosition(jsonString, node.offset);
  };

  return {
    parseError: null,
    pathToPosition,
    tree,
  };
}

/**
 * Enrich validation errors with line/column positions.
 */
export function addPositionsToErrors(
  errors: Array<{ message: string; path: Array<string | number> }>,
  jsonString: string
): PositionedError[] {
  const { parseError, pathToPosition } = parseWithPositions(jsonString);

  // If JSON couldn't be parsed, return the parse error
  if (parseError) {
    return [parseError];
  }

  // Map each validation error to a position
  return errors.map((error) => {
    const position = pathToPosition(error.path);
    return {
      ...error,
      line: position?.line,
      column: position?.column,
    };
  });
}
