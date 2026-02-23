import React, { useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { TabsBar, Tab, TabContent, Badge, Tooltip } from '@grafana/ui';

import { RawContent, ContentParseResult } from '../types/content.types';
import { parseHTMLToComponents, ParsedElement } from './html-parser';
import { parseJsonGuide, isJsonGuideContent } from './json-parser';
// eslint-disable-next-line no-restricted-imports -- [ratchet] ALLOWED_VERTICAL_VIOLATIONS: docs-retrieval -> components
import {
  InteractiveSection,
  InteractiveStep,
  InteractiveMultiStep,
  InteractiveGuided,
  InteractiveQuiz,
  InteractiveConditional,
  InputBlock,
  resetInteractiveCounters,
  registerSectionSteps,
  getDocumentStepPosition,
} from '../components/interactive-tutorial';
import {
  CodeBlock,
  ExpandableTable,
  ImageRenderer,
  ContentParsingError,
  VideoRenderer,
  YouTubeVideoRenderer,
} from './components/docs';
// eslint-disable-next-line no-restricted-imports -- [ratchet] ALLOWED_LATERAL_VIOLATIONS: docs-retrieval -> requirements-manager
import { SequentialRequirementsManager } from '../requirements-manager';
// eslint-disable-next-line no-restricted-imports -- [ratchet] ALLOWED_VERTICAL_VIOLATIONS: docs-retrieval -> integrations
import {
  useTextSelection,
  AssistantSelectionPopover,
  buildDocumentContext,
  AssistantCustomizable,
  AssistantBlockWrapper,
  TextSelectionState,
} from '../integrations/assistant-integration';
import { GuideResponseProvider, useGuideResponses } from './GuideResponseContext';
import { substituteVariables } from '../utils/variable-substitution';
// eslint-disable-next-line no-restricted-imports -- [ratchet] ALLOWED_VERTICAL_VIOLATIONS: docs-retrieval -> components
import { STANDALONE_SECTION_ID } from '../components/interactive-tutorial/use-standalone-persistence';

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
  onGuideComplete?: () => void;
  className?: string;
  containerRef?: React.RefObject<HTMLDivElement>;
}

// Style to hide default browser selection highlight
const hideSelectionStyle = css`
  ::selection {
    background-color: transparent;
    color: inherit;
  }
`;

