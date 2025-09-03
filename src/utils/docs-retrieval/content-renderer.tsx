import React, { useRef, useEffect } from 'react';
import { GrafanaTheme2 } from '@grafana/data';
import { Card, TabsBar, Tab, TabContent, Badge, Tooltip } from '@grafana/ui';

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

// Whitelisted @grafana/ui React components by tag name
const allowedUiComponents: Record<string, React.ElementType> = {
  card: Card,
  'card.heading': Card.Heading,
  'card.description': Card.Description,
  'card.meta': Card.Meta,
  'card.actions': Card.Actions,
  'card.secondaryactions': Card.SecondaryActions,
  tab: Tab,
  tabsbar: TabsBar,
  tabcontent: TabContent,
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
// while keeping other content as raw HTML
function TabContentRenderer({ html }: { html: string }) {
  // Parse the HTML to find <pre> elements and convert them to CodeBlock components
  const parseResult = parseHTMLToComponents(html);

  if (!parseResult.isValid || !parseResult.data) {
    // Fallback to raw HTML if parsing fails
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
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
          skipable={element.props.skipable}
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
          skipable={element.props.skipable}
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
          skipable={element.props.skipable}
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
      return <div key={key} dangerouslySetInnerHTML={{ __html: element.props.html }} />;
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

      // Whitelisted @grafana/ui components mapping
      if (typeof element.type === 'string') {
        const lowerType = element.type.toLowerCase();
        const comp = allowedUiComponents[lowerType];
        if (comp) {
          const children = element.children
            ?.map((child: ParsedElement | string, childIndex: number) =>
              typeof child === 'string' ? child : renderParsedElement(child, `${key}-child-${childIndex}`)
            )
            .filter((child: React.ReactNode) => child !== null);

          const uiProps: Record<string, any> = { ...element.props };
          const originalHTML: string | undefined = (element as any).originalHTML;

          if (typeof originalHTML === 'string') {
            // Parse the original HTML to extract attributes
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = originalHTML;
            const tempElement = tempDiv.firstElementChild;

            if (tempElement) {
              // Helper function to get attribute value
              const getAttr = (name: string) => tempElement.getAttribute(name);

              // Boolean attributes
              if (getAttr('nomargin')) {
                uiProps.noMargin = true;
              }
              if (getAttr('nopadding')) {
                uiProps.noPadding = true;
              }
              if (getAttr('isselected')) {
                uiProps.isSelected = true;
              }
            }
          }

          return React.createElement(comp, { key, ...uiProps }, ...(children && children.length > 0 ? children : []));
        }
      }

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
