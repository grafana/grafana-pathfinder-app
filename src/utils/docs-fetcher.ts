export interface LearningJourneyContent {
  title: string;
  content: string;
  url: string;
  currentMilestone: number;
  totalMilestones: number;
  milestones: Milestone[];
  lastFetched: string;
}

export interface Milestone {
  number: number;
  title: string;
  duration: string;
  url: string;
  isActive: boolean;
}

export interface LearningJourneyTab {
  id: string;
  title: string;
  baseUrl: string;
  content: LearningJourneyContent | null;
  isLoading: boolean;
  error: string | null;
}

// Simple in-memory cache for content
const contentCache = new Map<string, { content: LearningJourneyContent; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Cache for storing milestone information from cover pages
const milestoneCache = new Map<string, Milestone[]>();

/**
 * Get the base URL for a learning journey
 */
function getLearningJourneyBaseUrl(url: string): string {
  // Extract the base learning journey URL
  const match = url.match(/^(https?:\/\/[^\/]+\/docs\/learning-journeys\/[^\/]+\/)/);
  return match ? match[1] : url;
}

/**
 * Cache milestone information for a learning journey
 */
function cacheMilestones(baseUrl: string, milestones: Milestone[]): void {
  milestoneCache.set(baseUrl, milestones);
}

/**
 * Get cached milestone information for a learning journey
 */
function getCachedMilestones(baseUrl: string): Milestone[] | null {
  return milestoneCache.get(baseUrl) || null;
}

/**
 * Extract learning journey content from HTML
 */
function extractLearningJourneyContent(html: string, url: string): LearningJourneyContent {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Extract title
    const titleElement = doc.querySelector('h1') || doc.querySelector('title');
    const title = titleElement?.textContent?.trim() || 'Learning Journey';
    
    // Get the base URL for this learning journey
    const baseUrl = getLearningJourneyBaseUrl(url);
    
    // Check if we have cached milestones (meaning this is navigation within a journey)
    const cachedMilestones = getCachedMilestones(baseUrl);
    const isNavigatingWithinJourney = cachedMilestones && cachedMilestones.length > 0;
    
    console.log(`Processing URL: ${url}, baseUrl: ${baseUrl}, hasCache: ${!!cachedMilestones}`);
    
    // Extract milestones from the page structure
    const milestones: Milestone[] = [];
    let currentMilestone = 0;
    let totalMilestones = 1;
    
    if (!isNavigatingWithinJourney) {
      // This is a fresh journey start - extract milestones from the page
      console.log('Fresh journey start - extracting milestones from page');
      
      // Look for the journey-steps section which contains all milestone information
      const journeyStepsSection = doc.querySelector('.journey-steps');
      
      if (journeyStepsSection) {
        console.log('Found journey-steps section');
        
        // Extract milestone links from the journey-steps section
        const milestoneLinks = journeyStepsSection.querySelectorAll('a.journey-milestone__link');
        
        console.log(`Found ${milestoneLinks.length} milestone links`);
        
        milestoneLinks.forEach((link, index) => {
          const href = link.getAttribute('href');
          const titleElement = link.querySelector('.journey-milestone__link-title');
          const durationElement = link.querySelector('.text-black.f-12.fw-500');
          
          if (href && titleElement) {
            const title = titleElement.textContent?.trim() || `Milestone ${index + 1}`;
            const duration = durationElement?.textContent?.trim() || '1 min';
            const fullUrl = href.startsWith('http') ? href : new URL(href, url).href;
            
            milestones.push({
              number: index + 1,
              title: title,
              duration: duration,
              url: fullUrl,
              isActive: false
            });
          }
        });
        
        // Cache the milestones for this learning journey
        if (milestones.length > 0) {
          cacheMilestones(baseUrl, milestones);
          console.log(`Cached ${milestones.length} milestones for journey`);
        }
        
        totalMilestones = milestones.length;
        currentMilestone = 0; // Cover page
      } else {
        console.error('No journey-steps section found in the page. This may not be a valid learning journey page.');
        throw new Error('Invalid learning journey page: missing journey-steps section');
      }
    } else {
      // Use cached milestone information
      console.log('Using cached milestone information');
      milestones.push(...cachedMilestones);
      totalMilestones = cachedMilestones.length;
      
      // Determine current milestone from URL
      currentMilestone = findCurrentMilestoneFromUrl(url, cachedMilestones);
      
      // Reset all milestone active states first, then set the current one
      milestones.forEach(milestone => {
        milestone.isActive = false;
      });
      
      // Set the current milestone as active
      if (currentMilestone > 0 && currentMilestone <= milestones.length) {
        const activeMilestone = milestones.find(m => m.number === currentMilestone);
        if (activeMilestone) {
          activeMilestone.isActive = true;
          console.log(`✅ Set milestone ${currentMilestone} as active: ${activeMilestone.title}`);
        } else {
          console.warn(`⚠️ Could not find milestone ${currentMilestone} to set as active`);
        }
      } else {
        console.log(`📍 Current milestone ${currentMilestone} is cover page or out of range`);
      }
      
      console.log(`🧭 Navigation state: Current=${currentMilestone}, Total=${totalMilestones}, URL=${url}`);
      console.log(`📋 Milestones summary:`, milestones.map(m => `${m.number}: ${m.isActive ? '✅' : '⭕'} ${m.title}`));
    }
    
    // Extract main content
    const content = extractMainContent(doc, currentMilestone === 0);
    
    return {
      title,
      content,
      url,
      currentMilestone,
      totalMilestones,
      milestones,
      lastFetched: new Date().toISOString()
    };
  } catch (error) {
    console.warn('Failed to parse learning journey content:', error);
    return {
      title: 'Learning Journey',
      content: html,
      url,
      currentMilestone: 1,
      totalMilestones: 1,
      milestones: [],
      lastFetched: new Date().toISOString()
    };
  }
}

