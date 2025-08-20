import React, { useRef, useEffect } from 'react';
import { GrafanaTheme2 } from '@grafana/data';

import { RawContent, ContentParseResult } from './content.types';
import { generateJourneyContentWithExtras } from './learning-journey-helpers';
import { parseHTMLToComponents, ParsedElement } from './html-parser';
import {
  InteractiveSection,
  InteractiveStep,
  InteractiveMultiStep,
  CodeBlock,
  ExpandableTable,
  ImageRenderer,
  ContentParsingError,
  resetInteractiveCounters,
  VideoRenderer,
} from './components/interactive-components';
import { SequentialRequirementsManager } from '../requirements-checker.hook';

function resolveRelativeUrls(html: string, baseUrl: string): string {
  try {
    if (!baseUrl) {
      return html;
    }

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const baseUrlObj = new URL(baseUrl);

    // List of attributes that can contain URLs (excluding img attributes)
    const urlAttributes = ['href', 'action', 'poster', 'background'];

    urlAttributes.forEach((attr) => {
      const elements = doc.querySelectorAll(`[${attr}]:not(img)`);
      elements.forEach((element) => {
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

/**
 * Scroll to and highlight an element with the given fragment ID
 */
function scrollToFragment(fragment: string, container: HTMLElement): void {
  try {
    // Try multiple selectors to find the target element
    const selectors = [`#${fragment}`, `[id="${fragment}"]`, `[name="${fragment}"]`, `a[name="${fragment}"]`];

    let targetElement: HTMLElement | null = null;

    for (const selector of selectors) {
      targetElement = container.querySelector(selector) as HTMLElement;
      if (targetElement) {
        break;
      }
    }

    if (targetElement) {
      // Scroll to the element with smooth behavior
      targetElement.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
        inline: 'nearest',
      });

      // Add highlight effect
      targetElement.classList.add('fragment-highlight');

      // Remove highlight after animation
      setTimeout(() => {
        targetElement!.classList.remove('fragment-highlight');
      }, 3000);

      console.warn(`📍 Scrolled to fragment #${fragment}`);
    } else {
      console.warn(`Fragment element not found: #${fragment}`);
    }
  } catch (error) {
    console.warn(`Error scrolling to fragment #${fragment}:`, error);
  }
}

interface ContentRendererProps {
  content: RawContent;
  onContentReady?: () => void;
  className?: string;
  containerRef?: React.RefObject<HTMLDivElement>;
}

export function ContentRenderer({ content, onContentReady, className, containerRef }: ContentRendererProps) {
  const internalRef = useRef<HTMLDivElement>(null);
  const activeRef = containerRef || internalRef;

  // Expose current content key globally for interactive persistence
  useEffect(() => {
    try {
      (window as any).__DocsPluginContentKey = content?.url || '';
    } catch {
      // no-op
    }
  }, [content?.url]);

  const processedContent = React.useMemo(() => {
    let html = content.html;
    html = resolveRelativeUrls(html, content.url);
    if (content.type === 'learning-journey' && content.metadata.learningJourney) {
      html = generateJourneyContentWithExtras(html, content.metadata.learningJourney);
    }
    return html;
  }, [content]);

  // Handle fragment scrolling after content renders
  useEffect(() => {
    if (content.hashFragment && activeRef.current) {
      // Wait for content to fully render before scrolling
      const timer = setTimeout(() => {
        scrollToFragment(content.hashFragment!, activeRef.current!);
      }, 100);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedContent, content.hashFragment]);

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

  // Reset interactive counters to ensure consistent sequential IDs for each new content
  resetInteractiveCounters();

  // Parse HTML with fail-fast error handling
  const parseResult: ContentParseResult = parseHTMLToComponents(html, baseUrl);

  // Start DOM monitoring if interactive elements are present
  useEffect(() => {
    if (parseResult.isValid && parseResult.data) {
      const hasInteractiveElements = parseResult.data.elements.some(
        (el) => el.type === 'interactive-section' || el.type === 'interactive-step'
      );

      if (hasInteractiveElements) {
        const manager = SequentialRequirementsManager.getInstance();
        manager.startDOMMonitoring();

        return () => {
          manager.stopDOMMonitoring();
        };
      }
    }
    return undefined;
  }, [parseResult]);

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
          errors={[
            {
              type: 'html_parsing',
              message: 'Parsing succeeded but no content data was returned',
              location: 'ContentProcessor',
            },
          ]}
          warnings={parseResult.warnings}
          fallbackHtml={html}
        />
      </div>
    );
  }

  return (
    <div ref={ref}>
      {parsedContent.elements.map((element, index) => renderParsedElement(element, `element-${index}`))}
    </div>
  );
}

function renderParsedElement(element: ParsedElement | ParsedElement[], key: string | number): React.ReactNode {
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
          objectives={element.props.objectives}
          hints={element.props.hints}
          id={element.props.id} // Pass the HTML id attribute
        >
          {element.children.map((child: ParsedElement | string, childIndex: number) =>
            typeof child === 'string' ? child : renderParsedElement(child, `${key}-child-${childIndex}`)
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
          targetComment={element.props.targetComment}
          doIt={element.props.doIt}
          requirements={element.props.requirements}
          objectives={element.props.objectives}
          title={element.props.title}
        >
          {element.children.map((child: ParsedElement | string, childIndex: number) =>
            typeof child === 'string' ? child : renderParsedElement(child, `${key}-child-${childIndex}`)
          )}
        </InteractiveStep>
      );
    case 'interactive-multi-step':
      return (
        <InteractiveMultiStep
          key={key}
          internalActions={element.props.internalActions}
          requirements={element.props.requirements}
          objectives={element.props.objectives}
          hints={element.props.hints}
          title={element.props.title}
        >
          {element.children.map((child: ParsedElement | string, childIndex: number) =>
            typeof child === 'string' ? child : renderParsedElement(child, `${key}-child-${childIndex}`)
          )}
        </InteractiveMultiStep>
      );
    case 'video':
      return (
        <VideoRenderer
          key={key}
          src={element.props.src}
          baseUrl={element.props.baseUrl}
          onClick={element.props.onClick}
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
          className={element.props.className}
          isCollapseSection={element.props.isCollapseSection}
        >
          {element.children.map((child: ParsedElement | string, childIndex: number) =>
            typeof child === 'string' ? child : renderParsedElement(child, `${key}-child-${childIndex}`)
          )}
        </ExpandableTable>
      );
    case 'raw-html':
      // This should only be used for specific known-safe content
      console.warn('[DocsPlugin] Rendering raw HTML - this should be rare in the new architecture');
      return <div key={key} dangerouslySetInnerHTML={{ __html: element.props.html }} />;
    default:
      // Standard HTML elements - strict validation
      if (!element.type || (typeof element.type !== 'string' && typeof element.type !== 'function')) {
        console.error('[DocsPlugin] Invalid element type for parsed element:', element);
        throw new Error(`Invalid element type: ${element.type}. This should have been caught during parsing.`);
      }

      // Handle void/self-closing elements that shouldn't have children
      const voidElements = new Set([
        'area',
        'base',
        'br',
        'col',
        'embed',
        'hr',
        'img',
        'input',
        'link',
        'meta',
        'param',
        'source',
        'track',
        'wbr',
      ]);

      if (typeof element.type === 'string' && voidElements.has(element.type)) {
        // Void elements should not have children
        return React.createElement(element.type, { key, ...element.props });
      } else {
        // Regular elements can have children
        const children = element.children
          ?.map((child: ParsedElement | string, childIndex: number) => {
            if (typeof child === 'string') {
              // Preserve whitespace in text content
              return child.length > 0 ? child : null;
            }
            return renderParsedElement(child, `${key}-child-${childIndex}`);
          })
          .filter((child: React.ReactNode) => child !== null);

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
    if (!content) {
      return null;
    }
    return <ContentRenderer content={content} containerRef={containerRef} onContentReady={handleContentReady} />;
  }, [content, handleContentReady]);

  return {
    renderer,
    containerRef,
    isReady,
  };
}
