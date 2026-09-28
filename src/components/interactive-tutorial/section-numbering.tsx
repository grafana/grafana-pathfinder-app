/**
 * Renderer identity checks stay inside the function because the docs-retrieval
 * barrel imports back into this directory; a top-level set can capture
 * undefined during cycle initialization.
 */

import React from 'react';

import { ImageRenderer, VideoRenderer, YouTubeVideoRenderer, VimeoVideoRenderer } from '../../docs-retrieval';

export function shouldNumberSectionChild(child: React.ReactNode): boolean {
  if (!React.isValidElement(child)) {
    return false;
  }
  const t = child.type;
  return t !== ImageRenderer && t !== VideoRenderer && t !== YouTubeVideoRenderer && t !== VimeoVideoRenderer;
}

/** `data-step` keeps plain HTML alignment separate from step-card spacing. */
export function wrapSectionChildrenForNumbering(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child, index) => {
    const numbered = shouldNumberSectionChild(child);
    const childKey = React.isValidElement(child) && child.key != null ? child.key : `section-child-${index}`;
    const isStep = React.isValidElement(child) && typeof child.type !== 'string';
    return (
      <li
        key={childKey}
        data-numbered={numbered ? 'true' : undefined}
        data-step={numbered ? String(isStep) : undefined}
      >
        {child}
      </li>
    );
  });
}
