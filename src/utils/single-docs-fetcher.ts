import { getDocsBaseUrl, getDocsUsername, getDocsPassword } from '../constants';

export interface SingleDocsContent {
  title: string;
  content: string;
  url: string;
  lastFetched: string;
  hashFragment?: string; // For anchor scrolling
}

// Simple in-memory cache for docs content
const docsContentCache = new Map<string, { content: SingleDocsContent; timestamp: number }>();
const DOCS_CACHE_DURATION = 1; // 5 * 60 * 1000; // 5 minutes

/**
 * Get authentication headers if credentials are provided
 */
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 (compatible; GrafanaDocsPlugin/1.0)',
  };
  
  // Authenticate if username is provided (password can be empty)
  if (getDocsUsername()) {
    const credentials = btoa(`${getDocsUsername()}:${getDocsPassword() || ''}`);
    headers['Authorization'] = `Basic ${credentials}`;
  }
  
  return headers;
}

/**
 * Convert a regular docs URL to unstyled.html version for content fetching
 * Preserves hash fragments for anchor links
 */
function getUnstyledContentUrl(url: string): string {
  // Split URL and hash fragment
  const [baseUrl, hash] = url.split('#');
  
  let unstyledUrl: string;
  // For docs pages, append unstyled.html
  if (baseUrl.endsWith('/')) {
    unstyledUrl = `${baseUrl}unstyled.html`;
  } else {
    unstyledUrl = `${baseUrl}/unstyled.html`;
  }
  
  // Re-attach hash fragment if it exists
  if (hash) {
    unstyledUrl += `#${hash}`;
  }
  
  return unstyledUrl;
}

/**
 * Extract single docs content from HTML
 */
function extractSingleDocsContent(html: string, url: string): SingleDocsContent {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Extract title from h1 (unstyled.html always has content directly in body)
    const titleElement = doc.querySelector('h1');
    const title = titleElement?.textContent?.trim() || 'Documentation';
    
    // For unstyled.html, content is always in body
    const mainElement = doc.querySelector('body');
    
    if (!mainElement) {
      console.warn('No body element found');
      return {
        title,
        content: 'Content not available - no body element found',
        url,
        lastFetched: new Date().toISOString()
      };
    }
    
    // Process the content
    const processedContent = processSingleDocsContent(mainElement, url);
    
    return {
      title,
      content: processedContent,
      url,
      lastFetched: new Date().toISOString()
    };
  } catch (error) {
    console.warn('Failed to parse single docs content:', error);
    return {
      title: 'Documentation',
      content: html,
      url,
      lastFetched: new Date().toISOString()
    };
  }
}

function processInteractiveElements(element: Element) {
  const interactiveLinks = element.querySelectorAll('a.interactive, span.interactive, li.interactive');
  // We need to ensure that every interactive element has a unique ID we can target
  let interactiveId = 0;
  interactiveLinks.forEach(block => {
    const tagName = block.tagName.toLowerCase();
    const targetAction = block.getAttribute('data-targetaction');
    const reftarget = block.getAttribute('data-reftarget');
    const value = block.getAttribute('data-targetvalue') || '';
    const requirements = block.getAttribute('data-requirements') || 'exists-reftarget';

    if (!targetAction || !reftarget) {
      console.warn("Interactive link missing target action or ref target:", block.textContent);
      return;
    }

    const createButton = (text: string, className = '', buttonType: 'show' | 'do' = 'do') => {
      const button = document.createElement('button');

      // Copy the interactive data attributes to the button
      button.setAttribute('data-requirements', requirements);
      button.setAttribute('data-targetaction', targetAction);
      button.setAttribute('data-reftarget', reftarget);
      button.setAttribute('data-targetvalue', value);
      
      // Add button type attribute to distinguish between show and do buttons
      button.setAttribute('data-button-type', buttonType);
      
      // Add class to identify this as an interactive button
      button.classList.add('interactive-button');

      button.textContent = text;
      if (className) {
        button.className += ` ${className}`;
      }
      return button;
    };

    // Ensure that every interactive element has a unique ID we can target
    if (!block.hasAttribute('id')) {
      block.setAttribute('id', `__interactive-${interactiveId}`);
      interactiveId++;
    }

    if (tagName === 'a') {
      // For anchor tags, add data attributes so they can be handled by the React component
      block.setAttribute('data-button-type', 'do');
      block.classList.add('interactive-button');
      // No onclick handler - will be handled by React component
    } else {
      // Create button container for better layout
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'interactive-button-container';
      
      if (targetAction === "sequence") {
        // For sequence, create a single button that executes the sequence
        const sequenceButton = createButton('Do SECTION', 'interactive-sequence-button', 'do');
        buttonContainer.appendChild(sequenceButton);
      } else {
        // For individual actions, create both Show me and Do it buttons
        const showButton = createButton('Show me', 'interactive-show-button', 'show');
        const doButton = createButton('Do it', 'interactive-do-button', 'do');
        
        buttonContainer.appendChild(showButton);
        buttonContainer.appendChild(doButton);
      }
      
      block.appendChild(buttonContainer);
    }
  })
}

