import React from 'react';

export interface CalloutBlockProps {
  /** Author-supplied HTML id, emitted on the wrapper for deep-linking */
  id?: string;
  /** Label shown at the top of the box, e.g. "Objective" */
  title: string;
  children?: React.ReactNode;
}

export function CalloutBlock({ id, title, children }: CalloutBlockProps) {
  return (
    <div className="callout" id={id} data-guide-admonition="neutral" data-testid="callout-block">
      <div className="callout-content">
        <div className="callout-label">{title}</div>
        {children}
      </div>
    </div>
  );
}
