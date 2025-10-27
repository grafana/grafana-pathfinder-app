import React, { useRef, useEffect, useMemo } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { TabsBar, Tab, TabContent, Badge, Tooltip } from '@grafana/ui';

import { RawContent, ContentParseResult } from './content.types';
import { generateJourneyContentWithExtras } from './learning-journey-helpers';
import { parseHTMLToComponents, ParsedElement } from './html-parser';
import {
  InteractiveSection,
  InteractiveStep,
  InteractiveMultiStep,
  InteractiveGuided,
  CodeBlock,
  ExpandableTable,
  ImageRenderer,
  ContentParsingError,
  resetInteractiveCounters,
  VideoRenderer,
  YouTubeVideoRenderer,
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
        if (attrValue) {
          // Skip external URLs (http://, https://, //, mailto:, tel:, javascript:, etc.)
          if (
            attrValue.startsWith('http://') ||
            attrValue.startsWith('https://') ||
            attrValue.startsWith('//') ||
            attrValue.startsWith('mailto:') ||
            attrValue.startsWith('tel:') ||
            attrValue.startsWith('javascript:') ||
            attrValue.startsWith('#')
          ) {
            return; // Skip external/special URLs
          }

          // Resolve relative URLs (starting with ./, ../, or just a path without /)
          // and absolute paths (starting with /)
          try {
            const resolvedUrl = new URL(attrValue, baseUrlObj).href;
            element.setAttribute(attr, resolvedUrl);
          } catch (urlError) {
            console.warn(`Failed to resolve URL: ${attrValue}`, urlError);
          }
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
        block: 'center',
        inline: 'center',
      });

      // Add highlight effect
      targetElement.classList.add('fragment-highlight');

      // Remove highlight after animation
      setTimeout(() => {
        targetElement!.classList.remove('fragment-highlight');
      }, 3000);
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
      data-pathfinder-content="true"
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

  // Reset interactive counters only when content changes (not on every render)
  // This must run BEFORE parsing to ensure clean state for section registration
  useMemo(
    () => {
      resetInteractiveCounters();
      return null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [html]
  );

  // Parse HTML with fail-fast error handling (memoized to avoid re-parsing on every render)
  const parseResult: ContentParseResult = useMemo(() => parseHTMLToComponents(html, baseUrl), [html, baseUrl]);

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
    console.error('Content parsing failed:', parseResult.errors);
    return (
      <div ref={ref}>
        <ContentParsingError
          errors={parseResult.errors}
          warnings={parseResult.warnings}
          fallbackHtml={html}
          onRetry={() => {
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

// Legacy: Grafana UI components were previously supported as custom HTML elements
// but are no longer used. Kept mapping for backward compatibility if needed in future.
const allowedUiComponents: Record<string, React.ElementType> = {
  // Note: These are never used in current HTML but kept for potential future use
  badge: Badge,
  tooltip: Tooltip,
};

// TabsWrapper manages tabs state
function TabsWrapper({ element }: { element: ParsedElement }) {
  // Extract tab data first to determine initial state
  const tabsBarElement = element.children?.find(
    (child) => typeof child !== 'string' && (child as any).props?.['data-element'] === 'tabs-bar'
  ) as ParsedElement | undefined;

  const tabContentElement = element.children?.find(
    (child) => typeof child !== 'string' && (child as any).props?.['data-element'] === 'tab-content'
  ) as ParsedElement | undefined;

  // Extract tab data from tabs-bar children
  const tabElements =
    (tabsBarElement?.children?.filter(
      (child) => typeof child !== 'string' && (child as any).props?.['data-element'] === 'tab'
    ) as ParsedElement[]) || [];

  const tabsData = tabElements.map((tabEl) => ({
    key: tabEl.props?.['data-key'] || '',
    label: tabEl.props?.['data-label'] || '',
  }));

  const [activeTab, setActiveTab] = React.useState(tabsData[0]?.key || '');

  React.useEffect(() => {
    if (tabsData.length > 0 && !activeTab) {
      setActiveTab(tabsData[0].key);
    }
  }, [tabsData, activeTab]);

  if (!tabsBarElement || !tabContentElement) {
    console.warn('Missing required tabs elements');
    return null;
  }

  // Extract content for each tab from tab-content children
  // The content items are direct children of tab-content (like <pre> elements), not div[data-element="tab-content-item"]
  const tabContentItems = tabContentElement.children || [];

  return (
    <div>
      <TabsBar>
        {tabsData.map((tab) => (
          <Tab
            key={tab.key}
            label={tab.label}
            active={activeTab === tab.key}
            onChangeTab={() => setActiveTab(tab.key)}
          />
        ))}
      </TabsBar>
      <TabContent className="tab-content">
        {(() => {
          const contentIndex = parseInt(activeTab, 10) || 0;
          const content = tabContentItems[contentIndex];

          if (content && typeof content !== 'string') {
            // Render the content as raw HTML to avoid HTML parser interference
            const originalHTML = (content as any).originalHTML;
            if (originalHTML) {
              return <TabContentRenderer html={originalHTML} />;
            }
            // Fallback to normal rendering if no originalHTML
            return renderParsedElement(content, 'tab-content');
          }
          return null;
        })()}
      </TabContent>
    </div>
  );
}

// Convert tab-content <pre> elements to CodeBlock components
// SECURITY: All content goes through parser - no raw HTML fallback
function TabContentRenderer({ html }: { html: string }) {
  // Parse the HTML to find <pre> elements and convert them to CodeBlock components
  const parseResult = parseHTMLToComponents(html);

  if (!parseResult.isValid || !parseResult.data) {
    // SECURITY: No dangerouslySetInnerHTML fallback - return null on parse failure
    console.error('TabContentRenderer: Failed to parse content.');
    return null;
  }

  // Render the parsed content using the existing component system
  return (
    <div>{parseResult.data.elements.map((element, index) => renderParsedElement(element, `tab-content-${index}`))}</div>
  );
}

function renderParsedElement(element: ParsedElement | ParsedElement[], key: string | number): React.ReactNode {
  if (Array.isArray(element)) {
    return element.map((child, i) => renderParsedElement(child, `${key}-${i}`));
  }

  // Handle special cases first
  switch (element.type) {
    case 'badge':
      return <Badge key={key} text={element.props.text} color={element.props.color} className="mr-1" />;
    case 'badge-tooltip':
      return (
        <Badge
          key={key}
          text={element.props.text}
          color={element.props.color}
          icon={element.props.icon}
          tooltip={element.props.tooltip}
          className="mr-1"
        />
      );
    case 'interactive-section':
      return (
        <InteractiveSection
          key={key}
          title={element.props.title || 'Interactive Section'}
          isSequence={element.props.isSequence}
          skippable={element.props.skippable}
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
          hints={element.props.hints}
          targetComment={element.props.targetComment}
          doIt={element.props.doIt}
          showMe={element.props.showMe}
          showMeText={element.props.showMeText}
          skippable={element.props.skippable}
          requirements={element.props.requirements}
          objectives={element.props.objectives}
          postVerify={element.props.postVerify}
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
          skippable={element.props.skippable}
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
    case 'interactive-guided':
      return (
        <InteractiveGuided
          key={key}
          internalActions={element.props.internalActions}
          stepTimeout={element.props.stepTimeout}
          skippable={element.props.skippable}
          requirements={element.props.requirements}
          objectives={element.props.objectives}
          hints={element.props.hints}
          title={element.props.title}
        >
          {element.children.map((child: ParsedElement | string, childIndex: number) =>
            typeof child === 'string' ? child : renderParsedElement(child, `${key}-child-${childIndex}`)
          )}
        </InteractiveGuided>
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
    case 'youtube-video':
      return (
        <YouTubeVideoRenderer
          key={key}
          src={element.props.src}
          width={element.props.width}
          height={element.props.height}
          title={element.props.title}
          className={element.props.className}
          {...element.props}
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
          width={element.props.width}
          height={element.props.height}
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
      // SECURITY: raw-html type is removed - all HTML must go through the parser
      console.error('raw-html element type encountered - this should have been caught during parsing');
      return null;
    default:
      // Handle tabs root
      if (element.props?.['data-element'] === 'tabs') {
        // Create a TabsWrapper component to manage state
        return <TabsWrapper key={key} element={element} />;
      }

      // Handle tabs bar and content
      if (typeof element.type === 'string' && element.type === 'div' && element.children) {
        const hasTabsBar = element.children.some(
          (child) => typeof child !== 'string' && (child as any).props?.['data-element'] === 'tabs-bar'
        );
        const hasTabContent = element.children.some(
          (child) => typeof child !== 'string' && (child as any).props?.['data-element'] === 'tab-content'
        );

        if (hasTabsBar && hasTabContent) {
          // Create a TabsWrapper component to manage state
          return <TabsWrapper key={key} element={element} />;
        }
      }

      // Also check if this is a tab-content div that should be handled specially
      if (
        typeof element.type === 'string' &&
        element.type === 'div' &&
        element.props?.['data-element'] === 'tab-content'
      ) {
        return null;
      }

      // Legacy Grafana UI components mapping (rarely used but kept for compatibility)
      if (typeof element.type === 'string') {
        const lowerType = element.type.toLowerCase();
        const comp = allowedUiComponents[lowerType];
        if (comp) {
          const children = element.children
            ?.map((child: ParsedElement | string, childIndex: number) =>
              typeof child === 'string' ? child : renderParsedElement(child, `${key}-child-${childIndex}`)
            )
            .filter((child: React.ReactNode) => child !== null);

          // Use props as-is (no custom attribute extraction needed for badge/tooltip)
          return React.createElement(
            comp,
            { key, ...element.props },
            ...(children && children.length > 0 ? children : [])
          );
        }
      }

      // Standard HTML elements - strict validation
      if (!element.type || (typeof element.type !== 'string' && typeof element.type !== 'function')) {
        console.error('Invalid element type for parsed element:', element);
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