/**
 * Process single docs content for better display (simplified for unstyled.html)
 */
function processSingleDocsContent(mainElement: Element, url: string): string {
  const clonedElement = mainElement.cloneNode(true) as Element;
  
  // Remove unwanted elements (simplified for unstyled.html)
  const unwantedSelectors = [
    'head', 'script', 'style', 'noscript', 'grammarly-desktop-integration'
  ];
  
  unwantedSelectors.forEach(selector => {
    const elements = clonedElement.querySelectorAll(selector);
    elements.forEach(el => el.remove());
  });
  
  // Process images - fix relative URLs and add lightbox functionality
  const images = clonedElement.querySelectorAll('img');
  images.forEach(img => {
    const src = img.getAttribute('src');
    const dataSrc = img.getAttribute('data-src');
    const originalSrc = dataSrc || src;
    
    if (!originalSrc) {return;}
    
    // Fix relative URLs with configurable base URL
    const newSrc = originalSrc.startsWith('http') || originalSrc.startsWith('data:') 
      ? originalSrc
      : originalSrc.startsWith('/') 
        ? `${getDocsBaseUrl()}${originalSrc}`
        : originalSrc.startsWith('./') 
          ? `${getDocsBaseUrl()}/docs/${originalSrc.substring(2)}`
          : originalSrc.startsWith('../') 
            ? `${getDocsBaseUrl()}/docs/${originalSrc.replace(/^\.\.\//, '')}`
            : `${getDocsBaseUrl()}/docs/${originalSrc}`;
    
    img.setAttribute('src', newSrc);
    img.removeAttribute('data-src');
    img.removeAttribute('data-srcset');
    img.classList.remove('lazyload', 'lazyloaded', 'ls-is-cached', 'd-inline-block');
    img.classList.add('docs-image');
    img.setAttribute('loading', 'lazy');
    
    // Add alt text if missing
    if (!img.getAttribute('alt')) {
      img.setAttribute('alt', 'Documentation image');
    }
  });

  // Process videos - fix relative URLs and add proper attributes
  const videos = clonedElement.querySelectorAll('video');
  videos.forEach(video => {
    const src = video.getAttribute('src');
    const dataSrc = video.getAttribute('data-src');
    const originalSrc = dataSrc || src;
    
    if (!originalSrc) {return;}
    
    // Fix relative URLs with configurable base URL (same logic as images)
    const newSrc = originalSrc.startsWith('http') || originalSrc.startsWith('data:') 
      ? originalSrc
      : originalSrc.startsWith('/') 
        ? `${getDocsBaseUrl()}${originalSrc}`
        : originalSrc.startsWith('./') 
          ? `${getDocsBaseUrl()}/docs/${originalSrc.substring(2)}`
          : originalSrc.startsWith('../') 
            ? `${getDocsBaseUrl()}/docs/${originalSrc.replace(/^\.\.\//, '')}`
            : `${getDocsBaseUrl()}/docs/${originalSrc}`;
    
    // Set the fixed source
    if (dataSrc) {
      video.setAttribute('data-src', newSrc);
      video.removeAttribute('src'); // Keep it as lazy-loaded
    } else {
      video.setAttribute('src', newSrc);
    }
    
    // Remove any lazy loading classes that might interfere
    video.classList.remove('lazyloaded', 'ls-is-cached');
    video.classList.add('docs-video');
    
    // Ensure proper video attributes for documentation context
    if (!video.getAttribute('controls')) {
      video.setAttribute('controls', 'true');
    }
    
    // Add accessibility attributes if missing
    if (!video.getAttribute('aria-label') && !video.getAttribute('title')) {
      video.setAttribute('aria-label', 'Documentation video');
    }
  });
  
  // Process iframes (like YouTube videos) with responsive wrappers
  const iframes = clonedElement.querySelectorAll('iframe');
  iframes.forEach(iframe => {
    const src = iframe.getAttribute('src');
    
    // Determine iframe type and apply appropriate classes
    if (src?.includes('youtube.com') || src?.includes('youtu.be')) {
      // Create video wrapper for responsive design
      const wrapper = clonedElement.ownerDocument.createElement('div');
      wrapper.className = 'journey-iframe-wrapper journey-video-wrapper';
      
      iframe.classList.add('journey-video-iframe');
      iframe.parentNode?.insertBefore(wrapper, iframe);
      wrapper.appendChild(iframe);
    } else {
      // General iframe handling
      iframe.classList.add('journey-general-iframe');
    }
    
    // Add title if missing
    if (!iframe.getAttribute('title')) {
      iframe.setAttribute('title', 'Embedded content');
    }
  });
  
  // Process code snippets and remove existing copy buttons
  const codeSnippets = clonedElement.querySelectorAll('.code-snippet, pre[class*="language-"], pre:has(code), pre');
  codeSnippets.forEach(snippet => {
    // Remove any existing copy buttons
    const existingCopyButtons = snippet.querySelectorAll(
      'button[title*="copy" i], button[aria-label*="copy" i], .copy-button, .copy-btn, .btn-copy, .code-clipboard, button[x-data*="code_snippet"], .lang-toolbar'
    );
    existingCopyButtons.forEach(btn => btn.remove());
    
    // Find the actual pre element
    const preElement = snippet.querySelector('pre') || (snippet.tagName === 'PRE' ? snippet : null);
    if (preElement) {
      preElement.classList.add('docs-code-snippet');
      (preElement as HTMLElement).style.position = 'relative';
      
      // Ensure there's a code element inside pre
      if (!preElement.querySelector('code')) {
        const codeElement = clonedElement.ownerDocument.createElement('code');
        codeElement.innerHTML = preElement.innerHTML;
        preElement.innerHTML = '';
        preElement.appendChild(codeElement);
      }
    }
  });
  
  // Process code elements - differentiate between standalone and inline
  const allCodeElements = clonedElement.querySelectorAll('code:not(pre code)');
  allCodeElements.forEach(code => {
    // Check if this is a standalone code block vs inline code
    const parent = code.parentElement;
    const isStandaloneCode = parent && (
      parent.tagName === 'BODY' || // Direct child of body
      (parent.tagName !== 'P' && parent.tagName !== 'SPAN' && parent.tagName !== 'A' && parent.tagName !== 'LI' && parent.tagName !== 'TD' && parent.tagName !== 'TH') || // Not within inline/text elements
      (parent.children.length === 1 && parent.textContent?.trim() === code.textContent?.trim()) // Only child with same content
    );
    
    if (isStandaloneCode && code.textContent && code.textContent.trim().length > 20) { // Threshold for standalone code
      // Convert standalone code to a proper code block
      const preWrapper = clonedElement.ownerDocument.createElement('pre');
      preWrapper.className = 'docs-code-snippet docs-standalone-code';
      preWrapper.style.position = 'relative';
      preWrapper.style.whiteSpace = 'pre-wrap'; // Enable wrapping
      preWrapper.style.wordBreak = 'break-word'; // Break long words
      preWrapper.style.overflowWrap = 'break-word'; // Handle overflow
      
      // Create new code element for the pre
      const newCodeElement = clonedElement.ownerDocument.createElement('code');
      newCodeElement.textContent = code.textContent;
      newCodeElement.className = 'docs-block-code';
      
      preWrapper.appendChild(newCodeElement);
      
      // Replace the original code element with the pre wrapper
      code.parentNode?.replaceChild(preWrapper, code);
    } else {
      // Keep as inline code
      code.classList.add('docs-inline-code');
    }
  });
  
  processInteractiveElements(clonedElement);

  // Process links to handle docs links vs external links differently
  const links = clonedElement.querySelectorAll('a[href]');
  
  links.forEach((link, index) => {
    const href = link.getAttribute('href');
    if (href) {
      let finalHref = href;
      
      // Handle anchor links (starting with #) - these should scroll within the page
      if (href.startsWith('#')) {
        // Mark as internal anchor link for special handling
        link.setAttribute('data-docs-anchor-link', 'true');
        link.setAttribute('data-anchor-target', href.substring(1)); // Remove the # prefix
        return; // Don't process further
      }
      
      // Fix relative URLs with configurable base URL
      if (href.startsWith('/')) {
        // Absolute path from root
        finalHref = `${getDocsBaseUrl()}${href}`;
        link.setAttribute('href', finalHref);
      } else if (href.startsWith('../') && !href.startsWith('http')) {
        // Relative path going up directories - likely a docs link
        // Convert to absolute URL by resolving relative to current docs context
        const currentUrl = url; // Use the current page URL as context
        try {
          const resolvedUrl = new URL(href, currentUrl);
          finalHref = resolvedUrl.href;
          link.setAttribute('href', finalHref);
        } catch (error) {
          console.warn(`🔗 Link ${index}: Failed to resolve relative URL ${href}, leaving as-is`);
        }
      } else if (!href.startsWith('http') && !href.startsWith('mailto:') && !href.startsWith('#')) {
        // Simple relative path (like "alertmanager/", "aws-cloudwatch/") - resolve against current URL
        const currentUrl = url; // Use the current page URL as context
        try {
          const resolvedUrl = new URL(href, currentUrl);
          finalHref = resolvedUrl.href;
          link.setAttribute('href', finalHref);
        } catch (error) {
          console.warn(`🔗 Link ${index}: Failed to resolve simple relative URL ${href}, leaving as-is`);
        }
      }
      
      const docsBaseUrl = getDocsBaseUrl(); // Should be https://grafana.com
      const isDocsLink = finalHref.startsWith(`${docsBaseUrl}/docs/`) || 
                        (href.startsWith('/docs/') && !href.startsWith('//'));
      
      if (isDocsLink) {
        // Docs links - will be handled by app tab system
        link.setAttribute('data-docs-internal-link', 'true');
        link.setAttribute('data-docs-link', 'true');
      } else {
        // External links - open in new browser tab
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        link.setAttribute('data-docs-link', 'true');
      }
    }
  });
  
  // Process anchor links (remove them since they won't work in our context)
  const anchorLinks = clonedElement.querySelectorAll('.docs-anchor-link');
  anchorLinks.forEach(anchor => anchor.remove());
  
  // Remove interactive guide sections and their preceding headers
  const guideSections = clonedElement.querySelectorAll('div.guide[x-data]');
  
  guideSections.forEach((guideSection, index) => {
    // Check for immediately preceding header element
    let previousElement = guideSection.previousElementSibling;
    
    // Skip over any whitespace or empty text nodes by checking previous elements
    while (previousElement && (
      previousElement.nodeType === Node.TEXT_NODE || 
      (previousElement.nodeType === Node.ELEMENT_NODE && previousElement.textContent?.trim() === '')
    )) {
      previousElement = previousElement.previousElementSibling;
    }
    
    // If the previous element is a header, remove it too
    if (previousElement && /^H[1-6]$/.test(previousElement.tagName)) {
      previousElement.remove();
    }
    
    // Remove the guide section
    guideSection.remove();
  });

  // Process admonitions (notes, warnings, etc.) - simplify to match learning journey style
  const admonitions = clonedElement.querySelectorAll('.admonition');
  
  admonitions.forEach((admonition, index) => {
    const blockquote = admonition.querySelector('blockquote');
    
    if (blockquote) {
      // Create a simple wrapper div with admonition classes (matching learning journey structure)
      const wrapper = clonedElement.ownerDocument.createElement('div');
      
      // Transfer admonition classes to the wrapper
      if (admonition.classList.contains('admonition-note')) {
        wrapper.classList.add('admonition-note');
      } else if (admonition.classList.contains('admonition-warning')) {
        wrapper.classList.add('admonition-warning');
      } else if (admonition.classList.contains('admonition-caution')) {
        wrapper.classList.add('admonition-caution');
      } else if (admonition.classList.contains('admonition-tip')) {
        wrapper.classList.add('admonition-tip');
      } else {
        wrapper.classList.add('admonition-note'); // Default to note
      }
      
      // Clean up the blockquote for simple styling
      blockquote.removeAttribute('class'); // Remove all classes
      
      // Process title elements within blockquote to match learning journey format
      const titleElement = blockquote.querySelector('.title');
      if (titleElement) {
        titleElement.classList.add('title');
      }
      
      // Wrap the blockquote and replace the original admonition
      wrapper.appendChild(blockquote);
      admonition.parentNode?.replaceChild(wrapper, admonition);
    }
  });
  
  // Process tables for better responsiveness
  const tables = clonedElement.querySelectorAll('table');
  tables.forEach(table => {
    table.classList.add('docs-table');
  });
  
  return clonedElement.innerHTML;
}

