export interface DocsContent {
  title: string;
  content: string;
  url: string;
  lastFetched: string;
}

export interface DocsRoute {
  path: string;
  docsUrl: string;
  title: string;
  patterns: string[];
}

// Map Grafana routes to their corresponding documentation URLs
export const DOCS_ROUTES: DocsRoute[] = [
  {
    path: 'dashboards',
    docsUrl: 'https://grafana.com/docs/grafana/latest/dashboards/',
    title: 'Dashboards',
    patterns: ['/dashboards', '/dashboard']
  },
  {
    path: 'dashboard-build',
    docsUrl: 'https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/',
    title: 'Build Dashboards',
    patterns: ['/dashboard/new', '/dashboard/edit', '/dashboard/create']
  },
  {
    path: 'explore',
    docsUrl: 'https://grafana.com/docs/grafana/latest/explore/',
    title: 'Explore',
    patterns: ['/explore']
  },
  {
    path: 'alerting',
    docsUrl: 'https://grafana.com/docs/grafana/latest/alerting/',
    title: 'Alerting',
    patterns: ['/alerting']
  },
  {
    path: 'alert-rules',
    docsUrl: 'https://grafana.com/docs/grafana/latest/alerting/alerting-rules/',
    title: 'Alert Rules',
    patterns: ['/alerting/new', '/alerting/edit', '/alerting/rules']
  },
  {
    path: 'datasources',
    docsUrl: 'https://grafana.com/docs/grafana/latest/datasources/',
    title: 'Data Sources',
    patterns: ['/connections', '/datasources']
  },
  {
    path: 'datasource-config',
    docsUrl: 'https://grafana.com/docs/grafana/latest/datasources/add-a-data-source/',
    title: 'Add Data Source',
    patterns: ['/connections/add-new-connection', '/datasources/new']
  },
  {
    path: 'panels',
    docsUrl: 'https://grafana.com/docs/grafana/latest/panels-visualizations/',
    title: 'Panels & Visualizations',
    patterns: ['/panels', '/panel']
  },
  {
    path: 'users',
    docsUrl: 'https://grafana.com/docs/grafana/latest/administration/user-management/',
    title: 'User Management',
    patterns: ['/admin/users', '/org/users']
  },
  {
    path: 'admin',
    docsUrl: 'https://grafana.com/docs/grafana/latest/administration/',
    title: 'Administration',
    patterns: ['/admin']
  },
  {
    path: 'plugins',
    docsUrl: 'https://grafana.com/docs/grafana/latest/administration/plugin-management/',
    title: 'Plugin Management',
    patterns: ['/plugins']
  },
  {
    path: 'home',
    docsUrl: 'https://grafana.com/docs/grafana/latest/',
    title: 'Grafana Documentation',
    patterns: ['/', '/home']
  }
];

/**
 * Smart context detection based on current URL
 */
export function detectDocsContext(currentPath: string, searchParams?: URLSearchParams): DocsRoute | null {
  // Clean the path
  const cleanPath = currentPath.toLowerCase().replace(/\/$/, '');
  
  // Check for specific patterns first (more specific matches)
  for (const route of DOCS_ROUTES) {
    for (const pattern of route.patterns) {
      if (cleanPath.includes(pattern.toLowerCase())) {
        // Additional context checks for more specific routing
        if (pattern === '/dashboard/new' || pattern === '/dashboard/edit' || pattern === '/dashboard/create') {
          return route; // Build dashboards docs
        }
        if (pattern === '/alerting/new' || pattern === '/alerting/edit' || pattern === '/alerting/rules') {
          return route; // Alert rules docs
        }
        if (pattern === '/connections/add-new-connection' || pattern === '/datasources/new') {
          return route; // Add data source docs
        }
        if (cleanPath.startsWith(pattern.toLowerCase())) {
          return route;
        }
      }
    }
  }
  
  // Fallback to home documentation
  return DOCS_ROUTES.find(r => r.path === 'home') || null;
}

