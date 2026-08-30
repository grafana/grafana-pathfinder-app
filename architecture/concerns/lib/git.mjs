import { usageError } from './errors.mjs';

export const LITERAL_REVISION = /^[0-9a-f]{7,40}$/i;
export const NUL = '\x00';

// Revisions are the only caller-supplied values that ever reach Git, and they
// are restricted to literal object names. Changed paths and diff text never do,
// so a filename containing shell metacharacters cannot influence a command.
export function assertLiteralRevision(value, flag) {
  if (typeof value !== 'string' || !LITERAL_REVISION.test(value)) {
    throw usageError(`${flag} must be a literal Git commit SHA of 7 to 40 hex characters`);
  }
  return value;
}

export function changedPathsArgs(base, head) {
  return [
    'diff',
    '--no-color',
    '--name-only',
    '-z',
    assertLiteralRevision(base, '--base'),
    assertLiteralRevision(head, '--head'),
  ];
}

export function unifiedDiffArgs(base, head) {
  return [
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--unified=3',
    assertLiteralRevision(base, '--base'),
    assertLiteralRevision(head, '--head'),
  ];
}

export function trackedFilesArgs() {
  return ['ls-files', '-z'];
}

export function splitNulList(output) {
  return output.split(NUL).filter((entry) => entry.length > 0);
}