// Memoize ContentRenderer to prevent re-renders when parent re-renders
// but content prop hasn't changed
export const ContentRenderer = React.memo(function ContentRenderer({
  content,
  onContentReady,
  onGuideComplete,
  className,
  containerRef,
}: ContentRendererProps) {
  const internalRef = useRef<HTMLDivElement>(null);
  const activeRef = containerRef || internalRef;
  const guideCompleteCalledRef = useRef(false);

  // Text selection tracking for assistant integration
  const selectionState = useTextSelection(activeRef);

  // Build document context for assistant
  const documentContext = React.useMemo(() => buildDocumentContext(content), [content]);

  // Store completedSections in a ref so it persists across effect re-runs
  // (inline callbacks in parent cause effect to re-mount - R12 anti-pattern protection)
  const completedSectionsRef = useRef<Set<string>>(new Set());

  // Store onGuideComplete in a ref so we can use the latest version without it
  // causing the event listener effect to re-mount (which would lose tracked sections)
  const onGuideCompleteRef = useRef(onGuideComplete);
  useEffect(() => {
    onGuideCompleteRef.current = onGuideComplete;
  }, [onGuideComplete]);

  // Reset tracking state when content changes (new guide = fresh start)
  useEffect(() => {
    guideCompleteCalledRef.current = false;
    completedSectionsRef.current = new Set();
  }, [content?.url]);

  // Ref to track the current content URL - updated synchronously before effects run
  // This allows handlers to detect if they're stale (created for different content)
  const currentContentUrlRef = useRef<string | undefined>(content?.url);
  currentContentUrlRef.current = content?.url;

  // Track interactive section completions for guide-level completion
  // Use debounced check to ensure DOM is stable before counting sections
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    // Capture the content URL at effect creation time
    const effectContentUrl = content?.url;

    // CRITICAL: Prevent handlers from triggering completion until content has "settled"
    // Old components may still fire events during the transition period.
    // Wait a short time before allowing completion to ensure old events have flushed.
    let isSettled = false;
    const settleTimer = setTimeout(() => {
      isSettled = true;
    }, 200); // 200ms settling time for old components to unmount

    // Count interactive sections from the DOM
    const countSections = (): number => {
      const container = activeRef.current;
      if (!container) {
        return 0;
      }
      const sections = container.querySelectorAll('[data-interactive-section="true"]');
      return sections.length;
    };

    // Debounced completion check to ensure DOM is fully rendered
    const debouncedCompletionCheck = () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        if (guideCompleteCalledRef.current) {
          return;
        }
        // CRITICAL: Don't trigger completion until content has settled
        if (!isSettled) {
          return;
        }
        // CRITICAL: Validate this check is still for the current content
        if (effectContentUrl !== currentContentUrlRef.current) {
          return; // This check was scheduled for different content
        }
        const totalSections = countSections();
        if (totalSections > 0 && completedSectionsRef.current.size >= totalSections) {
          guideCompleteCalledRef.current = true;
          onGuideCompleteRef.current?.();
        }
      }, 100); // Small delay to ensure DOM is stable
    };

    const handleSectionComplete = (event: Event) => {
      const { sectionId } = (event as CustomEvent).detail;
      completedSectionsRef.current.add(sectionId);

      // CRITICAL: Don't trigger completion until content has settled
      // This prevents old component events from triggering completion on new content
      if (!isSettled) {
        return; // Content hasn't settled yet
      }

      // Also validate handler is for current content
      if (effectContentUrl !== currentContentUrlRef.current) {
        return; // This handler was created for different content
      }

      // Count sections at the time of completion to ensure accurate count
      const totalSections = countSections();

      // Check if all sections complete - trigger immediately if count is accurate
      if (totalSections > 0 && completedSectionsRef.current.size >= totalSections) {
        if (!guideCompleteCalledRef.current && onGuideCompleteRef.current) {
          guideCompleteCalledRef.current = true;
          onGuideCompleteRef.current();
        }
      } else {
        // If count seems off, use debounced check as fallback
        debouncedCompletionCheck();
      }
    };

    // Fallback: also check completion state when individual steps complete
    // This catches edge cases where section completion events aren't fired properly
    const handleStepComplete = () => {
      // Check if all sections are now completed by examining DOM state
      const container = activeRef.current;
      if (!container || guideCompleteCalledRef.current) {
        return;
      }

      // CRITICAL: Don't trigger completion until content has settled
      if (!isSettled) {
        return;
      }

      // CRITICAL: Validate this handler is still for the current content
      if (effectContentUrl !== currentContentUrlRef.current) {
        return; // This handler was created for different content
      }

      const sections = container.querySelectorAll('[data-interactive-section="true"]');
      if (sections.length === 0) {
        return;
      }

      // Check each section's completion state via CSS class
      const allComplete = Array.from(sections).every((section) => section.classList.contains('completed'));

      if (allComplete) {
        guideCompleteCalledRef.current = true;
        onGuideCompleteRef.current?.();
      }
    };

    // Listen for unified progress events (covers standalone steps outside sections)
    // Standalone steps don't dispatch interactive-step-completed; they use
    // interactive-progress-saved with a unified completionPercentage instead.
    // IMPORTANT: Must verify the event's contentKey matches the current page to avoid
    // cross-milestone contamination (stale events from a previous milestone triggering
    // completion on the newly loaded milestone).
    const handleProgressSaved = (event: Event) => {
      if (guideCompleteCalledRef.current) {
        return;
      }
      // CRITICAL: Don't trigger completion until content has settled
      if (!isSettled) {
        return;
      }
      // CRITICAL: Check if this handler is still for the current content
      if (effectContentUrl !== currentContentUrlRef.current) {
        return; // This handler was created for different content
      }
      const detail = (event as CustomEvent).detail;
      const currentTabUrl = (window as any).__DocsPluginActiveTabUrl as string | undefined;
      if (detail?.completionPercentage >= 100 && detail?.contentKey && currentTabUrl) {
        // Only trigger if the event is for the current page (strict equality after normalization).
        // Bidirectional startsWith would produce false matches when URLs share a common prefix
        // (e.g., /docs/dashboard matching /docs/dashboard-variables).
        const eventKeyNorm = detail.contentKey.replace(/\/+$/, '');
        const tabUrlNorm = currentTabUrl.replace(/\/+$/, '');
        if (eventKeyNorm === tabUrlNorm) {
          guideCompleteCalledRef.current = true;
          onGuideCompleteRef.current?.();
        }
      }
    };

    window.addEventListener('interactive-section-completed', handleSectionComplete);
    window.addEventListener('interactive-step-completed', handleStepComplete);
    window.addEventListener('interactive-progress-saved', handleProgressSaved);

    return () => {
      window.removeEventListener('interactive-section-completed', handleSectionComplete);
      window.removeEventListener('interactive-step-completed', handleStepComplete);
      window.removeEventListener('interactive-progress-saved', handleProgressSaved);
      clearTimeout(settleTimer);
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    };
  }, [activeRef, content?.url]); // Removed onGuideComplete - using ref instead

  // Expose current content key globally for interactive persistence.
  // MUST be useLayoutEffect so the global is set before children's useEffect
  // (progress restoration) runs — prevents stale key from a previous milestone.
  useLayoutEffect(() => {
    try {
      (window as any).__DocsPluginContentKey = content?.url || '';
    } catch {
      // no-op
    }
  }, [content?.url]);

  const processedContent = React.useMemo(() => {
    let guideContent = content.content;
    // Skip URL resolution for JSON guides (they don't have relative URLs and DOMParser would corrupt them)
    // Note: Learning journey extras are now applied in the content fetcher before wrapping
    if (!isJsonGuideContent(guideContent)) {
      guideContent = resolveRelativeUrls(guideContent, content.url);
    }
    return guideContent;
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

  // Derive guide ID from content URL for response storage
  const guideId = useMemo(() => {
    // Use the URL path as the guide identifier, or fallback to 'default'
    try {
      const url = new URL(content.url, window.location.origin);
      // Remove leading slash and use path as ID
      return url.pathname.replace(/^\//, '').replace(/\//g, '-') || 'default';
    } catch {
      return content.url || 'default';
    }
  }, [content.url]);

  // Expose guide ID globally for requirements checker to access
  useEffect(() => {
    try {
      (window as any).__DocsPluginGuideId = guideId;
    } catch {
      // no-op
    }
  }, [guideId]);

  return (
    <GuideResponseProvider guideId={guideId}>
      <ContentWithVariables
        processedContent={processedContent}
        contentType={content.type}
        baseUrl={content.url}
        title={content.metadata.title}
        onContentReady={onContentReady}
        activeRef={activeRef}
        className={className}
        selectionState={selectionState}
        documentContext={documentContext}
      />
    </GuideResponseProvider>
  );
});

/** Inner component that has access to GuideResponseContext for variable substitution */
interface ContentWithVariablesProps {
  processedContent: string;
  contentType: 'learning-journey' | 'single-doc' | 'interactive';
  baseUrl: string;
  title: string;
  onContentReady?: () => void;
  activeRef: React.RefObject<HTMLDivElement>;
  className?: string;
  selectionState: TextSelectionState;
  documentContext: ReturnType<typeof buildDocumentContext>;
}

function ContentWithVariables({
  processedContent,
  contentType,
  baseUrl,
  title,
  onContentReady,
  activeRef,
  className,
  selectionState,
  documentContext,
}: ContentWithVariablesProps) {
  // Get responses for variable substitution - passed to renderer, NOT used for pre-parsing
  // This avoids breaking JSON structure when user values contain special characters
  const { responses } = useGuideResponses();

  // Style for the title heading
  const titleStyle = css`
    font-size: 28px;
    font-weight: 500;
    line-height: 1.3;
    margin: 0 0 24px 0;
    padding: 0;
    color: inherit;
  `;

  return (
    <div
      ref={activeRef}
      className={`${className} ${hideSelectionStyle}`}
      data-pathfinder-content="true"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'visible',
        position: 'relative',
      }}
    >
      {title && contentType === 'single-doc' && <h1 className={titleStyle}>{title}</h1>}
      <ContentProcessor
        html={processedContent}
        contentType={contentType}
        baseUrl={baseUrl}
        onReady={onContentReady}
        responses={responses}
      />
      {selectionState.isValid && (
        <AssistantSelectionPopover
          selectedText={selectionState.selectedText}
          position={selectionState.position}
          context={documentContext}
          containerRef={activeRef}
        />
      )}
    </div>
  );
}