/**
 * Multiple CORS proxy services to try
 */
const CORS_PROXIES = [
  'https://api.allorigins.win/get?url=',
  'https://corsproxy.io/?',
  'https://cors-anywhere.herokuapp.com/',
  'https://thingproxy.freeboard.io/fetch/',
];

/**
 * Strategy 1: Use multiple CORS proxy services with fallback
 */
export async function fetchDocsWithProxy(url: string): Promise<DocsContent | null> {
  for (const proxy of CORS_PROXIES) {
    try {
      console.log(`Trying proxy: ${proxy}`);
      
      let proxyUrl: string;
      let response: Response;
      
      if (proxy.includes('allorigins.win')) {
        proxyUrl = `${proxy}${encodeURIComponent(url)}`;
        response = await fetch(proxyUrl);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        const htmlContent = data.contents;
        
        return {
          title: extractTitle(htmlContent),
          content: extractMainContent(htmlContent),
          url,
          lastFetched: new Date().toISOString()
        };
      } else {
        proxyUrl = `${proxy}${url}`;
        response = await fetch(proxyUrl);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const htmlContent = await response.text();
        
        return {
          title: extractTitle(htmlContent),
          content: extractMainContent(htmlContent),
          url,
          lastFetched: new Date().toISOString()
        };
      }
    } catch (error) {
      console.warn(`Proxy ${proxy} failed:`, error);
      continue; // Try next proxy
    }
  }
  
  console.error('All CORS proxies failed');
  return null;
}

/**
 * Strategy 2: Try direct fetch (might work in some environments)
 */
export async function fetchDocsDirect(url: string): Promise<DocsContent | null> {
  try {
    const response = await fetch(url, {
      mode: 'cors',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; GrafanaDocsPlugin/1.0)',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const htmlContent = await response.text();
    
    return {
      title: extractTitle(htmlContent),
      content: extractMainContent(htmlContent),
      url,
      lastFetched: new Date().toISOString()
    };
  } catch (error) {
    console.warn('Direct fetch failed:', error);
    return null;
  }
}

/**
 * Strategy 3: Use a simple web scraping API
 */
export async function fetchDocsWithScraper(url: string): Promise<DocsContent | null> {
  try {
    // Using a simple scraping service
    const scraperUrl = `https://api.scraperapi.com/?api_key=demo&url=${encodeURIComponent(url)}`;
    const response = await fetch(scraperUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const htmlContent = await response.text();
    
    return {
      title: extractTitle(htmlContent),
      content: extractMainContent(htmlContent),
      url,
      lastFetched: new Date().toISOString()
    };
  } catch (error) {
    console.warn('Scraper API failed:', error);
    return null;
  }
}

/**
 * Strategy 4: Pre-cached content with localStorage
 */
export function getCachedDocs(path: string): DocsContent | null {
  try {
    const cachedContent = localStorage.getItem(`docs-cache-${path}`);
    if (cachedContent) {
      return JSON.parse(cachedContent);
    }
  } catch (error) {
    console.warn('Failed to get cached docs:', error);
  }
  return null;
}

/**
 * Extract the main title from HTML content
 */
function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    return titleMatch[1].replace(/\s*\|\s*Grafana.*$/, '').trim();
  }
  
  // Fallback to h1 tag
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) {
    return h1Match[1].replace(/<[^>]*>/g, '').trim();
  }
  
  return 'Documentation';
}

/**
 * Extract main content from Grafana docs HTML
 */