/**
 * Extract main content from learning journey HTML
 */
function extractMainContent(doc: Document, isCoverPage: boolean): string {
  // Find the main content section
  const contentElement = doc.querySelector('.journey-grid__content');
  
  if (!contentElement) {
    return 'Content not available - journey-grid__content section not found';
  }
  
  // Process the content
  const processedContent = processLearningJourneyContent(contentElement, isCoverPage);
  return processedContent;
}

/**
 * Process learning journey content for better display
 */
function processLearningJourneyContent(element: Element, isCoverPage: boolean): string {
  const clonedElement = element.cloneNode(true) as Element;
  
  // Remove unwanted navigation elements
  const unwantedElements = clonedElement.querySelectorAll(
    '.journey-pagination__grid, .milestone-bottom'
  );
  unwantedElements.forEach(el => el.remove());
  
  // For cover pages, add our own "Start Journey" button
  if (isCoverPage) {
    const startButton = document.createElement('div');
    startButton.className = 'journey-start-section';
    startButton.innerHTML = `
      <div class="journey-start-container">
        <h3>Ready to begin?</h3>
        <button class="journey-start-button" data-journey-start="true">
          Start Learning Journey
        </button>
      </div>
    `;
    clonedElement.appendChild(startButton);
  }
  
  // Process images to fix relative URLs
  const images = clonedElement.querySelectorAll('img');
  images.forEach(img => {
    const src = img.getAttribute('src');
    const dataSrc = img.getAttribute('data-src');
    const originalSrc = dataSrc || src;
    const alt = img.getAttribute('alt') || '';
    const width = img.getAttribute('width');
    const height = img.getAttribute('height');
    
    if (originalSrc) {
      let newSrc = originalSrc;
      
      if (originalSrc.startsWith('/')) {
        newSrc = `https://grafana.com${originalSrc}`;
      } else if (originalSrc.startsWith('./')) {
        newSrc = `https://grafana.com/docs/${originalSrc.substring(2)}`;
      } else if (originalSrc.startsWith('../')) {
        newSrc = `https://grafana.com/docs/${originalSrc.replace(/^\.\.\//, '')}`;
      } else if (!originalSrc.startsWith('http') && !originalSrc.startsWith('data:')) {
        newSrc = `https://grafana.com/docs/${originalSrc}`;
      }
      
      img.setAttribute('src', newSrc);
      img.removeAttribute('data-src');
      img.classList.remove('lazyload', 'lazyloaded', 'ls-is-cached');
      
      // Add responsive image classes based on content and size
      img.classList.add('journey-image');
      
      // Classify images based on their characteristics
      const srcLower = newSrc.toLowerCase();
      const altLower = alt.toLowerCase();
      
      if (srcLower.includes('screenshot') || srcLower.includes('dashboard') || 
          srcLower.includes('interface') || altLower.includes('screenshot') ||
          altLower.includes('dashboard') || altLower.includes('interface')) {
        img.classList.add('journey-screenshot');
      } else if (srcLower.includes('icon') || srcLower.includes('logo') || 
                 srcLower.includes('badge') || altLower.includes('icon') ||
                 altLower.includes('logo') || altLower.includes('badge')) {
        img.classList.add('journey-icon');
      } else if (srcLower.includes('diagram') || srcLower.includes('chart') || 
                 srcLower.includes('graph') || altLower.includes('diagram') ||
                 altLower.includes('chart') || altLower.includes('graph')) {
        img.classList.add('journey-diagram');
      }
      
      // Add size-based classes
      if (width && height) {
        const w = parseInt(width);
        const h = parseInt(height);
        
        if (w > 800 || h > 600) {
          img.classList.add('journey-large');
        } else if (w < 200 && h < 200) {
          img.classList.add('journey-small');
        }
        
        // For very wide images (like banners or headers)
        if (w > h * 2) {
          img.classList.add('journey-wide');
        }
      }
      
      // Add loading optimization
      img.setAttribute('loading', 'lazy');
      
      // Add alt text if missing
      if (!alt) {
        img.setAttribute('alt', 'Learning journey image');
      }
    }
  });
  
  // Process links to open in new tabs
  const links = clonedElement.querySelectorAll('a[href]');
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href) {
      // Mark all links as external to open in new tabs
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      link.setAttribute('data-journey-link', 'true');
    }
  });
  
  return clonedElement.innerHTML;
}