interface ContentProcessorProps {
  html: string;
  contentType: 'learning-journey' | 'single-doc' | 'interactive';
  theme?: GrafanaTheme2;
  baseUrl: string;
  onReady?: () => void;
  /** User responses for variable substitution at render time */
  responses: Record<string, unknown>;
}

function ContentProcessor({ html, contentType, baseUrl, onReady, responses }: ContentProcessorProps) {
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

  // Parse content with fail-fast error handling (memoized to avoid re-parsing on every render)
  // Detect JSON vs HTML content and use appropriate parser
  const parseResult: ContentParseResult = useMemo(() => {
    if (isJsonGuideContent(html)) {
      return parseJsonGuide(html, baseUrl);
    }
    return parseHTMLToComponents(html, baseUrl);
  }, [html, baseUrl]);

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

  // Pre-register ALL interactive entries (sections + standalone steps) in visual
  // document order. This runs before children render (parent useMemo executes first)
  // so that getDocumentStepPosition returns correct offsets during this render.
  //
  // Without explicit documentOrder, the global registry would use Map insertion
  // order — and because this parent useMemo always fires before child useMemos,
  // standalone steps would always get offset 0 regardless of their actual position
  // in the document.
  //
  // For sections, we predict the sectionId (matching InteractiveSection's logic)
  // and count steps from the parsed tree. When InteractiveSection later re-registers
  // the same sectionId, only the stepCount is updated; the documentOrder is preserved.
  //
  // Known limitation: interleaved standalone steps (standalone steps between
  // different sections) are grouped into a single registry entry positioned at the
  // first standalone step's document location. Fully interleaved numbering would
  // require splitting into per-position groups — acceptable trade-off for now.
  const documentLayout: DocumentLayoutInfo = useMemo(() => {
    if (!parseResult.isValid || !parseResult.data) {
      return { standaloneGroupMap: new Map(), totalStandaloneSteps: 0 };
    }

    const elements = parseResult.data.elements;
    let docOrder = 0;
    let sectionCounter = 0; // Simulates interactiveSectionCounter (reset at top of ContentProcessor)
    let standaloneCount = 0;
    let standaloneDocOrder: number | null = null;
    const groupMap = new Map<number, StandaloneGroupInfo>();

    elements.forEach((el, idx) => {
      if (el.type === 'interactive-section') {
        // Predict sectionId using the same logic as InteractiveSection's useMemo:
        // prefer the explicit HTML id prop, otherwise use the sequential counter.
        const sectionId = el.props.id ? `section-${el.props.id}` : `section-${++sectionCounter}`;
        const stepCount = countStepsInSection(el);
        registerSectionSteps(sectionId, stepCount, docOrder);
        docOrder++;
      } else if (isInteractiveStepElement(el)) {
        // First standalone step reserves a document-order slot for the group
        if (standaloneDocOrder === null) {
          standaloneDocOrder = docOrder;
          docOrder++;
        }
        groupMap.set(idx, { groupId: STANDALONE_SECTION_ID, indexInGroup: standaloneCount });
        standaloneCount++;
      }
    });

    // Register standalone group with correct document order
    if (standaloneCount > 0 && standaloneDocOrder !== null) {
      registerSectionSteps(STANDALONE_SECTION_ID, standaloneCount, standaloneDocOrder);
    }

    return { standaloneGroupMap: groupMap, totalStandaloneSteps: standaloneCount };
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

  // Check for empty content where parsing succeeded but produced no renderable elements.
  // If there are parse failure warnings, promote them to errors.
  // When we render unstyled HTML, it is first converted to a single JSON HTML block.
  // The block parser only emits warnings so a single block doesn't break overall rendering, but for this case, a single block failing to render means the whole HTML failed to render because there's only a single block.
  if (parsedContent.elements.length === 0) {
    const parseFailureWarnings = (parseResult.warnings || []).filter(
      (w) => w.includes('Failed to parse') || w.includes('Empty HTML block')
    );

    if (parseFailureWarnings.length > 0) {
      // Promote parse failure warnings to errors.
      const promotedErrors = parseFailureWarnings.map((w) => {
        // Clean up the error message for single HTML block errors since the block context isn't meaningful.
        const cleanMessage = w
          .replace(/^Failed to parse HTML block at blocks\[\d+\]:\s*/, '')
          .replace(/^Empty HTML block at blocks\[\d+\]$/, 'The HTML content is empty');

        return {
          type: 'html_parsing' as const,
          message: cleanMessage,
          location: undefined,
        };
      });

      // Remove promoted warnings from the list
      const remainingWarnings = (parseResult.warnings || []).filter(
        (w) => !w.includes('Failed to parse') && !w.includes('Empty HTML block')
      );

      return (
        <div ref={ref}>
          <ContentParsingError errors={promotedErrors} warnings={remainingWarnings} fallbackHtml={html} />
        </div>
      );
    }

    return (
      <div ref={ref}>
        <ContentParsingError
          errors={[
            {
              type: 'html_parsing',
              message:
                'Content was parsed successfully but produced no renderable elements. The content may be empty, contain only whitespace, or use an unsupported format.',
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
      {parsedContent.elements.map((element, index) => {
        // Look up standalone step position from precomputed document layout
        const groupInfo = documentLayout.standaloneGroupMap.get(index);
        const stepPosition = groupInfo ? getDocumentStepPosition(groupInfo.groupId, groupInfo.indexInGroup) : undefined;
        return renderParsedElement(element, `element-${index}`, baseUrl, responses, stepPosition);
      })}
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
      setActiveTab(tabsData[0]!.key);
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
            return renderParsedElement(content, 'tab-content', undefined);
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
    <div>
      {parseResult.data.elements.map((element, index) =>
        renderParsedElement(element, `tab-content-${index}`, undefined)
      )}
    </div>
  );
}

// ============================================================================
// STANDALONE STEP POSITION TRACKING
// ============================================================================

/**
 * Position override for standalone interactive elements (not inside a section).
 * Sections handle their own step position tracking internally.
 * This provides equivalent tracking for sectionless guides.
 */
interface StandaloneStepPosition {
  stepIndex: number;
  totalSteps: number;
}

/**
 * Set of ParsedElement types that represent completable interactive steps.
 * These are the types that track completion state, use persistence hooks,
 * and receive stepIndex/totalSteps props for position tracking.
 *
 * Note: input-block is intentionally excluded — it doesn't track completion,
 * doesn't use useStandalonePersistence, and would inflate the total step count
 * making 100% completion impossible.
 */
const INTERACTIVE_STEP_TYPES = new Set([
  'interactive-step',
  'interactive-multi-step',
  'interactive-guided',
  'quiz-block',
]);

/**
 * Check if a ParsedElement is an interactive step (or wraps one).
 * Used to count standalone interactive elements for position tracking.
 */
function isInteractiveStepElement(element: ParsedElement): boolean {
  if (INTERACTIVE_STEP_TYPES.has(element.type)) {
    return true;
  }
  // Check inside assistant-block-wrapper (wraps a single interactive child)
  if (element.type === 'assistant-block-wrapper' && element.children) {
    return element.children.some(
      (child) => typeof child !== 'string' && INTERACTIVE_STEP_TYPES.has((child as ParsedElement).type)
    );
  }
  return false;
}

/**
 * Step types tracked by InteractiveSection as "steps" in its stepComponents array.
 * Must stay in sync with InteractiveSection's React.Children.forEach extraction logic.
 * Note: input-block is NOT tracked by InteractiveSection as a section step.
 */
const SECTION_TRACKED_STEP_TYPES = new Set([
  'interactive-step',
  'interactive-multi-step',
  'interactive-guided',
  'quiz-block',
]);

/**
 * Count the number of steps inside a parsed interactive-section element.
 * Mirrors InteractiveSection's stepComponents extraction: only counts direct
 * children of the tracked step types (not wrapped children like assistant-block-wrapper).
 */
function countStepsInSection(element: ParsedElement): number {
  if (!element.children) {
    return 0;
  }
  return element.children.reduce((count, child) => {
    if (typeof child === 'string') {
      return count;
    }
    const childEl = child as ParsedElement;
    return count + (SECTION_TRACKED_STEP_TYPES.has(childEl.type) ? 1 : 0);
  }, 0);
}

/**
 * Layout information for standalone steps, computed once during document layout
 * analysis. Maps element indices to their registry group and position within group.
 */
interface StandaloneGroupInfo {
  groupId: string;
  indexInGroup: number;
}

/**
 * Document layout information computed from the parsed element tree.
 * Used to pre-register all interactive entries in correct document order
 * and to look up standalone step positions during rendering.
 */
interface DocumentLayoutInfo {
  standaloneGroupMap: Map<number, StandaloneGroupInfo>;
  totalStandaloneSteps: number;
}

function renderParsedElement(
  element: ParsedElement | ParsedElement[],
  key: string | number,
  contentKey?: string,
  responses: Record<string, unknown> = {},
  standaloneStepPosition?: StandaloneStepPosition
): React.ReactNode {
  if (Array.isArray(element)) {
    return element.map((child, i) => renderParsedElement(child, `${key}-${i}`, contentKey, responses));
  }

  // Helper to substitute variables in strings at render time
  // This is safe because it happens AFTER JSON parsing
  const sub = (value: string | undefined): string | undefined => {
    if (!value) {
      return value;
    }
    // Cast responses - they may contain any JSON value but substituteVariables
    // only reads string/boolean/number which it stringifies
    return substituteVariables(value, responses as Record<string, string | boolean | number>, {
      preserveUnmatched: true,
    });
  };

  // Helper to substitute in string children
  // Optional childStepPosition allows passing standalone step position through wrappers
  const renderChildren = (children: Array<ParsedElement | string>, childStepPosition?: StandaloneStepPosition) =>
    children.map((child: ParsedElement | string, childIndex: number) =>
      typeof child === 'string'
        ? sub(child)
        : renderParsedElement(child, `${key}-child-${childIndex}`, contentKey, responses, childStepPosition)
    );

  // Helper to substitute variables in internal actions (for multistep/guided blocks)
  // Uses generic to preserve the input array type (InternalAction[], GuidedAction[], etc.)
  const subInternalActions = <T extends { refTarget?: string; targetValue?: string }>(actions: T[]): T[] => {
    return actions.map((action) => ({
      ...action,
      refTarget: sub(action.refTarget) ?? action.refTarget,
      targetValue: sub(action.targetValue),
    }));
  };

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
          title={sub(element.props.title) || 'Interactive section'}
          isSequence={element.props.isSequence}
          skippable={element.props.skippable}
          requirements={element.props.requirements}
          objectives={element.props.objectives}
          hints={element.props.hints}
          id={element.props.id} // Pass the HTML id attribute
        >
          {renderChildren(element.children)}
        </InteractiveSection>
      );
    case 'interactive-conditional':
      return (
        <InteractiveConditional
          key={key}
          conditions={element.props.conditions || []}
          description={element.props.description}
          display={element.props.display || 'inline'}
          reftarget={element.props.reftarget}
          whenTrueSectionConfig={element.props.whenTrueSectionConfig}
          whenFalseSectionConfig={element.props.whenFalseSectionConfig}
          whenTrueChildren={element.props.whenTrueChildren || []}
          whenFalseChildren={element.props.whenFalseChildren || []}
          renderElement={(child: ParsedElement, childKey: string) => renderParsedElement(child, childKey, contentKey)}
          keyPrefix={String(key)}
        />
      );
    case 'interactive-step':
      return (
        <InteractiveStep
          key={key}
          targetAction={element.props.targetAction}
          refTarget={sub(element.props.refTarget) ?? element.props.refTarget}
          targetValue={sub(element.props.targetValue)}
          hints={element.props.hints}
          targetComment={element.props.targetComment}
          doIt={element.props.doIt}
          showMe={element.props.showMe}
          showMeText={element.props.showMeText}
          skippable={element.props.skippable}
          completeEarly={element.props.completeEarly}
          requirements={element.props.requirements}
          objectives={element.props.objectives}
          postVerify={element.props.postVerify}
          title={sub(element.props.title)}
          lazyRender={element.props.lazyRender}
          scrollContainer={element.props.scrollContainer}
          // Standalone step position (for guides without sections)
          stepIndex={standaloneStepPosition?.stepIndex}
          totalSteps={standaloneStepPosition?.totalSteps}
        >
          {renderChildren(element.children)}
        </InteractiveStep>
      );
    case 'interactive-multi-step':
      return (
        <InteractiveMultiStep
          key={key}
          internalActions={subInternalActions(element.props.internalActions ?? [])}
          skippable={element.props.skippable}
          completeEarly={element.props.completeEarly}
          requirements={element.props.requirements}
          objectives={element.props.objectives}
          hints={element.props.hints}
          title={sub(element.props.title)}
          // Standalone step position (for guides without sections)
          stepIndex={standaloneStepPosition?.stepIndex}
          totalSteps={standaloneStepPosition?.totalSteps}
        >
          {renderChildren(element.children)}
        </InteractiveMultiStep>
      );
    case 'interactive-guided':
      return (
        <InteractiveGuided
          key={key}
          internalActions={subInternalActions(element.props.internalActions ?? [])}
          stepTimeout={element.props.stepTimeout}
          skippable={element.props.skippable}
          completeEarly={element.props.completeEarly}
          requirements={element.props.requirements}
          objectives={element.props.objectives}
          hints={element.props.hints}
          title={sub(element.props.title)}
          // Standalone step position (for guides without sections)
          stepIndex={standaloneStepPosition?.stepIndex}
          totalSteps={standaloneStepPosition?.totalSteps}
        >
          {renderChildren(element.children)}
        </InteractiveGuided>
      );
    case 'quiz-block':
      return (
        <InteractiveQuiz
          key={key}
          question={sub(element.props.question) ?? element.props.question}
          choices={element.props.choices}
          multiSelect={element.props.multiSelect}
          completionMode={element.props.completionMode}
          maxAttempts={element.props.maxAttempts}
          requirements={element.props.requirements}
          skippable={element.props.skippable}
          // Standalone step position (for guides without sections)
          stepIndex={standaloneStepPosition?.stepIndex}
          totalSteps={standaloneStepPosition?.totalSteps}
        >
          {renderChildren(element.children)}
        </InteractiveQuiz>
      );
    case 'input-block':
      return (
        <InputBlock
          key={key}
          prompt={sub(element.props.prompt) ?? element.props.prompt}
          inputType={element.props.inputType}
          variableName={element.props.variableName}
          placeholder={sub(element.props.placeholder)}
          checkboxLabel={sub(element.props.checkboxLabel)}
          defaultValue={element.props.defaultValue}
          required={element.props.required}
          pattern={element.props.pattern}
          validationMessage={sub(element.props.validationMessage)}
          requirements={element.props.requirements}
          skippable={element.props.skippable}
          datasourceFilter={element.props.datasourceFilter}
        >
          {renderChildren(element.children)}
        </InputBlock>
      );
    case 'video':
      return (
        <VideoRenderer
          key={key}
          src={element.props.src}
          baseUrl={element.props.baseUrl}
          onClick={element.props.onClick}
          start={element.props.start}
          end={element.props.end}
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
          start={element.props.start}
          end={element.props.end}
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
          toggleText={sub(element.props.toggleText)}
          className={element.props.className}
          isCollapseSection={element.props.isCollapseSection}
        >
          {renderChildren(element.children)}
        </ExpandableTable>
      );
    case 'assistant-customizable':
      return (
        <AssistantCustomizable
          key={key}
          defaultValue={element.props.defaultValue}
          assistantId={element.props.assistantId}
          assistantType={element.props.assistantType}
          inline={element.props.inline}
          contentKey={contentKey || ''}
        />
      );
    case 'assistant-block-wrapper':
      return (
        <AssistantBlockWrapper
          key={key}
          assistantId={element.props.assistantId}
          assistantType={element.props.assistantType}
          defaultValue={element.props.defaultValue}
          blockType={element.props.blockType}
          contentKey={contentKey || ''}
          surroundingContext={element.props.surroundingContext}
        >
          {/* Pass standalone step position through wrapper to interactive child */}
          {renderChildren(element.children, standaloneStepPosition)}
        </AssistantBlockWrapper>
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
              typeof child === 'string'
                ? sub(child)
                : renderParsedElement(child, `${key}-child-${childIndex}`, contentKey, responses)
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
        // Regular elements can have children - apply variable substitution to text
        const children = element.children
          ?.map((child: ParsedElement | string, childIndex: number) => {
            if (typeof child === 'string') {
              // Apply variable substitution and preserve whitespace
              const substituted = sub(child);
              return substituted && substituted.length > 0 ? substituted : null;
            }
            return renderParsedElement(child, `${key}-child-${childIndex}`, contentKey, responses);
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