/**
 * Fetch single docs content with multiple strategies
 */
export async function fetchSingleDocsContent(url: string): Promise<SingleDocsContent | null> {
  // Use unstyled.html version for content fetching
  const unstyledUrl = getUnstyledContentUrl(url);
  
  // Split hash fragment for fetch (server doesn't need it) but preserve for content
  const [fetchUrl, hashFragment] = unstyledUrl.split('#');
  
  // Check cache first (use original URL as cache key)
  const cached = docsContentCache.get(url);
  if (cached && Date.now() - cached.timestamp < DOCS_CACHE_DURATION) {
    return cached.content;
  }
  
  // Try fetch with retry logic for redirects
  try {
    const startTime = Date.now();
    const htmlContent = await fetchWithRetry(fetchUrl); // Fetch without hash
    const duration = Date.now() - startTime;
    
    if (htmlContent && htmlContent.trim().length > 0) {
      const content = extractSingleDocsContent(htmlContent, url); // Use original URL for content
      
      // Add hash fragment to the content for scrolling
      if (hashFragment) {
        content.hashFragment = hashFragment;
      }
      
      // Cache the result (use original URL as cache key)
      docsContentCache.set(url, { content, timestamp: Date.now() });
      
      return content;
    } else {
      console.warn(`❌ Docs fetch with retry returned empty content after ${duration}ms`);
    }
  } catch (error) {
    console.warn(`❌ Docs fetch with retry failed:`, error);
  }
  
  console.error('Direct docs fetch failed for URL:', url);
  return null;
}

