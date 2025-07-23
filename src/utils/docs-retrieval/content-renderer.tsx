import React, { useRef, useEffect } from 'react';
import { GrafanaTheme2 } from '@grafana/data';

import { RawContent, ContentParseResult } from './content.types';
import { generateJourneyContentWithExtras } from './learning-journey-helpers';
import { parseHTMLToComponents, ParsedElement } from './html-parser';
import { InteractiveSection, InteractiveStep, CodeBlock, ExpandableTable, ImageRenderer, ContentParsingError } from './components/interactive-components';

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
  content: RawContent;
  onContentReady?: () => void;
  className?: string;
  containerRef?: React.RefObject<HTMLDivElement>;
}

export function ContentRenderer({ 
  content, 
  onContentReady, 
  className,
  containerRef 
}: ContentRendererProps) {
  const internalRef = useRef<HTMLDivElement>(null);
  const activeRef = containerRef || internalRef;

  const processedContent = React.useMemo(() => {
    let html = content.html;
    html = resolveRelativeUrls(html, content.url);
    if (content.type === 'learning-journey' && content.metadata.learningJourney) {
      html = generateJourneyContentWithExtras(html, content.metadata.learningJourney);
    }
    return html;
  }, [content]);

  useEffect(() => {
    if (onContentReady) {
      const timer = setTimeout(onContentReady, 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [processedContent, onContentReady]);

  return (
    <div 
      ref={activeRef}
      className={className}
      style={{ 
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'visible',
      }}
    >
      <ContentProcessor
        html={processedContent}
        contentType={content.type}
        baseUrl={content.url}
        onReady={onContentReady}
      />
    </div>
  );
}

interface ContentProcessorProps {
  html: string;
  contentType: 'learning-journey' | 'single-doc';
  theme?: GrafanaTheme2;
  baseUrl: string;
  onReady?: () => void;
}

function ContentProcessor({ html, contentType, baseUrl, onReady }: ContentProcessorProps) {
  const ref = useRef<HTMLDivElement>(null);
  
  // Parse HTML with fail-fast error handling
  const parseResult: ContentParseResult = parseHTMLToComponents(html, baseUrl);
  
  // Single decision point: either we have valid React components or we display errors
  if (!parseResult.isValid) {
    console.error('[DocsPlugin] Content parsing failed:', parseResult.errors);
    return (
      <div ref={ref}>
        <ContentParsingError
          errors={parseResult.errors}
          warnings={parseResult.warnings}
          fallbackHtml={html}
          onRetry={() => {
            // In a real implementation, this could trigger a re-parse or content refetch
            console.log('Retry parsing requested');
            window.location.reload();
          }}
        />
      </div>
    );
  }

  // Success case: render parsed content
  const { data: parsedContent } = parseResult;
  
  if (!parsedContent) {
    console.error('[DocsPlugin] Parsing succeeded but no data returned');
    return (
      <div ref={ref}>
        <ContentParsingError
          errors={[{
            type: 'html_parsing',
            message: 'Parsing succeeded but no content data was returned',
            location: 'ContentProcessor'
          }]}
          warnings={parseResult.warnings}
          fallbackHtml={html}
        />
      </div>
    );
  }

  return (
    <div ref={ref}>
      {parsedContent.elements.map((element, index) => 
        renderParsedElement(element, `element-${index}`)
      )}
    </div>
  );
}

function renderParsedElement(
  element: ParsedElement | ParsedElement[],
  key: string | number
): React.ReactNode {
  if (Array.isArray(element)) {
    return element.map((child, i) => renderParsedElement(child, `${key}-${i}`));
  }
  
  // Handle special cases first
  switch (element.type) {
    case 'interactive-section':
      return (
        <InteractiveSection
          key={key}
          title={element.props.title || 'Interactive Section'}
          isSequence={element.props.isSequence}
          requirements={element.props.requirements}
          outcomes={element.props.outcomes}
        >
          {element.children.map((child: ParsedElement | string, childIndex: number) =>
            typeof child === 'string'
              ? child
              : renderParsedElement(child, `${key}-child-${childIndex}`)
          )}
        </InteractiveSection>
      );
    case 'interactive-step':
      return (
        <InteractiveStep
          key={key}
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
          key={key}
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
          key={key}
          code={element.props.code}
          language={element.props.language}
          showCopy={element.props.showCopy}
          inline={element.props.inline}
        />
      );
    case 'expandable-table':
      return (
        <ExpandableTable
          key={key}
          content={element.props.content}
          defaultCollapsed={element.props.defaultCollapsed}
          toggleText={element.props.toggleText}
        />
      );
    case 'raw-html':
      // This should only be used for specific known-safe content
      console.warn('[DocsPlugin] Rendering raw HTML - this should be rare in the new architecture');
      return (
        <div
          key={key}
          dangerouslySetInnerHTML={{ __html: element.props.html }}
        />
      );
    default:
      // Standard HTML elements - strict validation
      if (!element.type || (typeof element.type !== 'string' && typeof element.type !== 'function')) {
        console.error('[DocsPlugin] Invalid element type for parsed element:', element);
        throw new Error(`Invalid element type: ${element.type}. This should have been caught during parsing.`);
      }
      
      // Handle void/self-closing elements that shouldn't have children
      const voidElements = new Set([
        'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
        'link', 'meta', 'param', 'source', 'track', 'wbr'
      ]);
      
      if (typeof element.type === 'string' && voidElements.has(element.type)) {
        // Void elements should not have children
        return React.createElement(
          element.type,
          { key, ...element.props }
        );
      } else {
        // Regular elements can have children
        const children = element.children?.map((child: ParsedElement | string, childIndex: number) => {
          if (typeof child === 'string') {
            // Preserve whitespace in text content
            return child.length > 0 ? child : null;
          }
          return renderParsedElement(child, `${key}-child-${childIndex}`);
        }).filter((child: React.ReactNode) => child !== null);
        
        return React.createElement(
          element.type,
          { key, ...element.props },
          ...(children && children.length > 0 ? children : [])
        );
      }
  }
}

export function useContentRenderer(content: RawContent | null) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = React.useState(false);

  const handleContentReady = React.useCallback(() => {
    setIsReady(true);
  }, []);

  const renderer = React.useMemo(() => {
    if (!content) { return null; }
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
