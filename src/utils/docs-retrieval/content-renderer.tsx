// React Content Renderer - replaces dangerouslySetInnerHTML + DOM processing
// Converts raw HTML into proper React component trees

import React, { useRef, useEffect } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

import { RawContent } from './content.types';
import { generateJourneyContentWithExtras } from './learning-journey-helpers';
import { parseHTMLToComponents, ParsedElement } from './html-parser';
import { InteractiveSection, InteractiveStep, CodeBlock, ExpandableTable, ImageRenderer } from './components/interactive-components';

// Import existing styles - we'll use them until we have component-specific styles
import { journeyContentHtml, docsContentHtml } from '../../styles/content-html.styles';
import { getInteractiveStyles } from '../../styles/interactive.styles';

/**
 * Resolve relative URLs in HTML content (for non-image elements)
 * Images are now handled by the ImageRenderer component
 */
function resolveRelativeUrls(html: string, baseUrl: string): string {
    try {
      if (!baseUrl) {
        return html;
      }
  
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const baseUrlObj = new URL(baseUrl);
  
      // List of attributes that can contain URLs (excluding img attributes)
      const urlAttributes = ['href', 'action', 'poster', 'background'];
  
      urlAttributes.forEach(attr => {
        const elements = doc.querySelectorAll(`[${attr}]:not(img)`);
        elements.forEach(element => {
          const attrValue = element.getAttribute(attr);
          if (attrValue && attrValue.startsWith('/') && !attrValue.startsWith('//')) {
            const resolvedUrl = new URL(attrValue, baseUrlObj).href;
            element.setAttribute(attr, resolvedUrl);
          }
        });
      });
  
      // Prefer the body content for React rendering. Fallback to full HTML if not present.
      if (doc.body && doc.body.innerHTML && doc.body.innerHTML.trim()) {
        return doc.body.innerHTML;
      }
      return doc.documentElement.outerHTML;
    } catch (error) {
      console.warn('Failed to resolve relative URLs in content:', error);
      return html; // Return original HTML if processing fails
    }
  }
  

interface ContentRendererProps {
  /** Raw content to render */
  content: RawContent;
  
  /** Called when content is rendered and ready */
  onContentReady?: () => void;
  
  /** Additional CSS classes to apply */
  className?: string;
  
  /** Container ref for external access */
  containerRef?: React.RefObject<HTMLDivElement>;
}



/**
 * Main content renderer component
 * Uses React components for interactive elements and falls back to dangerouslySetInnerHTML for regular content
 */
export function ContentRenderer({ 
  content, 
  onContentReady, 
  className,
  containerRef 
}: ContentRendererProps) {
  const theme = useStyles2((theme: GrafanaTheme2) => theme);
  const internalRef = useRef<HTMLDivElement>(null);
  const activeRef = containerRef || internalRef;

  // Prepare content based on type
  const processedContent = React.useMemo(() => {
    let html = content.html;

    // STEP 1: Resolve relative URLs to absolute URLs
    // This fixes images like "/media/docs/..." to "https://grafana.com/media/docs/..."
    html = resolveRelativeUrls(html, content.url);

    // STEP 2: For learning journeys, add extra content (side journeys, navigation, etc.)
    if (content.type === 'learning-journey' && content.metadata.learningJourney) {
      html = generateJourneyContentWithExtras(html, content.metadata.learningJourney);
    }

    // HTML is now ready for rendering via React components or dangerouslySetInnerHTML
    return html;
  }, [content]);

  // Notify when content is ready
  useEffect(() => {
    if (onContentReady) {
      // Small delay to ensure DOM is updated
      const timer = setTimeout(onContentReady, 50);
      return () => clearTimeout(timer);
    }
  }, [processedContent, onContentReady]);

  // Create combined styles (temporary - will be replaced by proper component styles)
  const contentStyles = React.useMemo(() => {
    const baseStyles = content.type === 'learning-journey' 
      ? journeyContentHtml(theme)
      : docsContentHtml(theme);
    
    const interactiveStyles = getInteractiveStyles(theme);
    
    return `${baseStyles}\n${interactiveStyles}`;
  }, [content.type, theme]);

  return (
    <div 
      ref={activeRef}
      className={className}
      style={{ 
        // Ensure content can scroll and flows naturally
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0, // Allow flex child to shrink
        overflow: 'visible', // Don't restrict content overflow here
      }}
    >
      <style>{contentStyles}</style>
      
      {/* Process content using React components or dangerouslySetInnerHTML as needed */}
      <ContentProcessor
        html={processedContent}
        contentType={content.type}
        theme={theme}
        baseUrl={content.url}
        onReady={onContentReady}
      />
    </div>
  );
}

