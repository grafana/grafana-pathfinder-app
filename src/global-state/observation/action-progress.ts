const UNOBSERVABLE_ACTIONS: ReadonlySet<string> = new Set(['noop', 'popout']);
let stamp = 0;

export const nextObservationStamp = () => ++stamp;

export function nextRequiredAction(actions: ReadonlyArray<{ targetAction: string }>, cursor: number): number {
  while (UNOBSERVABLE_ACTIONS.has(actions[cursor]?.targetAction ?? '')) {
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
