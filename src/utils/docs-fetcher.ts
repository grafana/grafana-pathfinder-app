import { getDocsBaseUrl, getDocsUsername, getDocsPassword } from '../constants';


export interface LearningJourneyContent {
  title: string;
  content: string;
  url: string;
  currentMilestone: number;
  totalMilestones: number;
  milestones: Milestone[];
  lastFetched: string;
  summary?: string; // Summary extracted from first 3 paragraphs
}

export interface SideJourneyItem {
  link: string;
  title: string;
}

export interface SideJourneys {
  heading: string;
  items: SideJourneyItem[];
}

export interface RelatedJourneyItem {
  link: string;
  title: string;
}

export interface RelatedJourneys {
  heading: string;
  items: RelatedJourneyItem[];
}

export interface ConclusionImage {
  src: string;
  width: number;
  height: number;
}

export interface Milestone {
  number: number;
  title: string;
  duration: string;
  url: string;
  isActive: boolean;
  sideJourneys?: SideJourneys;
  relatedJourneys?: RelatedJourneys;
  conclusionImage?: ConclusionImage;
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
 * Get authentication headers if credentials are provided
 */
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 (compatible; GrafanaLearningJourney/1.0)',
  };
  
  // Authenticate if username is provided (password can be empty)
  if (getDocsUsername()) {
    const credentials = btoa(`${getDocsUsername()}:${getDocsPassword() || ''}`);
    headers['Authorization'] = `Basic ${credentials}`;
    console.log(`🔐 Adding Basic Auth for user: ${getDocsUsername()}`);
  }
  
  return headers;
}

/**
 * Convert a regular docs URL to unstyled.html version for content fetching
 */
function getUnstyledContentUrl(url: string): string {
  // Don't modify index.json URLs
  if (url.endsWith('index.json')) {
    return url;
  }
  
  // Convert relative URLs to absolute URLs first
  let absoluteUrl: string;
  if (url.startsWith('/')) {
    // Relative URL starting with / - prepend base URL
    absoluteUrl = `${getDocsBaseUrl()}${url}`;
  } else if (url.startsWith('http')) {
    // Already absolute URL
    absoluteUrl = url;
  } else {
    // Relative URL without leading slash - prepend base URL with slash
    absoluteUrl = `${getDocsBaseUrl()}/${url}`;
  }
  
  // For learning journey and docs pages, append unstyled.html
  if (absoluteUrl.endsWith('/')) {
    return `${absoluteUrl}unstyled.html`;
  } else {
    return `${absoluteUrl}/unstyled.html`;
  }
}

/**
 * Fetch milestones from JSON endpoint - simplified to only use index.json
 */
