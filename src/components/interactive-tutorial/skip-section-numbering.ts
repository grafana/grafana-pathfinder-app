/**
 * Opt-out marker for section child numbering.
 *
 * `section-numbering.tsx` excludes wrapper components from the `1. 2. 3.`
 * sequence. Components tag themselves at definition time instead of
 * `section-numbering` importing them for identity checks — importing
 * `InteractiveConditional` there closed an import cycle through
 * `interactive-section.tsx` (#1359).
 */

import type React from 'react';

const SKIP_SECTION_NUMBERING = Symbol.for('pathfinder.skipSectionNumbering');

export function markSkipsSectionNumbering<T extends React.ComponentType<any>>(component: T): T {
  (component as unknown as Record<symbol, boolean>)[SKIP_SECTION_NUMBERING] = true;
  return component;
}

export function skipsSectionNumbering(type: unknown): boolean {
  // memo/forwardRef components are exotic objects, not functions — the marker
  // survives wrapping only if we read it off objects too.
  const canCarryMarker = typeof type === 'function' || (typeof type === 'object' && type !== null);
  return canCarryMarker && (type as unknown as Record<symbol, boolean>)[SKIP_SECTION_NUMBERING] === true;
}
