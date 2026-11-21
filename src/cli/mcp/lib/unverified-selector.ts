import { readJsonGuideAliasedField } from '../../../types/json-guide-aliases';
import type { ContentJson } from '../../../types/package.types';
import type { CommandOutcome } from '../../utils/output';
import { findBlockById } from '../../utils/package-io/tree';

const PLACEHOLDER = /TODO-/;
const ID_PATH = /^<id:(.+)>\/reftarget$/;
const PATH_TOKEN = /([^.[\]/]+)|\[(\d+)\]/g;

function nodeAt(content: ContentJson, path: string): Record<string, unknown> | undefined {
  const idMatch = ID_PATH.exec(path);
  if (idMatch) {
    return (findBlockById(content, idMatch[1]!) as unknown as Record<string, unknown>) ?? undefined;
  }
  let node: unknown = content;
  for (const [, key, index] of path.replace(/\/reftarget$/, '').matchAll(PATH_TOKEN)) {
    node = (node as Record<string, unknown> | undefined)?.[key ?? Number(index)];
  }
  return typeof node === 'object' && node !== null ? (node as Record<string, unknown>) : undefined;
}

/** MCP acks keep `UNVERIFIED_SELECTOR` only for selectors that are neither placeholders, navigate targets, nor in the verified index. */
export function dropVerifiedSelectorWarnings(
  outcome: CommandOutcome,
  content: ContentJson,
  verifiedSelectors: ReadonlySet<string>
): CommandOutcome {
  if (outcome.status !== 'ok' || !outcome.warnings?.some((warning) => warning.code === 'UNVERIFIED_SELECTOR')) {
    return outcome;
  }
  const { warnings, ...rest } = outcome;
  const kept = warnings.filter((warning) => {
    if (warning.code !== 'UNVERIFIED_SELECTOR') {
      return true;
    }
    const node = warning.path === undefined ? undefined : nodeAt(content, warning.path);
    const reftarget = node && readJsonGuideAliasedField(node, 'reftarget');
    return !(
      typeof reftarget === 'string' &&
      (PLACEHOLDER.test(reftarget) ||
        verifiedSelectors.has(reftarget) ||
        (node && readJsonGuideAliasedField(node, 'action') === 'navigate'))
    );
  });
  return kept.length > 0 ? { ...rest, warnings: kept } : rest;
}