/**
 * Fetch learning journey content with multiple strategies
 */
export async function fetchLearningJourneyContent(url: string): Promise<LearningJourneyContent | null> {
  console.log(`Fetching learning journey content from: ${url}`);
  
  // Check cache first
  const cached = contentCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('Returning cached content for:', url);
    return cached.content;
  }
  
  // Check if this looks like a cover page vs milestone page
  const isCoverPageUrl = url.endsWith('/') && !url.includes('/business-value') && !url.includes('/when-to') && !url.includes('/verify');
  console.log(`URL appears to be cover page: ${isCoverPageUrl}`);
  
  // Try strategies in order of reliability - direct fetch first, then working proxies
  const strategies = [
    { name: 'direct', fn: () => fetchDirectFast(url) },
    { name: 'corsproxy', fn: () => fetchWithCorsproxy(url) },
    // Removed allorigins.win as it's failing with QUIC errors
  ];
  
  // For milestone pages, also try adding trailing slash if missing
  if (!isCoverPageUrl && !url.endsWith('/')) {
    const urlWithSlash = url + '/';
    console.log(`Also trying milestone URL with trailing slash: ${urlWithSlash}`);
    strategies.unshift(
      { name: 'direct-slash', fn: () => fetchDirectFast(urlWithSlash) },
      { name: 'corsproxy-slash', fn: () => fetchWithCorsproxy(urlWithSlash) }
    );
  }
  
  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    
    try {
      console.log(`Trying strategy ${i + 1}/${strategies.length}: ${strategy.name}`);
      const startTime = Date.now();
      const htmlContent = await strategy.fn();
      const duration = Date.now() - startTime;
      
      if (htmlContent && htmlContent.trim().length > 0) {
        console.log(`✅ Strategy ${strategy.name} succeeded in ${duration}ms, content length: ${htmlContent.length}`);
        const content = extractLearningJourneyContent(htmlContent, url);
        console.log(`Extracted content: ${content.title}, milestones: ${content.milestones.length}`);
        
        // Cache the result
        contentCache.set(url, { content, timestamp: Date.now() });
        
        return content;
      } else {
        console.warn(`❌ Strategy ${strategy.name} returned empty content after ${duration}ms`);
      }
    } catch (error) {
      console.warn(`❌ Strategy ${strategy.name} failed:`, error);
      continue;
    }
  }
  
  console.error('All strategies failed for URL:', url);
  return null;
}

