import React, { useRef, useMemo } from 'react';
import { Button, useStyles2 } from '@grafana/ui';
import { ContentRenderer } from '../../docs-retrieval';
import { journeyContentHtml, docsContentHtml } from '../../styles/content-html.styles';
import { getInteractiveStyles } from '../../styles/interactive.styles';
import { getPrismStyles } from '../../styles/prism.styles';
import { useStepNavigator } from './StepNavigator';
import type { RawContent } from '../../types/content.types';
import type { JsonGuide } from '../../types/json-guide.types';

interface FloatingPanelContentProps {
  /** The guide content to render */
  content: RawContent | null;
  /** Called when a guide completes all interactive sections */
  onGuideComplete?: () => void;
}

/**
 * Renders guide content inside the floating panel.
 *
 * For guides with interactive sections: uses StepNavigator to show
 * one section at a time in wizard mode with prev/next navigation.
 *
 * For pure documentation: falls back to a scrollable full-content view.
 */
export function FloatingPanelContent({ content, onGuideComplete }: FloatingPanelContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const journeyStyles = useStyles2(journeyContentHtml);
  const docsStyles = useStyles2(docsContentHtml);
  const interactiveStyles = useStyles2(getInteractiveStyles);
  const prismStyles = useStyles2(getPrismStyles);

  const nav = useStepNavigator(content);

  // Build a "sliced" RawContent that only contains the current step's blocks
  const stepContent = useMemo((): RawContent | null => {
    if (!content || !nav.hasInteractiveSections || !nav.currentStep) {
      return content;
    }

    // Reconstruct a JSON guide with only the current step's blocks
    try {
      const fullGuide: JsonGuide = JSON.parse(content.content);
      const slicedGuide: JsonGuide = {
        ...fullGuide,
        blocks: nav.currentStep.blocks,
      };
      return {
        ...content,
        content: JSON.stringify(slicedGuide),
        // Append step index to URL so ContentRenderer treats each step as unique content
        url: `${content.url}#floating-step-${nav.currentStepIndex}`,
      };
    } catch {
      return content;
    }
  }, [content, nav.hasInteractiveSections, nav.currentStep, nav.currentStepIndex]);

  if (!content || !stepContent) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-secondary)' }}>No guide content loaded</div>
    );
  }

  const contentClassName = `${content.type === 'learning-journey' ? journeyStyles : docsStyles} ${interactiveStyles} ${prismStyles}`;

  return (
    <>
      <div ref={contentRef} style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <ContentRenderer
          key={stepContent.url}
          content={stepContent}
          containerRef={contentRef}
          className={contentClassName}
          onGuideComplete={onGuideComplete}
        />
      </div>
      {nav.hasInteractiveSections && nav.totalSteps > 1 && <StepNavigation nav={nav} />}
    </>
  );
}

/**
 * Step navigation footer with prev/next buttons and progress bar.
 * Only rendered when the guide has multiple wizard steps.
 */
function StepNavigation({ nav }: { nav: ReturnType<typeof useStepNavigator> }) {
  const progressPercent = nav.totalSteps > 0 ? ((nav.currentStepIndex + 1) / nav.totalSteps) * 100 : 0;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 8px',
        borderTop: '1px solid var(--border-weak)',
        backgroundColor: 'var(--background-secondary)',
        flexShrink: 0,
        gap: 8,
      }}
    >
      <Button variant="secondary" size="sm" icon="arrow-left" disabled={nav.isFirst} onClick={nav.goPrev}>
        Prev
      </Button>
      <div
        style={{
          flex: 1,
          height: 4,
          borderRadius: 2,
          backgroundColor: 'var(--background-canvas)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progressPercent}%`,
            borderRadius: 2,
            backgroundColor: 'var(--primary-main)',
            transition: 'width 200ms ease-out',
          }}
        />
      </div>
      <Button variant="secondary" size="sm" disabled={nav.isLast} onClick={nav.goNext}>
        Next
        <span style={{ marginLeft: 4 }}>&rarr;</span>
      </Button>
    </div>
  );
}
