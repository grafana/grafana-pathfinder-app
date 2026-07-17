/**
 * Section child numbering helpers.
 *
 * Per issue #841: media and wrapper blocks render in a section without
 * a step number; everything else (markdown, code samples, interactive
 * steps, quiz, terminal, input, etc.) participates in the section's
 * `1. 2. 3.` sequence.
 *
 * Lookups happen at call time, not module-init time — the
 * docs-retrieval barrel imports content-renderer, which imports back
 * into this directory, so a top-level
 * `new Set([ImageRenderer, ...])` would resolve to undefined under
 * cycle load order. By checking inside the function, both modules
 * have finished initializing by the first invocation.
 */

import React from 'react';

import { ImageRenderer, VideoRenderer, YouTubeVideoRenderer, VimeoVideoRenderer } from '../../docs-retrieval';
import { InteractiveConditional } from './interactive-conditional';

/** Returns `true` if the child should receive a step number in the
 *  section's ordered list. Media (image/video/youtube) and wrapper
 *  (conditional) blocks return `false`. Non-element children
 *  (strings, fragments) also return `false`. */
export function shouldNumberSectionChild(child: React.ReactNode): boolean {
  if (!React.isValidElement(child)) {
    // Plain strings / numbers / fragments — render but don't number.
    return false;
  }
  const t = child.type;
  return (
    t !== ImageRenderer &&
    t !== VideoRenderer &&
    t !== YouTubeVideoRenderer &&
    t !== VimeoVideoRenderer &&
    t !== InteractiveConditional
  );
}

/**
 * Wrap each section child in an `<li>`, marking content blocks with
 * `data-numbered="true"` so CSS can apply sequential numbering.
 * Media and wrapper blocks (image/video/conditional) sit in the list
 * without a number.
 *
 * `data-step="true"`  → React component (InteractiveStep, quiz,
 *   terminal, etc.). These carry their own CSS margin-top that
 *   naturally aligns the card with the `::before` number at
 *   `top: theme.spacing(2)`. The `<li>` needs no extra padding.
 * `data-step="false"` → Plain HTML content (markdown `<p>`, headings,
 *   etc.). No built-in top margin, so the `<li>` gets `paddingTop`
 *   via CSS to push the content start down to match the number
 *   position.
 */
export function wrapSectionChildrenForNumbering(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child, index) => {
    const numbered = shouldNumberSectionChild(child);
    const childKey = React.isValidElement(child) && child.key != null ? child.key : `section-child-${index}`;
    // React components (interactive steps, quiz, terminal…) have typeof type === 'function'.
    // Plain HTML elements (p, div, h2…) have typeof type === 'string'.
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
