/**
 * The one derivation of a `section` container's runtime id.
 *
 * Three parties have to agree on it or evidence goes nowhere: the parser
 * (which stamps it on the rendered section and keys its children's step ids
 * off it), the rendered section (which records an acknowledgement under it),
 * and the block index (which keys `containerEndPositions` under it so that
 * acknowledgement resolves to a position). Each deriving its own was the
 * defect — a render-order counter on one side and a path on the other — so
 * this is the shared function all three call.
 *
 * An author id is stable across renders and reparses. A section without one is
 * addressed by where it sits in the tree, which is stable for the same JSON
 * and is the only other thing both sides can see.
 */
export function sectionRuntimeId(authorId: string | undefined, jsonPath: string): string {
  return authorId ? `section-${authorId}` : `section:${jsonPath}`;
}
