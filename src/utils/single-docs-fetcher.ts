export interface SingleDocsContent {
  title: string;
  content: string;
  url: string;
  lastFetched: string;
  breadcrumbs?: string[];
  labels?: string[];
}

// Simple in-memory cache for docs content
const docsContentCache = new Map<string, { content: SingleDocsContent; timestamp: number }>();
const DOCS_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Extract single docs content from HTML
 */
function extractSingleDocsContent(html: string, url: string): SingleDocsContent {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    console.log('Extracting docs content for:', url);
    console.log('HTML length:', html.length);
    
    // Extract title from h1 or title tag
    const titleElement = doc.querySelector('main#main h1') || doc.querySelector('h1') || doc.querySelector('title');
    const title = titleElement?.textContent?.trim() || 'Documentation';
    console.log('Extracted title:', title);
    
    // Find the main content section - try the actual Grafana docs selectors first
    const contentSelectors = [
      '#doc-article-text',           // Primary Grafana docs content
      '.docs-content',               // Alternative Grafana docs content  
      'main#main',                   // Fallback to original
      'main',                        // Generic main
      '.main', 
      '#main', 
      '.content'
    ];
    
    let mainElement: Element | null = null;
    let usedSelector = '';
    
    for (const selector of contentSelectors) {
      mainElement = doc.querySelector(selector);
      if (mainElement) {
        usedSelector = selector;
        console.log(`Found content with selector: ${selector}`);
        break;
      }
    }
    
    if (!mainElement) {
      console.warn('No content element found with any selector');
      return {
        title,
        content: 'Content not available - no content section found',
        url,
        lastFetched: new Date().toISOString()
      };
    }
    
    console.log(`Content element (${usedSelector}) innerHTML length before processing:`, mainElement.innerHTML.length);
    
    // Process the content
    const processedContent = processSingleDocsContent(mainElement);
    
    console.log('Processed content length:', processedContent.content.length);
    console.log('Breadcrumbs found:', processedContent.breadcrumbs?.length || 0);
    console.log('Labels found:', processedContent.labels?.length || 0);
    
    return {
      title,
      content: processedContent.content,
      url,
      lastFetched: new Date().toISOString(),
      breadcrumbs: processedContent.breadcrumbs,
      labels: processedContent.labels
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

/**
 * Process single docs content for better display
 */
function processSingleDocsContent(mainElement: Element): { 
  content: string; 
  breadcrumbs?: string[]; 
  labels?: string[];
} {
  const clonedElement = mainElement.cloneNode(true) as Element;
  
  // Extract breadcrumbs before removing them
  const breadcrumbs: string[] = [];
  const breadcrumbElement = clonedElement.querySelector('.docs__breadcrumb');
  if (breadcrumbElement) {
    const breadcrumbLinks = breadcrumbElement.querySelectorAll('.docs__breadcrumb--link');
    breadcrumbLinks.forEach(link => {
      const text = link.textContent?.trim();
      if (text) {
        breadcrumbs.push(text);
      }
    });
    
    // Add the final breadcrumb (current page)
    const finalBreadcrumb = breadcrumbElement.querySelector('span[data-counter]:last-child');
    if (finalBreadcrumb) {
      const text = finalBreadcrumb.textContent?.trim();
      if (text && !text.includes('breadcrumb arrow')) {
        breadcrumbs.push(text);
      }
    }
  }
  
  // Extract labels before processing
  const labels: string[] = [];
  const labelsSection = clonedElement.querySelector('.docs-labels');
  if (labelsSection) {
    const labelBadges = labelsSection.querySelectorAll('.docs-labels__item span');
    labelBadges.forEach(badge => {
      const text = badge.textContent?.trim();
      if (text && !text.includes('This page has content')) {
        labels.push(text);
      }
    });
  }
  
  // Remove unwanted elements
  const unwantedSelectors = [
    '.docs__breadcrumb', '.docs-labels', '.docs__feedback', '.docs__related', 
    '#docs-related-wrapper', '#ZN_1Nxe1cRmwG0iGqO', '.scrollspy-init'
  ];
  
  console.log('Content length before removing unwanted elements:', clonedElement.innerHTML.length);
  
  unwantedSelectors.forEach(selector => {
    const elements = clonedElement.querySelectorAll(selector);
    console.log(`Removing ${elements.length} elements with selector: ${selector}`);
    elements.forEach(el => el.remove());
  });
  
  console.log('Content length after removing unwanted elements:', clonedElement.innerHTML.length);
  
  // Process images - fix relative URLs
  const images = clonedElement.querySelectorAll('img');
  images.forEach(img => {
    const src = img.getAttribute('src');
    const dataSrc = img.getAttribute('data-src');
    const originalSrc = dataSrc || src;
    
    if (!originalSrc) return;
    
    // Fix relative URLs
    const newSrc = originalSrc.startsWith('http') || originalSrc.startsWith('data:') 
      ? originalSrc
      : originalSrc.startsWith('/') 
        ? `https://grafana.com${originalSrc}`
        : originalSrc.startsWith('./') 
          ? `https://grafana.com/docs/${originalSrc.substring(2)}`
          : originalSrc.startsWith('../') 
            ? `https://grafana.com/docs/${originalSrc.replace(/^\.\.\//, '')}`
            : `https://grafana.com/docs/${originalSrc}`;
    
    img.setAttribute('src', newSrc);
    img.removeAttribute('data-src');
    img.removeAttribute('data-srcset');
    img.classList.remove('lazyload', 'lazyloaded', 'ls-is-cached');
    img.classList.add('docs-image');
    img.setAttribute('loading', 'lazy');
    
    // Add alt text if missing
    if (!img.getAttribute('alt')) {
      img.setAttribute('alt', 'Documentation image');
    }
  });
  
  // Process code snippets and remove existing copy buttons
  const codeSnippets = clonedElement.querySelectorAll('.code-snippet, pre[class*="language-"], pre:has(code)');
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
        const codeElement = document.createElement('code');
        codeElement.innerHTML = preElement.innerHTML;
        preElement.innerHTML = '';
        preElement.appendChild(codeElement);
      }
    }
  });
  
  // Process links to ensure they open in new tabs
  const links = clonedElement.querySelectorAll('a[href]');
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href) {
      // Fix relative URLs
      if (href.startsWith('/')) {
        link.setAttribute('href', `https://grafana.com${href}`);
      }
      
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      link.setAttribute('data-docs-link', 'true');
    }
  });
  
  // Process anchor links (remove them since they won't work in our context)
  const anchorLinks = clonedElement.querySelectorAll('.docs-anchor-link');
  anchorLinks.forEach(anchor => anchor.remove());
  
  // Process admonitions (notes, warnings, etc.)
  const admonitions = clonedElement.querySelectorAll('.admonition');
  admonitions.forEach(admonition => {
    admonition.classList.add('docs-admonition');
  });
  
  console.log('Final processed content length:', clonedElement.innerHTML.length);
  console.log('Final content preview (first 500 chars):', clonedElement.innerHTML.substring(0, 500));
  
  return {
    content: clonedElement.innerHTML,
    breadcrumbs,
    labels
  };
}