/**
 * Fetch with corsproxy.io (the working proxy service)
 */
async function fetchWithCorsproxy(url: string): Promise<string | null> {
  try {
    const proxyUrl = `https://corsproxy.io/?${url}`;
    console.log(`Trying corsproxy.io: ${proxyUrl}`);
    
    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; GrafanaLearningJourney/1.0)',
      },
      signal: AbortSignal.timeout(8000), // 8 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const content = await response.text();
    console.log('Successfully fetched via corsproxy.io');
    return content;
  } catch (error) {
    console.warn('Corsproxy.io failed:', error);
    return null;
  }
}

/**
 * Try direct fetch (faster version)
 */
async function fetchDirectFast(url: string): Promise<string | null> {
  try {
    console.log('Trying direct fetch...');
    const response = await fetch(url, {
      mode: 'cors',
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; GrafanaLearningJourney/1.0)',
      },
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const content = await response.text();
    console.log('Successfully fetched via direct fetch');
    return content;
  } catch (error) {
    console.warn('Direct fetch failed:', error);
    return null;
  }
}

/**
 * Get next milestone URL
 */
export function getNextMilestoneUrl(content: LearningJourneyContent): string | null {
  console.log(`🔄 Getting next milestone from current: ${content.currentMilestone} of ${content.totalMilestones}`);
  
  // If we're on the cover page (milestone 0), go to milestone 1
  if (content.currentMilestone === 0 && content.milestones.length > 0) {
    console.log(`📍 From cover page -> milestone 1: ${content.milestones[0].url}`);
    return content.milestones[0].url;
  }
  
  // If we're on a milestone, go to the next one
  if (content.currentMilestone > 0 && content.currentMilestone < content.totalMilestones) {
    const nextMilestone = content.milestones.find(m => m.number === content.currentMilestone + 1);
    if (nextMilestone) {
      console.log(`📍 From milestone ${content.currentMilestone} -> milestone ${nextMilestone.number}: ${nextMilestone.url}`);
      return nextMilestone.url;
    }
  }
  
  console.log(`❌ No next milestone available from current: ${content.currentMilestone}`);
  return null;
}

/**
 * Get previous milestone URL
 */
export function getPreviousMilestoneUrl(content: LearningJourneyContent): string | null {
  console.log(`🔄 Getting previous milestone from current: ${content.currentMilestone} of ${content.totalMilestones}`);
  
  // If we're on milestone 1, can't go back (cover page isn't navigable via previous)
  if (content.currentMilestone <= 1) {
    console.log(`❌ Cannot go back from milestone ${content.currentMilestone}`);
    return null;
  }
  
  // If we're on a milestone > 1, go to the previous one
  if (content.currentMilestone > 1 && content.currentMilestone <= content.totalMilestones) {
    const prevMilestone = content.milestones.find(m => m.number === content.currentMilestone - 1);
    if (prevMilestone) {
      console.log(`📍 From milestone ${content.currentMilestone} -> milestone ${prevMilestone.number}: ${prevMilestone.url}`);
      return prevMilestone.url;
    }
  }
  
  console.log(`❌ No previous milestone available from current: ${content.currentMilestone}`);
  return null;
}

/**
 * Clear learning journey cache
 */
export function clearLearningJourneyCache(): void {
  try {
    // Clear localStorage cache
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('journey-cache-')) {
        keysToRemove.push(key);
      }
    }
    
    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
    });
    
    // Clear milestone cache
    milestoneCache.clear();
    
    // Clear content cache
    contentCache.clear();
    
    console.log(`Cleared ${keysToRemove.length} learning journey caches, milestone cache, and content cache`);
  } catch (error) {
    console.warn('Failed to clear learning journey cache:', error);
  }
}

/**
 * Clear cache for a specific learning journey
 */