/**
 * Content processor component - handles HTML → React conversion
 * Uses React components for interactive elements, code blocks, etc.
 * Falls back to dangerouslySetInnerHTML for regular content
 */
interface ContentProcessorProps {
  html: string;
  contentType: 'learning-journey' | 'single-doc';
  theme: GrafanaTheme2;
  baseUrl: string; // Add baseUrl prop
  onReady?: () => void;
}

function ContentProcessor({ html, contentType, theme, baseUrl, onReady }: ContentProcessorProps) {
    const ref = useRef<HTMLDivElement>(null);
  
    // Always parse HTML and render as React components
    const parsedContent = parseHTMLToComponents(html, baseUrl);
  
    return (
      <div ref={ref}>
        {parsedContent.elements.map((element, index) => 
          renderParsedElement(element, index, theme)
        )}
      </div>
    );
  }

/**
 * Render a parsed element as a React component
 */
function renderParsedElement(
    element: ParsedElement,
    index: number,
    theme: GrafanaTheme2
  ): React.ReactNode {
    switch (element.type) {
      case 'interactive-section':
        return (
          <InteractiveSection
            key={index}
            title={element.props.title || 'Interactive Section'}
            isSequence={element.props.isSequence}
            requirements={element.props.requirements}
            outcomes={element.props.outcomes}
          >
            {element.children.map((child, childIndex) =>
              typeof child === 'string'
                ? child
                : renderParsedElement(child, childIndex, theme)
            )}
          </InteractiveSection>
        );
  
      case 'interactive-step':
        return (
          <InteractiveStep
            key={index}
            targetAction={element.props.targetAction}
            refTarget={element.props.refTarget}
            targetValue={element.props.targetValue}
            requirements={element.props.requirements}
            outcomes={element.props.outcomes}
            title={element.props.title}
          />
        );
  
      case 'image-renderer':
        return (
          <ImageRenderer
            key={index}
            src={element.props.src}
            dataSrc={element.props.dataSrc}
            alt={element.props.alt}
            className={element.props.className}
            title={element.props.title}
            baseUrl={element.props.baseUrl}
          />
        );
  
      case 'code-block':
        return (
          <CodeBlock
            key={index}
            code={element.props.code}
            language={element.props.language}
            showCopy={element.props.showCopy}
            inline={element.props.inline}
          />
        );
  
      case 'expandable-table':
        return (
          <ExpandableTable
            key={index}
            content={element.props.content}
            defaultCollapsed={element.props.defaultCollapsed}
            toggleText={element.props.toggleText}
          />
        );
  
      case 'raw-html':
        return (
          <div
            key={index}
            dangerouslySetInnerHTML={{ __html: element.props.html }}
          />
        );
  
      default:
        // Render as a standard HTML element (div, p, h1, etc.)
        return React.createElement(
          element.type,
          { key: index, ...element.props },
          // Here we handle children (could be string or ParsedElement)
          element.children.map((child, childIndex) =>
            typeof child === 'string'
              ? child
              : renderParsedElement(child, childIndex, theme)
          )
        );
    }
  }
  
/**
 * Export hook for easier usage in existing components
 */
export function useContentRenderer(content: RawContent | null) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = React.useState(false);

  const handleContentReady = React.useCallback(() => {
    setIsReady(true);
  }, []);

  const renderer = React.useMemo(() => {
    if (!content) {return null;}

    return (
      <ContentRenderer
        content={content}
        containerRef={containerRef}
        onContentReady={handleContentReady}
      />
    );
  }, [content, handleContentReady]);

  return {
    renderer,
    containerRef,
    isReady,
  };
} 
