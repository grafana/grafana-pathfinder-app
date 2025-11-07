export function isValidEvent(event: MouseEvent) {
  return didNotUseModifierKeys(event) && isAnchorElement(event) && isInsidePathfinderContent(event);
}

function didNotUseModifierKeys(event: MouseEvent) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
    return false;
  }

  return true;
}

function isAnchorElement({ target }: MouseEvent) {
  return target instanceof Element && target.closest('a[href]') !== null;
}

function isInsidePathfinderContent({ target }: MouseEvent) {
  return target instanceof Element && target.closest('[data-pathfinder-content]') === null;
}