export function clearSpecificJourneyCache(baseUrl: string): void {
  try {
    const journeyBaseUrl = getLearningJourneyBaseUrl(baseUrl);
    
    // Clear content cache for all URLs related to this journey
    const urlsToRemove: string[] = [];
    contentCache.forEach((_, url) => {
      if (url.startsWith(journeyBaseUrl)) {
        urlsToRemove.push(url);
      }
    });
    
    urlsToRemove.forEach(url => {
      contentCache.delete(url);
    });
    
    // Clear milestone cache for this journey
    milestoneCache.delete(journeyBaseUrl);
    
    // Clear localStorage cache for this journey
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('journey-cache-') && key.includes(encodeURIComponent(journeyBaseUrl))) {
        keysToRemove.push(key);
      }
    }
    
    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
    });
    
    console.log(`Cleared cache for journey: ${journeyBaseUrl} (${urlsToRemove.length} content entries, ${keysToRemove.length} localStorage entries)`);
  } catch (error) {
    console.warn('Failed to clear specific journey cache:', error);
  }
}

/**
 * Find current milestone number from URL
 */
function findCurrentMilestoneFromUrl(url: string, milestones: Milestone[]): number {
  console.log(`Finding milestone for URL: ${url}`);
  console.log(`Available milestones:`, milestones.map(m => ({ number: m.number, url: m.url })));
  
  // First try exact URL match
  for (const milestone of milestones) {
    if (milestone.url === url) {
      console.log(`✅ Exact URL match found: milestone ${milestone.number}`);
      return milestone.number;
    }
  }
  
  // Then try exact match with trailing slash variations
  const urlWithSlash = url.endsWith('/') ? url : url + '/';
  const urlWithoutSlash = url.endsWith('/') ? url.slice(0, -1) : url;
  
  for (const milestone of milestones) {
    if (milestone.url === urlWithSlash || milestone.url === urlWithoutSlash) {
      console.log(`✅ URL match with slash variation found: milestone ${milestone.number}`);
      return milestone.number;
    }
  }
  
  // Then try partial URL match by comparing path segments
  const urlParts = url.replace(/\/$/, '').split('/');
  const currentUrlSegment = urlParts[urlParts.length - 1];
  
  for (const milestone of milestones) {
    const milestoneUrlParts = milestone.url.replace(/\/$/, '').split('/');
    const milestoneUrlSegment = milestoneUrlParts[milestoneUrlParts.length - 1];
    
    if (currentUrlSegment && milestoneUrlSegment && currentUrlSegment === milestoneUrlSegment) {
      console.log(`✅ Path segment match found: milestone ${milestone.number} (${currentUrlSegment})`);
      return milestone.number;
    }
  }
  
  // Fallback to URL pattern matching for known patterns
  console.log(`⚠️ No direct match found, trying pattern matching...`);
  const urlLower = url.toLowerCase();
  
  if (urlLower.includes('business-value') || urlLower.includes('why-')) {
    console.log(`📍 Pattern match: business-value/why -> milestone 1`);
    return 1;
  } else if (urlLower.includes('when-to') || urlLower.includes('install') || urlLower.includes('connect')) {
    console.log(`📍 Pattern match: when-to/install/connect -> milestone 2`);
    return 2;
  } else if (urlLower.includes('verify') || urlLower.includes('configure') || urlLower.includes('test')) {
    console.log(`📍 Pattern match: verify/configure/test -> milestone 3`);
    return 3;
  } else if (urlLower.includes('explore') || urlLower.includes('discover')) {
    console.log(`📍 Pattern match: explore/discover -> milestone 4`);
    return 4;
  } else if (urlLower.includes('create') || urlLower.includes('build')) {
    console.log(`📍 Pattern match: create/build -> milestone 5`);
    return 5;
  } else if (urlLower.includes('import') || urlLower.includes('upload')) {
    console.log(`📍 Pattern match: import/upload -> milestone 6`);
    return 6;
  } else if (urlLower.includes('query') || urlLower.includes('search')) {
    console.log(`📍 Pattern match: query/search -> milestone 7`);
    return 7;
  }
  
  // Last resort: try to extract number from URL
  const milestoneMatch = url.match(/milestone[-_]?(\d+)|step[-_]?(\d+)|(\d+)(?:[-_]|$)/i);
  if (milestoneMatch) {
    const milestoneNum = parseInt(milestoneMatch[1] || milestoneMatch[2] || milestoneMatch[3]);
    if (milestoneNum > 0 && milestoneNum <= milestones.length) {
      console.log(`📍 Number extraction match: milestone ${milestoneNum}`);
      return milestoneNum;
    }
  }
  
  console.log(`❌ No milestone match found, defaulting to milestone 1`);
  return 1;
} 