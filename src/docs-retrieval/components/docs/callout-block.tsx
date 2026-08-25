import React from 'react';

export interface CalloutBlockProps {
  /** Author-supplied HTML id, emitted on the wrapper for deep-linking */
  id?: string;
  /** Label shown at the top of the box, e.g. "Objective" */
  title: string;
  children?: React.ReactNode;
}

/**
 * Presentational callout — a labeled, colored box for calling out anything
 * the author wants to set apart. Reuses the visual language of the
 * `.admonition-*` classes in content-html.styles.ts (which style
 * externally-sourced docs HTML) under its own `.callout` class name.
 */
export function CalloutBlock({ id, title, children }: CalloutBlockProps) {
  return (
    <div className="callout" id={id} data-testid="callout-block">
      <div className="callout-label">{title}</div>
      {children}
    </div>
  );
}