async function fetchMilestonesFromJson(baseUrl: string): Promise<Milestone[]> {
  try {
    // Ensure baseUrl is absolute
    const absoluteBaseUrl = baseUrl.startsWith('/') ? `${getDocsBaseUrl()}${baseUrl}` : baseUrl;
    const jsonUrl = `${absoluteBaseUrl}index.json`;
    
    console.log(`Fetching milestones from JSON: ${jsonUrl}`);
    
    const jsonContent = await fetchDirectFast(jsonUrl);
    
    if (!jsonContent || jsonContent.trim().length === 0) {
      throw new Error('Failed to fetch JSON content');
    }
    
    // Parse JSON
    const jsonData = JSON.parse(jsonContent);
    
    if (!Array.isArray(jsonData)) {
      throw new Error('JSON data is not an array');
    }
    
    console.log(`📋 Found ${jsonData.length} items in JSON`);
    
    // Filter items that should be milestones (have step numbers OR are conclusion pages)
    const milestoneItems = jsonData.filter(item => 
      item.params && item.permalink && (
        typeof item.params.step === 'number' || 
        (item.params.cta && item.params.cta.type === 'conclusion')
      )
    );
    
    // Sort by step number if available, otherwise conclusion pages go last
    milestoneItems.sort((a, b) => {
      const stepA = a.params.step || 999;
      const stepB = b.params.step || 999;
      return stepA - stepB;
    });
    
    console.log(`📋 Found ${milestoneItems.length} milestone items in JSON`);
    
    // Create milestones using array index + 1 for consistent numbering
    const milestones: Milestone[] = milestoneItems.map((item, index) => {
      const title = item.params.title || item.params.menutitle || `Step ${index + 1}`;
      const duration = '2-3 min'; // Default duration since JSON doesn't include this
      const milestoneNumber = index + 1;
      
      // Convert relative permalink to absolute URL
      const absoluteUrl = item.permalink.startsWith('/') 
        ? `${getDocsBaseUrl()}${item.permalink}` 
        : item.permalink;
      
      // Extract side_journeys if present
      let sideJourneys: SideJourneys | undefined;
      if (item.params.side_journeys && item.params.side_journeys.items && item.params.side_journeys.items.length > 0) {
        sideJourneys = {
          heading: item.params.side_journeys.heading || 'More to explore (optional)',
          items: item.params.side_journeys.items.map((sideItem: any) => ({
            link: sideItem.link,
            title: sideItem.title
          }))
        };
        console.log(`📍 Added ${sideJourneys.items.length} side journey items for milestone ${milestoneNumber}`);
      }
      
      // Extract related_journeys if present (typically in destination-reached milestone)
      let relatedJourneys: RelatedJourneys | undefined;
      if (item.params.related_journeys && item.params.related_journeys.items && item.params.related_journeys.items.length > 0) {
        relatedJourneys = {
          heading: item.params.related_journeys.heading || 'Related journeys',
          items: item.params.related_journeys.items.map((relatedItem: any) => ({
            link: relatedItem.link,
            title: relatedItem.title
          }))
        };
        console.log(`🔗 Added ${relatedJourneys.items.length} related journey items for milestone ${milestoneNumber}`);
      }
      
      // Extract conclusion image if present (typically in destination-reached milestone)
      let conclusionImage: ConclusionImage | undefined;
      if (item.params.cta && item.params.cta.image && item.params.cta.image.src) {
        const imageSrc = item.params.cta.image.src.startsWith('/') 
          ? `${getDocsBaseUrl()}${item.params.cta.image.src}`
          : item.params.cta.image.src;
          
        conclusionImage = {
          src: imageSrc,
          width: item.params.cta.image.width || 735,
          height: item.params.cta.image.height || 175
        };
        console.log(`🎉 Added conclusion image for milestone ${milestoneNumber}: ${imageSrc}`);
      }
      
      console.log(`📍 Added milestone ${milestoneNumber}: ${title} (${absoluteUrl})`);
      
      return {
        number: milestoneNumber,
        title: title,
        duration: duration,
        url: absoluteUrl, // Convert relative permalink to absolute URL
        isActive: false,
        sideJourneys: sideJourneys,
        relatedJourneys: relatedJourneys,
        conclusionImage: conclusionImage
      };
    });
    
    if (milestones.length === 0) {
      throw new Error('No valid milestones found in JSON data');
    }
    
    console.log(`✅ Successfully extracted ${milestones.length} milestones from JSON`);
    return milestones;
    
  } catch (error) {
    console.error('Failed to fetch milestones from JSON:', error);
    throw error;
  }
}

/**
 * Extract summary from the first 3 paragraphs of the learning journey
 */
function extractJourneySummary(doc: Document): string {
  try {
    // Find the first 3 paragraphs in the document
    const paragraphs = doc.querySelectorAll('p');
    let summaryParts: string[] = [];
    let count = 0;
    
    for (const p of paragraphs) {
      const text = p.textContent?.trim();
      if (text && text.length > 20) { // Skip very short paragraphs
        summaryParts.push(text);
        count++;
        if (count >= 3) {break;}
      }
    }
    
    const summary = summaryParts.join(' ');
    console.log(`📝 Extracted summary (${summary.length} chars): ${summary.substring(0, 100)}...`);
    return summary;
  } catch (error) {
    console.warn('Failed to extract journey summary:', error);
    return '';
  }
}