/**
 * Try direct fetch with redirect handling
 */
async function fetchDirectFast(url: string): Promise<string | null> {
  try {
    const headers = getAuthHeaders();
    
    // For authenticated requests, we might need additional CORS handling
    const fetchOptions: RequestInit = {
      method: 'GET',
      headers: headers,
      signal: AbortSignal.timeout(10000), // Increased timeout for redirects
      redirect: 'follow', // Explicitly follow redirects
    };
    
    // If we have authentication, try with credentials and explicit CORS mode
    if (getDocsUsername()) {
      fetchOptions.mode = 'cors';
      fetchOptions.credentials = 'omit'; // Don't send cookies, use explicit auth headers
    } else {
      fetchOptions.mode = 'cors';
    }
    
    const response = await fetch(url, fetchOptions);
    
    // Log redirect information
    if (response.url !== url) {
      // Ignore
    }
    
    if (!response.ok) {
      console.warn(`❌ Fetch failed with status ${response.status} for: ${url}`);
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const content = await response.text();
    return content;
  } catch (error) {
    console.warn(`❌ Direct docs fetch failed for ${url}:`, error);
    return null;
  }
}

/**
 * Try multiple URL patterns to handle redirects and moved pages
 */
async function fetchWithRetry(originalUrl: string): Promise<string | null> {
  // First try the original URL
  let content = await fetchDirectFast(originalUrl);
  if (content && content.trim().length > 0) {
    return content;
  }
  
  // If the original failed, try common redirect patterns
  const urlVariations = generateUrlVariations(originalUrl);
  
  for (let i = 0; i < urlVariations.length; i++) {
    const variation = urlVariations[i];
    
    content = await fetchDirectFast(variation);
    if (content && content.trim().length > 0) {
      return content;
    }
  }
  
  console.warn(`❌ All retry attempts failed for: ${originalUrl}`);
  return null;
}

/**
 * Generate URL variations to handle common redirect patterns
 */
function generateUrlVariations(url: string): string[] {
  // Split hash fragment to preserve it
  const [baseUrlWithUnstyled, hashFragment] = url.split('#');
  
  // Remove /unstyled.html to get base URL
  const baseUrl = baseUrlWithUnstyled.replace(/\/unstyled\.html$/, '/');
  
  // Common patterns for moved documentation
  const patterns = [
    // Try without trailing slash + unstyled.html
    baseUrl.replace(/\/$/, '') + '/unstyled.html',
    
    // Try adding common suffixes that indicate moved content
    baseUrl + 'configuration/unstyled.html',
    baseUrl + 'setup/unstyled.html',
    baseUrl + 'get-started/unstyled.html',
    
    // Try variations with different directory structures
    baseUrl.replace(/\/([^\/]+)\/$/, '/$1-config/$1/unstyled.html'),
    baseUrl.replace(/\/([^\/]+)\/$/, '/$1/$1/unstyled.html'),
    
    // Try the parent directory
    baseUrl.replace(/\/[^\/]+\/$/, '/unstyled.html'),
    
    // Try without the last path segment
    baseUrl.split('/').slice(0, -2).join('/') + '/unstyled.html',
  ];
  
  // Re-attach hash fragment if it exists and remove duplicates
  const uniquePatterns = [...new Set(patterns)]
    .filter(p => p !== baseUrlWithUnstyled && p.includes('/unstyled.html'))
    .map(p => hashFragment ? `${p}#${hashFragment}` : p);
  
  return uniquePatterns;
}

/**
 * Clear single docs cache
 */
export function clearSingleDocsCache(): void {
  try {
    docsContentCache.clear();
  } catch (error) {
    console.warn('Failed to clear single docs cache:', error);
  }
}

/**
 * Clear cache for a specific docs URL
 */
export function clearSpecificDocsCache(url: string): void {
  try {
    docsContentCache.delete(url);
  } catch (error) {
    console.warn('Failed to clear specific docs cache:', error);
  }
} 
