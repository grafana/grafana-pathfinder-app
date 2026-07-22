import React, { useId, useState } from 'react';

export interface CollapsibleBlockProps {
  /** Author-supplied HTML id, emitted on the wrapper for deep-linking */
  id?: string;
  /** Label shown on the toggle control */
  title?: string;
  /** Whether the block starts collapsed. Defaults to true. */
  collapsed?: boolean;
  children?: React.ReactNode;
}

const DEFAULT_TITLE = 'Show more';

/**
 * Presentational collapsible container. Hides its children behind a toggle so
 * guide authors can gate solutions or answers until a learner reveals them.
 * Reuses the shared `journey-collapse` styles (see content-html.styles.ts).
 */
export function CollapsibleBlock({ id, title, collapsed = true, children }: CollapsibleBlockProps) {
  const [isCollapsed, setIsCollapsed] = useState(collapsed);
  const contentId = useId();

  return (
    <div className="journey-collapse" id={id} data-testid="collapsible-block">
      <button
        onClick={() => setIsCollapsed((prev) => !prev)}
        className="journey-collapse-trigger"
        type="button"
        aria-expanded={!isCollapsed}
        aria-controls={contentId}
        data-testid="collapsible-toggle"
      >
        <span>{title || DEFAULT_TITLE}</span>
        <span className={`journey-collapse-icon${isCollapsed ? ' collapsed' : ''}`} aria-hidden="true">
          ▼
        </span>
      </button>
      {!isCollapsed && (
        <div className="journey-collapse-content" id={contentId}>
          {children}
        </div>
      )}
    </div>
  );
}