/**
 * Extract learning journey content from HTML - simplified milestone logic
 */
async function extractLearningJourneyContent(html: string, url: string): Promise<LearningJourneyContent> {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Extract title - look for h1 in the body since there's no wrapper
    const titleElement = doc.querySelector('h1');
    const title = titleElement?.textContent?.trim() || 'Learning Journey';
    
    // Extract summary from first 3 paragraphs (only for cover pages - we'll determine this after milestone detection)
    let isCoverPage = false;
    let summary = '';
    
    // Get the base URL for this learning journey
    const baseUrl = getLearningJourneyBaseUrl(url);
    
    // Check if we have cached milestones
    let milestones = getCachedMilestones(baseUrl);
    let currentMilestone = 0;
    let totalMilestones = 1;
    
    if (!milestones) {
      // Fresh journey start - fetch milestones from JSON
      console.log('Fresh journey start - fetching milestones from JSON');
      
      try {
        milestones = await fetchMilestonesFromJson(baseUrl);
        
        // Cache the milestones for this learning journey
        if (milestones.length > 0) {
          cacheMilestones(baseUrl, milestones);
          console.log(`Cached ${milestones.length} milestones for journey`);
        }
        
        totalMilestones = milestones.length;
        currentMilestone = 0; // Cover page
        
      } catch (error) {
        console.error('Failed to fetch milestones from JSON:', error);
        throw new Error(`Failed to load learning journey milestones: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else {
      // Use cached milestone information
      console.log('Using cached milestone information');
      totalMilestones = milestones.length;
      
      // Determine current milestone from URL
      currentMilestone = findCurrentMilestoneFromUrl(url, milestones);
      
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
        }
      } else {
        console.log(`📍 Current milestone ${currentMilestone} is cover page`);
      }
      
      console.log(`🧭 Navigation state: Current=${currentMilestone}, Total=${totalMilestones}`);
    }
    
    // Now determine if this is a cover page based on milestone detection
    isCoverPage = currentMilestone === 0;
    summary = isCoverPage ? extractJourneySummary(doc) : '';
    
    // Extract main content - work with the entire body since there's no wrapper
    const mainContentResult = extractMainContent(doc, isCoverPage);
    
    // Add conclusion image at the top for destination-reached milestone
    let finalContent = mainContentResult.content;
    if (currentMilestone > 0 && milestones && milestones.length > 0) {
      const currentMilestoneData = milestones.find(m => m.number === currentMilestone);
      
      // Add conclusion image at the top if present
      if (currentMilestoneData?.conclusionImage) {
        console.log(`🎉 Adding conclusion image for milestone ${currentMilestone}`);
        finalContent = addConclusionImageToContent(finalContent, currentMilestoneData.conclusionImage);
      }
      
      // Add side journeys section for milestone pages (not cover pages)
      if (currentMilestoneData?.sideJourneys && currentMilestoneData.sideJourneys.items.length > 0) {
        console.log(`📚 Adding side journeys section for milestone ${currentMilestone}`);
        finalContent = appendSideJourneysToContent(finalContent, currentMilestoneData.sideJourneys);
      }
      
      // Add related journeys section (typically for destination-reached milestone)
      if (currentMilestoneData?.relatedJourneys && currentMilestoneData.relatedJourneys.items.length > 0) {
        console.log(`🔗 Adding related journeys section for milestone ${currentMilestone}`);
        finalContent = appendRelatedJourneysToContent(finalContent, currentMilestoneData.relatedJourneys);
      }
      
      // Add bottom navigation for milestone pages
      console.log(`🧭 Adding bottom navigation for milestone ${currentMilestone}`);
      finalContent = appendBottomNavigationToContent(finalContent, currentMilestone, totalMilestones);
    }
    
    return {
      title,
      content: finalContent,
      url,
      currentMilestone,
      totalMilestones,
      milestones,
      lastFetched: new Date().toISOString(),
      summary
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
      lastFetched: new Date().toISOString(),
    };
  }
}

/**
 * Extract main content from learning journey HTML - work with entire body
 */
function extractMainContent(doc: Document, isCoverPage: boolean): { content: string; } {
  // Work with the entire body since there's no wrapper container
  const bodyElement = doc.body;
  
  if (!bodyElement) {
    return {
      content: 'Content not available - document body not found',
    };
  }
  
  // Process the content directly from body
  const processedContent = processLearningJourneyContent(bodyElement, isCoverPage);
  return processedContent;
}

/**
 * Process learning journey content for better display - updated for new structure
 */
function processLearningJourneyContent(element: Element, isCoverPage: boolean): { content: string; } {
  const clonedElement = element.cloneNode(true) as Element;
  
  
  // Process images - handle data-src attributes from new structure
  const images = clonedElement.querySelectorAll('img');
  images.forEach(img => {
    const src = img.getAttribute('src');
    const dataSrc = img.getAttribute('data-src');
    const originalSrc = dataSrc || src;
    
    if (!originalSrc) {return;}
    
    // Fix relative URLs - be careful not to double up base URLs
    let newSrc: string;
    if (originalSrc.startsWith('http') || originalSrc.startsWith('data:')) {
      // Already a complete URL
      newSrc = originalSrc;
    } else if (originalSrc.startsWith('/')) {
      // Absolute path - add base URL
      newSrc = `${getDocsBaseUrl()}${originalSrc}`;
    } else {
      // Relative path - add base URL with slash
      newSrc = `${getDocsBaseUrl()}/${originalSrc}`;
    }
    
    // Set the correct src and remove data-src
    img.setAttribute('src', newSrc);
    img.removeAttribute('data-src');
    
    // Remove lazy loading classes that won't work in our context
    img.classList.remove('lazyload', 'lazyloaded', 'ls-is-cached');
    img.classList.add('journey-image');
    img.setAttribute('loading', 'lazy');
    
    // Add alt text if missing
    if (!img.getAttribute('alt')) {
      img.setAttribute('alt', 'Learning journey image');
    }
  });

  // Process iframes - make them responsive like images
  const iframes = clonedElement.querySelectorAll('iframe');
  iframes.forEach(iframe => {
    iframe.classList.add('journey-iframe');
    
    // For YouTube and other video embeds, maintain aspect ratio and make responsive
    const src = iframe.getAttribute('src');
    const isYouTube = src && (src.includes('youtube.com') || src.includes('youtu.be'));
    const isVideo = isYouTube || (src && src.includes('vimeo.com'));
    
    if (isVideo) {
      iframe.classList.add('journey-video-iframe');
      
      // Create a responsive wrapper for video iframes
      const wrapper = document.createElement('div');
      wrapper.className = 'journey-iframe-wrapper journey-video-wrapper';
      
      // Insert wrapper before iframe and move iframe into wrapper
      iframe.parentNode?.insertBefore(wrapper, iframe);
      wrapper.appendChild(iframe);
      
      // Remove fixed width/height attributes to make it responsive
      iframe.removeAttribute('width');
      iframe.removeAttribute('height');
      
      console.log(`📺 Made ${isYouTube ? 'YouTube' : 'video'} iframe responsive`);
    } else {
      // For non-video iframes, just make them responsive
      iframe.classList.add('journey-general-iframe');
      
      // Remove fixed width if it exists and let CSS handle responsiveness
      const width = iframe.getAttribute('width');
      if (width) {
        iframe.removeAttribute('width');
        iframe.style.width = '100%';
        iframe.style.maxWidth = '100%';
      }
      
      console.log('📄 Made general iframe responsive');
    }
    
    // Ensure iframe has a title for accessibility
    if (!iframe.getAttribute('title')) {
      if (isYouTube) {
        iframe.setAttribute('title', 'YouTube video player');
      } else if (src && src.includes('vimeo.com')) {
        iframe.setAttribute('title', 'Vimeo video player');
      } else {
        iframe.setAttribute('title', 'Embedded content');
      }
    }
  });
  
  // Process links to ensure they open in new tabs
  const links = clonedElement.querySelectorAll('a[href]');
  links.forEach(link => {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    link.setAttribute('data-journey-link', 'true');
  });
  
  // Process admonitions (notes, warnings, etc.) from new structure
  const admonitions = clonedElement.querySelectorAll('.admonition');
  admonitions.forEach(admonition => {
    // Add consistent classes for styling
    admonition.classList.add('journey-admonition');
    
    // Find and style the title
    const title = admonition.querySelector('.title, p.title');
    if (title) {
      title.classList.add('admonition-title');
    }
  });
  
  // Handle code blocks and inline code
  const codeElements = clonedElement.querySelectorAll('code');
  codeElements.forEach(code => {
    // If it's not inside a pre element, it's inline code
    if (!code.closest('pre')) {
      code.classList.add('journey-inline-code');
    }
  });
  
  // Handle pre/code blocks - add classes for styling and copy functionality
  const preElements = clonedElement.querySelectorAll('pre');
  preElements.forEach(pre => {
    pre.classList.add('journey-code-block');
    // Ensure relative positioning for copy button
    (pre as HTMLElement).style.position = 'relative';
  });
  
  // Handle tables - add responsive wrapper if not already present
  const tables = clonedElement.querySelectorAll('table');
  tables.forEach(table => {
    // Don't wrap if already in a responsive wrapper
    if (!table.closest('.responsive-table-wrapper')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'responsive-table-wrapper';
      table.parentNode?.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    }
    
    table.classList.add('journey-table');
  });
  
  // Process headings to add consistent classes
  const headings = clonedElement.querySelectorAll('h1, h2, h3, h4, h5, h6');
  headings.forEach(heading => {
    heading.classList.add('journey-heading');
    heading.classList.add(`journey-heading-${heading.tagName.toLowerCase()}`);
  });
  
  // Process lists
  const lists = clonedElement.querySelectorAll('ul, ol');
  lists.forEach(list => {
    list.classList.add('journey-list');
  });
  
  // Process paragraphs
  const paragraphs = clonedElement.querySelectorAll('p');
  paragraphs.forEach(p => {
    p.classList.add('journey-paragraph');
  });
  
  // Process collapsible sections - replace Alpine.js functionality
  const collapsibleSections = clonedElement.querySelectorAll('.collapse[x-data]');
  collapsibleSections.forEach((section, index) => {
    // Remove Alpine.js attributes
    section.removeAttribute('x-data');
    section.classList.add('journey-collapse');
    section.setAttribute('data-collapse-id', `collapse-${index}`);
    
    // Process the trigger button
    const trigger = section.querySelector('.collapse-trigger');
    if (trigger) {
      trigger.removeAttribute('@click');
      trigger.classList.add('journey-collapse-trigger');
      trigger.setAttribute('data-collapse-target', `collapse-${index}`);
      
      // Process the icon if it exists
      const icon = trigger.querySelector('.collapse-trigger__icon');
      if (icon) {
        icon.removeAttribute(':class');
        icon.classList.add('journey-collapse-icon');
      }
    }
    
    // Process the content area
    const content = section.querySelector('.collapse-content');
    if (content) {
      content.removeAttribute('x-ref');
      content.removeAttribute('hidden');
      content.classList.add('journey-collapse-content');
      content.setAttribute('data-collapse-id', `collapse-${index}`);
      
      // Process the inner content
      const contentInner = content.querySelector('.collapse-content__inner');
      if (contentInner) {
        contentInner.removeAttribute('x-ref');
        contentInner.classList.add('journey-collapse-content-inner');
      }
      
      // Initially hide the content (collapsed by default)
      (content as HTMLElement).style.display = 'none';
    }
    
    console.log(`📁 Processed collapsible section ${index + 1}`);
  });
  
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
  
  return {
    content: clonedElement.innerHTML
  };
}


/**
 * Fetch learning journey content with multiple strategies
 */
export async function fetchLearningJourneyContent(url: string): Promise<LearningJourneyContent | null> {
  console.log(`Fetching learning journey content from: ${url}`);
  
  // Use unstyled.html version for content fetching
  const unstyledUrl = getUnstyledContentUrl(url);
  console.log(`Using unstyled URL: ${unstyledUrl}`);
  
  // Check cache first (use original URL as cache key)
  const cached = contentCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log('Returning cached content for:', url);
    return cached.content;
  }
  
  // Check if this looks like a cover page vs milestone page
  const isCoverPageUrl = url.endsWith('/') && !url.includes('/business-value') && !url.includes('/when-to') && !url.includes('/verify');
  console.log(`URL appears to be cover page: ${isCoverPageUrl}`);
  
  // Try direct fetch - first try the unstyled URL, then with trailing slash if needed
  let htmlContent: string | null = null;
  
  try {
    console.log('Trying direct fetch...');
    const startTime = Date.now();
    htmlContent = await fetchDirectFast(unstyledUrl);
    const duration = Date.now() - startTime;
    
    if (htmlContent && htmlContent.trim().length > 0) {
      console.log(`✅ Direct fetch succeeded in ${duration}ms, content length: ${htmlContent.length}`);
    } else {
      console.warn(`❌ Direct fetch returned empty content after ${duration}ms`);
      htmlContent = null;
    }
  } catch (error) {
    console.warn(`❌ Direct fetch failed:`, error);
    htmlContent = null;
  }
  
  // For milestone pages, also try adding trailing slash if missing and first attempt failed
  if (!htmlContent && !isCoverPageUrl && !url.endsWith('/')) {
    const urlWithSlash = url + '/';
    const unstyledUrlWithSlash = getUnstyledContentUrl(urlWithSlash);
    console.log(`Trying milestone URL with trailing slash: ${unstyledUrlWithSlash}`);
    
    try {
      const startTime = Date.now();
      htmlContent = await fetchDirectFast(unstyledUrlWithSlash);
      const duration = Date.now() - startTime;
      
      if (htmlContent && htmlContent.trim().length > 0) {
        console.log(`✅ Direct fetch with slash succeeded in ${duration}ms, content length: ${htmlContent.length}`);
      } else {
        console.warn(`❌ Direct fetch with slash returned empty content after ${duration}ms`);
        htmlContent = null;
      }
    } catch (error) {
      console.warn(`❌ Direct fetch with slash failed:`, error);
      htmlContent = null;
    }
  }
  
  if (!htmlContent) {
    console.error('Direct fetch failed for URL:', url);
    return null;
  }
  
  // Extract content
  const content = await extractLearningJourneyContent(htmlContent, url); // Use original URL for content
  console.log(`Extracted content: ${content.title}, milestones: ${content.milestones.length}`);
  
  // Cache the result (use original URL as cache key)
  contentCache.set(url, { content, timestamp: Date.now() });
  
  return content;
}

/**
 * Try direct fetch (faster version)
 */
async function fetchDirectFast(url: string): Promise<string | null> {
  try {
    console.log('Trying direct fetch...');
    
    const headers = getAuthHeaders();
    
    // For authenticated requests, we might need additional CORS handling
    const fetchOptions: RequestInit = {
      method: 'GET',
      headers: headers,
      signal: AbortSignal.timeout(5000), // 5 second timeout
    };
    
    // If we have authentication, try with credentials and explicit CORS mode
    if (getDocsUsername()) {
      fetchOptions.mode = 'cors';
      fetchOptions.credentials = 'omit'; // Don't send cookies, use explicit auth headers
      console.log('🔐 Using authenticated direct fetch');
    } else {
      fetchOptions.mode = 'cors';
      console.log('📂 Using non-authenticated direct fetch');
    }
    
    const response = await fetch(url, fetchOptions);
    
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
 * Clear content cache for a specific learning journey but preserve milestone cache
 * This is used when closing tabs to avoid breaking URL-to-milestone matching
 */
export function clearSpecificJourneyContentCache(baseUrl: string): void {
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
    
    // DON'T clear milestone cache - preserve it for URL-to-milestone matching
    // milestoneCache.delete(journeyBaseUrl); // REMOVED
    
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
    
    console.log(`Cleared content cache for journey (preserving milestones): ${journeyBaseUrl} (${urlsToRemove.length} content entries, ${keysToRemove.length} localStorage entries)`);
  } catch (error) {
    console.warn('Failed to clear specific journey content cache:', error);
  }
}

/**
 * Find current milestone number from URL - improved matching
 */
function findCurrentMilestoneFromUrl(url: string, milestones: Milestone[]): number {
  console.log(`Finding milestone for URL: ${url}`);
  console.log(`Available milestones:`, milestones.map(m => ({ number: m.number, url: m.url })));
  
  // Try exact URL match (with and without trailing slash)
  const urlWithSlash = url.endsWith('/') ? url : url + '/';
  const urlWithoutSlash = url.endsWith('/') ? url.slice(0, -1) : url;
  
  for (const milestone of milestones) {
    const milestoneWithSlash = milestone.url.endsWith('/') ? milestone.url : milestone.url + '/';
    const milestoneWithoutSlash = milestone.url.endsWith('/') ? milestone.url.slice(0, -1) : milestone.url;
    
    if (url === milestone.url || 
        url === milestoneWithSlash || 
        url === milestoneWithoutSlash ||
        urlWithSlash === milestone.url ||
        urlWithSlash === milestoneWithSlash ||
        urlWithoutSlash === milestone.url ||
        urlWithoutSlash === milestoneWithoutSlash) {
      console.log(`✅ URL match found: milestone ${milestone.number} (${milestone.url})`);
      return milestone.number;
    }
  }
  
  // Check if this URL looks like a journey base URL (cover page)
  const baseUrl = getLearningJourneyBaseUrl(url);
  if (url === baseUrl || url + '/' === baseUrl || url === baseUrl + '/') {
    console.log(`✅ Cover page detected for base URL: ${baseUrl}`);
    return 0;
  }
  
  console.log(`❌ No milestone match found for URL: ${url}`);
  console.log(`❌ Base URL: ${baseUrl}`);
  console.log(`❌ Defaulting to cover page (milestone 0)`);
  return 0; // Default to cover page instead of milestone 1
}

function appendSideJourneysToContent(content: string, sideJourneys: SideJourneys): string {
  // Create a collapsible milestone-style side journeys section
  const sideJourneysHtml = `
    <div class="journey-side-journeys-section">
      <div class="journey-collapse journey-side-journeys-collapse" data-collapse-id="side-journeys">
        <button class="journey-collapse-trigger journey-side-journeys-trigger" data-collapse-target="side-journeys">
          <span class="journey-side-journeys-title">${sideJourneys.heading}</span>
          <div class="collapse-trigger__icon journey-collapse-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6,9 12,15 18,9"></polyline>
            </svg>
          </div>
        </button>
        <div class="journey-collapse-content journey-side-journeys-content" data-collapse-id="side-journeys" style="display: none;">
          <div class="journey-side-journeys-list">
            ${sideJourneys.items.map((item, index) => {
              // Determine icon based on URL type
              let iconSvg = '';
              let typeLabel = 'External';
              
              if (item.link.includes('youtube.com') || item.link.includes('youtu.be')) {
                // Video icon
                iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="5,3 19,12 5,21"></polygon>
                </svg>`;
                typeLabel = 'Video';
              } else {
                // Document icon
                iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14,2 14,8 20,8"></polyline>
                </svg>`;
                typeLabel = 'External';
              }
              
              return `
                <a href="#" 
                   class="journey-side-journey-item"
                   data-side-journey-link="true"
                   data-side-journey-url="${item.link}"
                   data-side-journey-title="${item.title}">
                  <div class="journey-side-journey-icon-circle">
                    ${iconSvg}
                  </div>
                  <div class="journey-side-journey-content">
                    <div class="journey-side-journey-title">${item.title}</div>
                    <div class="journey-side-journey-type">${typeLabel}</div>
                  </div>
                  <div class="journey-side-journey-external-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15,3 21,3 21,9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                  </div>
                </a>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
  
  return content + sideJourneysHtml;
}

function appendRelatedJourneysToContent(content: string, relatedJourneys: RelatedJourneys): string {
  // Create a collapsible related journeys section
  const relatedJourneysHtml = `
    <div class="journey-related-journeys-section">
      <div class="journey-collapse journey-related-journeys-collapse" data-collapse-id="related-journeys">
        <button class="journey-collapse-trigger journey-related-journeys-trigger" data-collapse-target="related-journeys">
          <span class="journey-related-journeys-title">${relatedJourneys.heading}</span>
          <div class="collapse-trigger__icon journey-collapse-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6,9 12,15 18,9"></polyline>
            </svg>
          </div>
        </button>
        <div class="journey-collapse-content journey-related-journeys-content" data-collapse-id="related-journeys" style="display: none;">
          <div class="journey-related-journeys-list">
            ${relatedJourneys.items.map((item, index) => {
              // Use document icon for all external links
              const iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14,2 14,8 20,8"></polyline>
              </svg>`;
              
              return `
                <a href="#" 
                   class="journey-related-journey-item"
                   data-related-journey-link="true"
                   data-related-journey-url="${item.link}"
                   data-related-journey-title="${item.title}">
                  <div class="journey-related-journey-icon-circle">
                    ${iconSvg}
                  </div>
                  <div class="journey-related-journey-content">
                    <div class="journey-related-journey-title">${item.title}</div>
                  </div>
                </a>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
  
  return content + relatedJourneysHtml;
}

function addConclusionImageToContent(content: string, conclusionImage: ConclusionImage): string {
  // Create conclusion image HTML to prepend at the top
  const conclusionImageHtml = `
    <div class="journey-conclusion-image">
      <img src="${conclusionImage.src}" 
           alt="Journey Complete" 
           width="${conclusionImage.width}" 
           height="${conclusionImage.height}"
           class="journey-conclusion-header" />
    </div>
  `;
  
  return conclusionImageHtml + content;
} 

/**
 * Add bottom navigation to content
 */
function appendBottomNavigationToContent(content: string, currentMilestone: number, totalMilestones: number): string {
  const hasPrevious = currentMilestone > 1;
  const hasNext = currentMilestone < totalMilestones;
  
  const bottomNavigationHtml = `
    <div class="journey-bottom-navigation">
      <div class="journey-bottom-navigation-content">
        <button class="journey-bottom-nav-button" 
                data-bottom-nav="previous"
                style="opacity: ${hasPrevious ? '1' : '0.5'}; visibility: ${hasPrevious ? 'visible' : 'hidden'};"
                ${!hasPrevious ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15,18 9,12 15,6"></polyline>
          </svg>
          <span>Previous</span>
        </button>
        
        <div class="journey-bottom-nav-info">
          <span class="journey-bottom-nav-milestone">
            Milestone ${currentMilestone} of ${totalMilestones}
          </span>
        </div>
        
        <button class="journey-bottom-nav-button" 
                data-bottom-nav="next"
                style="opacity: ${hasNext ? '1' : '0.5'}; visibility: ${hasNext ? 'visible' : 'hidden'};"
                ${!hasNext ? 'disabled' : ''}>
          <span>Next</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9,18 15,12 9,6"></polyline>
          </svg>
        </button>
      </div>
    </div>
  `;
  
  return content + bottomNavigationHtml;
}
