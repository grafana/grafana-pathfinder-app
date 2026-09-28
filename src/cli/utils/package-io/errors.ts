/**
 * Stable error codes and `PackageIOError` exception type for the package-io
 * layer. Every other module in this directory throws or returns these codes;
 * the strings are part of the public MCP-shell-out contract once Phase 3
 * lands, so don't rename casually.
 */

export type PackageIOErrorCode =
  | 'NOT_FOUND'
  | 'CONTENT_MISSING'
  | 'INVALID_JSON'
  | 'SCHEMA_VALIDATION'
  | 'ID_MISMATCH'
  | 'SCHEMA_VERSION_MISMATCH'
  | 'BLOCK_NOT_FOUND'
  | 'CONTAINER_NOT_FOUND'
  | 'PARENT_NOT_CONTAINER'
  | 'WRONG_PARENT_KIND'
  | 'BRANCH_REQUIRED'
  | 'DUPLICATE_ID'
  | 'CONTAINER_REQUIRES_ID'
  | 'CONTAINER_HAS_CHILDREN'
  | 'IF_ABSENT_CONFLICT'
  | 'INVALID_OPTIONS'
  | 'QUIZ_CORRECT_COUNT'
  | 'UNKNOWN_REQUIREMENT'
  | 'WRITE_FAILED';

/**
 * The command that resolves an issue, named rather than spelled.
 *
 * `{ command: 'rename-id', args: ['<dir>', '<chosen-id>'] }` is what a surface needs
 * to say "run `pathfinder-cli rename-id <dir> <chosen-id>`" — or, for a surface where
 * that command is not reachable, to say nothing. Writing the recipe into the message
 * instead put a command line in every reader's mouth, including the ones that have no
 * shell.
 */
export interface IssueRemedy {
  /** A manifest command name. */
  command: string;
  /** Its arguments, as placeholders or literals. */
  args?: readonly string[];
}

export interface PackageIOIssue {
  code: PackageIOErrorCode;
  message: string;
  path?: string[];
  remedy?: IssueRemedy;
}

export class PackageIOError extends Error {
  readonly code: PackageIOErrorCode;
  readonly issues: PackageIOIssue[];

  constructor(issue: PackageIOIssue, issues?: PackageIOIssue[]) {
    super(issue.message);
    this.name = 'PackageIOError';
    this.code = issue.code;
    this.issues = issues ?? [issue];
  }
}
