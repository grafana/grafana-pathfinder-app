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

export interface PackageIOIssue {
  code: PackageIOErrorCode;
  message: string;
  path?: string[];
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
