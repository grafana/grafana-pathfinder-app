export function nextRequiredAction(actions: ReadonlyArray<{ targetAction: string }>, cursor: number): number {
  while (actions[cursor]?.targetAction === 'noop') {
    cursor++;
  }
  return cursor;
}

export function advanceActionProgress(
  actions: ReadonlyArray<{ targetAction: string }>,
  cursor: number,
  index: number
): number {
  return index === nextRequiredAction(actions, cursor) && actions[index]
    ? nextRequiredAction(actions, index + 1)
    : cursor;
}
