export const PATHFINDER_CONTENT_SELECTOR = '[data-pathfinder-content="true"]';

export function isPathfinderContent(el: Element): boolean {
  return el.closest(PATHFINDER_CONTENT_SELECTOR) !== null;
}