function extractMainContent(html: string): string {
  try {
    // Create a temporary DOM element to parse HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Remove unwanted elements first (before looking for content)
    const unwantedSelectors = [
      'nav', 'header', 'footer', 'aside',
      '.navbar', '.nav', '.navigation', '.nav-bar',
      '.sidebar', '.menu', '.breadcrumb', '.breadcrumbs',
      '.cookie', '.banner', '.alert', '.notification',
      'script', 'style', 'noscript',
      '.search', '.filter', '.pagination',
      '.social', '.share', '.feedback',
      '.toc', '.table-of-contents',
      '[role="navigation"]', '[aria-label*="navigation"]',
      '[aria-label*="breadcrumb"]', '[class*="breadcrumb"]',
      '.docs-sidebar', '.sidebar-nav',
      '.page-nav', '.site-nav',
      // Grafana specific navigation elements
      '.theme-doc-sidebar-container',
      '.navbar__inner', '.navbar__items',
      '.breadcrumbs__item', '.breadcrumbs__link',
      '.pagination-nav'
    ];
    
    unwantedSelectors.forEach(selector => {
      const elements = doc.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    });
    
    // Try to find the main content area (Grafana docs specific selectors)
    const selectors = [
      'main[role="main"]',
      '.docs-content',
      'article',
      '.markdown-body',
      '[data-testid="docs-content"]',
      '.content',
      '.page-content',
      '#content',
      '.main-content',
      // More specific selectors for Grafana docs
      '.docusaurus-content',
      '.theme-doc-markdown',
      '.markdown',
      '.theme-doc-markdown.markdown',
      '.container .row .col'
    ];
    
    let contentElement = null;
    
    for (const selector of selectors) {
      const element = doc.querySelector(selector);
      if (element) {
        contentElement = element;
        break;
      }
    }
    
    // If no main content found, try to extract from body but be more selective
    if (!contentElement) {
      const bodyContent = doc.body;
      if (bodyContent) {
        contentElement = bodyContent;
      }
    }
    
    if (!contentElement) {
      return html; // Return raw HTML as fallback
    }
    
    // Remove any remaining navigation elements from the content
    const additionalUnwanted = contentElement.querySelectorAll(
      'nav, .breadcrumb, .breadcrumbs, [aria-label*="breadcrumb"], .nav-links, .pagination'
    );
    additionalUnwanted.forEach(el => el.remove());
    
    // Process the content to improve structure
    const processedContent = processContentStructure(contentElement);
    
    return cleanupContent(processedContent);
  } catch (error) {
    console.warn('Failed to parse HTML:', error);
    return html; // Return raw HTML as fallback
  }
}

/**
 * Process content structure to improve rendering
 */