/**
 * Fetch single docs content with multiple strategies
 */
export async function fetchSingleDocsContent(url: string): Promise<SingleDocsContent | null> {
  console.log(`Fetching single docs content from: ${url}`);
  
  // Check cache first
  const cached = docsContentCache.get(url);
  if (cached && Date.now() - cached.timestamp < DOCS_CACHE_DURATION) {
    console.log('Returning cached docs content for:', url);
    return cached.content;
  }
  
  // Try strategies in order of reliability
  const strategies = [
    { name: 'direct', fn: () => fetchDirectFast(url) },
    { name: 'corsproxy', fn: () => fetchWithCorsproxy(url) },
  ];
  
  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    
    try {
      console.log(`Trying docs strategy ${i + 1}/${strategies.length}: ${strategy.name}`);
      const startTime = Date.now();
      const htmlContent = await strategy.fn();
      const duration = Date.now() - startTime;
      
      if (htmlContent && htmlContent.trim().length > 0) {
        console.log(`✅ Docs strategy ${strategy.name} succeeded in ${duration}ms, content length: ${htmlContent.length}`);
        const content = extractSingleDocsContent(htmlContent, url);
        console.log(`Extracted docs content: ${content.title}`);
        
        // Cache the result
        docsContentCache.set(url, { content, timestamp: Date.now() });
        
        return content;
      } else {
        console.warn(`❌ Docs strategy ${strategy.name} returned empty content after ${duration}ms`);
      }
    } catch (error) {
      console.warn(`❌ Docs strategy ${strategy.name} failed:`, error);
      continue;
    }
  }
  
  console.error('All docs strategies failed for URL:', url);
  return null;
}

/**
 * Try direct fetch (faster version)
 */
async function fetchDirectFast(url: string): Promise<string | null> {
  try {
    console.log('Trying direct docs fetch...');
    const response = await fetch(url, {
      mode: 'cors',
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; GrafanaDocsReader/1.0)',
      },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const content = await response.text();
    console.log('Successfully fetched docs via direct fetch');
    return content;
  } catch (error) {
    console.warn('Direct docs fetch failed:', error);
    return null;
  }
}

/**
 * Fetch with corsproxy.io
 */
async function fetchWithCorsproxy(url: string): Promise<string | null> {
  try {
    const proxyUrl = `https://corsproxy.io/?${url}`;
    console.log(`Trying docs corsproxy.io: ${proxyUrl}`);
    
    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; GrafanaDocsReader/1.0)',
      },
      signal: AbortSignal.timeout(8000), // 8 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const content = await response.text();
    console.log('Successfully fetched docs via corsproxy.io');
    return content;
  } catch (error) {
    console.warn('Docs corsproxy.io failed:', error);
    return null;
  }
}

/**
 * Clear single docs cache
 */
export function clearSingleDocsCache(): void {
  try {
    docsContentCache.clear();
    console.log('Cleared single docs cache');
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
    console.log(`Cleared docs cache for: ${url}`);
  } catch (error) {
    console.warn('Failed to clear specific docs cache:', error);
  }
} 