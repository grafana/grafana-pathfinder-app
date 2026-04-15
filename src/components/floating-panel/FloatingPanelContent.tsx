import React, { useRef } from 'react';
import { useStyles2 } from '@grafana/ui';
import { ContentRenderer } from '../../docs-retrieval';
import { journeyContentHtml, docsContentHtml } from '../../styles/content-html.styles';
import { getInteractiveStyles } from '../../styles/interactive.styles';
import { getPrismStyles } from '../../styles/prism.styles';
import type { RawContent } from '../../types/content.types';

interface FloatingPanelContentProps {
  /** The guide content to render */
  content: RawContent | null;
  /** Called when a guide completes all interactive sections */
  onGuideComplete?: () => void;
}

/**
 * Renders guide content inside the floating panel.
 *
 * Uses the same full scrollable view as the sidebar — the guide renders
 * identically with all sections, auto-collapse on completion, and the
 * full interactive engine. No pagination or step slicing.
 */
export function FloatingPanelContent({ content, onGuideComplete }: FloatingPanelContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const journeyStyles = useStyles2(journeyContentHtml);
  const docsStyles = useStyles2(docsContentHtml);
  const interactiveStyles = useStyles2(getInteractiveStyles);
  const prismStyles = useStyles2(getPrismStyles);

  if (!content) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-secondary)' }}>No guide content loaded</div>
    );
  }

  const contentClassName = `${content.type === 'learning-journey' ? journeyStyles : docsStyles} ${interactiveStyles} ${prismStyles}`;

  return (
    <div ref={contentRef}>
      <ContentRenderer
        key={content.url}
        content={content}
        containerRef={contentRef}
        className={contentClassName}
        onGuideComplete={onGuideComplete}
      />
    </div>
  );
}