function processContentStructure(element: Element): string {
  // Clone the element to avoid modifying the original
  const clonedElement = element.cloneNode(true) as Element;
  
  // Remove any remaining breadcrumbs or navigation
  const navElements = clonedElement.querySelectorAll(
    'nav, .breadcrumb, .breadcrumbs, [aria-label*="breadcrumb"], .nav-links, .pagination'
  );
  navElements.forEach(el => el.remove());
  
  // Improve heading structure
  const headings = clonedElement.querySelectorAll('h1, h2, h3, h4, h5, h6');
  headings.forEach(heading => {
    // Add proper spacing and styling classes
    heading.setAttribute('class', `docs-heading docs-heading-${heading.tagName.toLowerCase()}`);
  });
  
  // Process links for internal navigation - SIMPLIFIED APPROACH
  const links = clonedElement.querySelectorAll('a[href]');
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href) {
      // Handle anchor links (same page navigation)
      if (href.startsWith('#')) {
        link.setAttribute('data-anchor-link', 'true');
      }
      // Mark ALL links that could potentially be docs links for interception
      // This includes: absolute docs links, relative links, and any non-external links
      else if (
        href.includes('grafana.com/docs') ||           // Absolute docs links
        href.startsWith('/docs') ||                    // Root-relative docs links
        href.startsWith('./') ||                       // Same-directory relative
        href.startsWith('../') ||                      // Parent-directory relative
        href.startsWith('/') ||                        // Any root-relative link
        (!href.startsWith('http') &&                   // Any relative link that's not external
         !href.startsWith('mailto:') && 
         !href.startsWith('tel:') && 
         !href.startsWith('javascript:') &&
         !href.startsWith('ftp:'))
      ) {
        link.setAttribute('data-docs-link', 'true');
        console.log(`Marked as docs link: ${href}`);
      }
      // External links open in new tab
      else if (href.startsWith('http') && !href.includes('grafana.com')) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        console.log(`Marked as external link: ${href}`);
      }
    }
  });
  
  // Improve list structure
  const lists = clonedElement.querySelectorAll('ul, ol');
  lists.forEach(list => {
    list.setAttribute('class', 'docs-list');
    const items = list.querySelectorAll('li');
    items.forEach(item => {
      item.setAttribute('class', 'docs-list-item');
    });
  });
  
  // Improve paragraph structure
  const paragraphs = clonedElement.querySelectorAll('p');
  paragraphs.forEach(p => {
    p.setAttribute('class', 'docs-paragraph');
  });
  
  // Improve code blocks
  const codeBlocks = clonedElement.querySelectorAll('pre');
  codeBlocks.forEach(pre => {
    pre.setAttribute('class', 'docs-code-block');
  });
  
  // Improve inline code
  const inlineCodes = clonedElement.querySelectorAll('code');
  inlineCodes.forEach(code => {
    if (!code.closest('pre')) {
      code.setAttribute('class', 'docs-inline-code');
    }
  });
  
  // Improve blockquotes
  const blockquotes = clonedElement.querySelectorAll('blockquote');
  blockquotes.forEach(quote => {
    quote.setAttribute('class', 'docs-blockquote');
  });
  
  // Improve tables
  const tables = clonedElement.querySelectorAll('table');
  tables.forEach(table => {
    table.setAttribute('class', 'docs-table');
    // Wrap table in a container for better responsive behavior
    const wrapper = document.createElement('div');
    wrapper.setAttribute('class', 'docs-table-wrapper');
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
  
  // Improve images
  const images = clonedElement.querySelectorAll('img');
  console.log(`Found ${images.length} images to process`);
  
  images.forEach((img, index) => {
    img.setAttribute('class', 'docs-image');
    
    // Handle both src and data-src attributes (for lazy loading)
    const src = img.getAttribute('src');
    const dataSrc = img.getAttribute('data-src');
    const originalSrc = dataSrc || src; // Prefer data-src if available
    
    console.log(`Processing image ${index + 1}: src="${src}", data-src="${dataSrc}", using="${originalSrc}"`);
    
    if (originalSrc) {
      let newSrc = originalSrc;
      
      // Handle different URL patterns
      if (originalSrc.startsWith('/media/')) {
        // Grafana media URLs like /media/docs/grafana/panels-visualizations/screenshot-panel-overview-ann-v11.0.png
        newSrc = `https://grafana.com${originalSrc}`;
      } else if (originalSrc.startsWith('/static/')) {
        // Static assets
        newSrc = `https://grafana.com${originalSrc}`;
      } else if (originalSrc.startsWith('/img/')) {
        // Image assets
        newSrc = `https://grafana.com${originalSrc}`;
      } else if (originalSrc.startsWith('/') && !originalSrc.startsWith('//')) {
        // Other root-relative URLs
        newSrc = `https://grafana.com${originalSrc}`;
      } else if (originalSrc.startsWith('./')) {
        // Same-directory relative URLs
        newSrc = `https://grafana.com/docs/${originalSrc.substring(2)}`;
      } else if (originalSrc.startsWith('../')) {
        // Parent-directory relative URLs
        newSrc = `https://grafana.com/docs/${originalSrc.replace(/^\.\.\//, '')}`;
      } else if (!originalSrc.startsWith('http') && !originalSrc.startsWith('//') && !originalSrc.startsWith('data:')) {
        // Other relative URLs (but not data URLs)
        newSrc = `https://grafana.com/docs/${originalSrc}`;
      }
      
      if (newSrc !== originalSrc) {
        console.log(`Updated image src from "${originalSrc}" to "${newSrc}"`);
        // Set both src and remove data-src to disable lazy loading
        img.setAttribute('src', newSrc);
        img.removeAttribute('data-src');
        // Remove lazy loading classes
        img.classList.remove('lazyload', 'lazyloaded', 'ls-is-cached');
      } else if (dataSrc && !src) {
        // If we have data-src but no src, copy data-src to src
        img.setAttribute('src', dataSrc);
        img.removeAttribute('data-src');
        img.classList.remove('lazyload', 'lazyloaded', 'ls-is-cached');
      }
    }
    
    // Handle srcset for responsive images
    const srcset = img.getAttribute('srcset');
    const dataSrcset = img.getAttribute('data-srcset');
    const originalSrcset = dataSrcset || srcset;
    
    if (originalSrcset) {
      console.log(`Processing srcset: ${originalSrcset}`);
      // Handle srcset which can contain multiple URLs
      const fixedSrcset = originalSrcset.replace(/([^,\s]+)/g, (url) => {
        if (url.startsWith('/media/') || url.startsWith('/static/') || url.startsWith('/img/')) {
          return `https://grafana.com${url}`;
        } else if (url.startsWith('/') && !url.startsWith('//')) {
          return `https://grafana.com${url}`;
        }
        return url;
      });
      img.setAttribute('srcset', fixedSrcset);
      img.removeAttribute('data-srcset');
      console.log(`Updated srcset to: ${fixedSrcset}`);
    }
    
    // Add error handling for broken images with debugging
    img.setAttribute('onerror', `
      console.warn('Failed to load image:', this.src);
      this.style.display='none';
      this.setAttribute('data-load-failed', 'true');
    `);
    
    // Add load success handler for debugging
    img.setAttribute('onload', `
      console.log('Successfully loaded image:', this.src);
      this.setAttribute('data-load-success', 'true');
    `);
    
    // Remove lazy loading attribute since we're loading immediately
    img.removeAttribute('loading');
    
    // Add alt text if missing
    if (!img.getAttribute('alt')) {
      img.setAttribute('alt', 'Documentation image');
    }
    
    // Wrap images in a container
    const wrapper = document.createElement('div');
    wrapper.setAttribute('class', 'docs-image-wrapper');
    img.parentNode?.insertBefore(wrapper, img);
    wrapper.appendChild(img);
  });
  
  return clonedElement.innerHTML;
}

/**
 * Clean up extracted content for better display
 */
function cleanupContent(content: string): string {
  return content
    // Remove script tags
    .replace(/<script[^>]*>.*?<\/script>/gis, '')
    // Remove style tags
    .replace(/<style[^>]*>.*?<\/style>/gis, '')
    // Remove comments
    .replace(/<!--.*?-->/gis, '')
    // Remove empty elements
    .replace(/<(\w+)[^>]*>\s*<\/\1>/g, '')
    // Fix image URLs - handle various patterns
    .replace(/src="\/([^"]*)/g, 'src="https://grafana.com/$1')
    .replace(/src="\.\.\/([^"]*)/g, 'src="https://grafana.com/$1')
    .replace(/src="\.\/([^"]*)/g, 'src="https://grafana.com/$1')
    // Fix srcset attributes for responsive images
    .replace(/srcset="\/([^"]*)/g, 'srcset="https://grafana.com/$1')
    .replace(/srcset="\.\.\/([^"]*)/g, 'srcset="https://grafana.com/$1')
    .replace(/srcset="\.\/([^"]*)/g, 'srcset="https://grafana.com/$1')
    // Only fix absolute links that start with /docs/ - leave relative links alone
    .replace(/href="\/docs\/([^"]*)/g, 'href="https://grafana.com/docs/$1')
    // Remove empty paragraphs
    .replace(/<p[^>]*>\s*<\/p>/g, '')
    // Clean up excessive whitespace
    .replace(/\s+/g, ' ')
    // Remove common unwanted elements
    .replace(/<button[^>]*>.*?<\/button>/gis, '')
    .replace(/class="[^"]*cookie[^"]*"/gi, '')
    .replace(/class="[^"]*banner[^"]*"/gi, '')
    .replace(/class="[^"]*advertisement[^"]*"/gi, '')
    // Remove data attributes that might cause issues
    .replace(/data-[^=]*="[^"]*"/g, '')
    .trim();
}

/**
 * Get documentation for a specific route with multiple fallback strategies
 */
export async function getDocsForRoute(routePath: string): Promise<DocsContent | null> {
  let route: DocsRoute | null = null;
  let cacheKey: string;
  
  // Check if this is a direct documentation URL
  if (routePath.includes('grafana.com/docs')) {
    // Extract the path from the URL for caching
    const urlMatch = routePath.match(/grafana\.com\/docs\/(.+)/);
    const docPath = urlMatch ? urlMatch[1] : routePath;
    cacheKey = `direct-${docPath}`;
    
    // Create a temporary route object for direct URLs
    route = {
      path: docPath,
      docsUrl: routePath,
      title: 'Documentation',
      patterns: []
    };
    
    console.log(`Direct documentation URL: ${routePath}`);
  } else {
    // Use smart context detection for Grafana UI paths
    route = detectDocsContext(routePath);
    if (!route) {
      return null;
    }
    cacheKey = route.path;
    console.log(`Detected context: ${route.title} for path: ${routePath}`);
  }
  
  // Try cached content first (if fresh)
  const cached = getCachedDocs(cacheKey);
  if (cached && isContentFresh(cached.lastFetched)) {
    console.log('Using fresh cached content');
    return cached;
  }
  
  // Try multiple fetching strategies
  const strategies = [
    () => fetchDocsDirect(route.docsUrl),
    () => fetchDocsWithProxy(route.docsUrl),
    () => fetchDocsWithScraper(route.docsUrl),
  ];
  
  for (const strategy of strategies) {
    try {
      const content = await strategy();
      if (content) {
        // Cache the successful content
        try {
          localStorage.setItem(`docs-cache-${cacheKey}`, JSON.stringify(content));
        } catch (error) {
          console.warn('Failed to cache content:', error);
        }
        return content;
      }
    } catch (error) {
      console.warn('Strategy failed:', error);
      continue;
    }
  }
  
  // If all strategies fail, return stale cache or fallback content
  if (cached) {
    console.log('Using stale cached content');
    return cached;
  }
  
  // For direct URLs, don't use fallback content since we don't have a proper route
  if (routePath.includes('grafana.com/docs')) {
    console.log('No content available for direct URL');
    return null;
  }
  
  console.log('No content available, all strategies failed');
  return null;
}

/**
 * Check if cached content is still fresh (less than 1 hour old)
 */
function isContentFresh(lastFetched: string): boolean {
  const oneHour = 60 * 60 * 1000;
  const fetchTime = new Date(lastFetched).getTime();
  const now = new Date().getTime();
  return (now - fetchTime) < oneHour;
}

/**
 * Clear all cached documentation
 */
export function clearDocsCache(): void {
  // Clear predefined route caches
  DOCS_ROUTES.forEach(route => {
    try {
      localStorage.removeItem(`docs-cache-${route.path}`);
    } catch (error) {
      console.warn('Failed to clear cache for', route.path, error);
    }
  });
  
  // Clear direct URL caches (they start with 'direct-')
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('docs-cache-direct-')) {
        keysToRemove.push(key);
      }
    }
    
    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
    });
    
    console.log(`Cleared ${keysToRemove.length} direct URL caches`);
  } catch (error) {
    console.warn('Failed to clear direct URL caches:', error);
  }
}