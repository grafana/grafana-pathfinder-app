// Unified content fetcher - replaces docs-fetcher.ts and single-docs-fetcher.ts
// This version ONLY fetches content and extracts basic metadata
// All DOM processing is moved to React components
import { 
  RawContent, 
  ContentFetchResult, 
  ContentFetchOptions, 
  ContentType,
  ContentMetadata,
  LearningJourneyMetadata,
  SingleDocMetadata,
  Milestone
} from './content.types';

/**
 * Main unified content fetcher
 * Determines content type and fetches accordingly
 */
export async function fetchContent(url: string, options: ContentFetchOptions = {}): Promise<ContentFetchResult> {
  try {
    // Validate URL
    if (!url || typeof url !== 'string' || url.trim() === '') {
      console.error('fetchContent called with invalid URL:', url);
      return { content: null, error: 'Invalid URL provided' };
    }

    // Determine content type based on URL patterns
    const contentType = determineContentType(url);
    
    // Parse hash fragment from URL
    const hashFragment = parseHashFragment(url);
    const cleanUrl = removeHashFragment(url);
    
    // Fetch raw HTML
    const html = await fetchRawHtml(cleanUrl, options);
    if (!html) {
      return { content: null, error: 'Failed to fetch content' };
    }

    // Extract basic metadata without DOM processing
    const metadata = await extractMetadata(html, cleanUrl, contentType);
    
    // Create unified content object
    const content: RawContent = {
      html,
      metadata,
      type: contentType,
      url: cleanUrl,
      lastFetched: new Date().toISOString(),
      hashFragment,
    };

    return { content };
  } catch (error) {
    console.error(`Failed to fetch content from ${url}:`, error);
    return { 
      content: null, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Determine content type based on URL patterns
 */
function determineContentType(url: string): ContentType {
  // Handle undefined or empty URL
  if (!url || typeof url !== 'string') {
    console.warn('determineContentType called with invalid URL:', url);
    return 'single-doc';
  }
  
  // Learning journeys typically have specific URL patterns
  if (url.includes('/learning-journeys/') || 
      url.includes('r-grafana') || // specific pattern from existing code
      url.includes('prometheus-datasource') ||
      url.match(/\/milestone-\d+/)) {
    return 'learning-journey';
  }
  
  return 'single-doc';
}

/**
 * Parse and remove hash fragment from URL
 */
function parseHashFragment(url: string): string | undefined {
  const hashIndex = url.indexOf('#');
  if (hashIndex >= 0) {
    return url.substring(hashIndex + 1);
  }
  return undefined;
}

function removeHashFragment(url: string): string {
  const hashIndex = url.indexOf('#');
  if (hashIndex >= 0) {
    return url.substring(0, hashIndex);
  }
  return url;
}

/**
 * Fetch raw HTML content using multiple strategies
 * Combines logic from both existing fetchers
 */
async function fetchRawHtml(url: string, options: ContentFetchOptions): Promise<string | null> {
  const { useAuth = true, headers = {}, timeout = 10000 } = options;
  
  // Build fetch options
  const fetchOptions: RequestInit = {
    method: 'GET',
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      ...headers,
    },
    signal: AbortSignal.timeout(timeout),
  };

  // Add auth headers if requested (from existing code)
  if (useAuth) {
    const authHeaders = getAuthHeaders();
    fetchOptions.headers = { ...fetchOptions.headers, ...authHeaders };
  }

  // Try multiple URL variations (from existing code)
  const urlVariations = generateUrlVariations(url);
  
  for (const testUrl of urlVariations) {
    try {
      const response = await fetch(testUrl, fetchOptions);
      
      if (response.ok) {
        const html = await response.text();
        if (html && html.trim()) {
          return html;
        }
      }
    } catch (error) {
      console.warn(`Failed to fetch from ${testUrl}:`, error);
      // Continue to next URL variation
    }
  }

  return null;
}

/**
 * Generate URL variations to try (from existing fetchers)
 * Prioritize unstyled.html versions for cleaner content
 */
function generateUrlVariations(url: string): string[] {
  const variations: string[] = [];
  
  // For Grafana docs URLs, try /unstyled.html version FIRST (cleaner content)
  if (url.includes('grafana.com/docs/')) {
    const unstyledUrl = getUnstyledContentUrl(url);
    variations.push(unstyledUrl);
    
    // Original URL as fallback
    if (unstyledUrl !== url) {
      variations.push(url);
    }
  } else {
    // Original URL first for non-Grafana docs
    variations.push(url);
  }
  
  // For GitHub raw content, try with different refs
  if (url.includes('github.com') || url.includes('raw.githubusercontent.com')) {
    if (!url.includes('/unstyled.html')) {
      variations.push(`${url}/unstyled.html`);
    }
  }
  
  return variations;
}

/**
 * Get unstyled content URL (from single-docs-fetcher)
 */
function getUnstyledContentUrl(url: string): string {
  if (url.includes('/unstyled.html')) {
    return url;
  }
  
  const baseUrl = url.split('?')[0].split('#')[0];
  const hasTrailingSlash = baseUrl.endsWith('/');
  
  return hasTrailingSlash 
    ? `${baseUrl}unstyled.html`
    : `${baseUrl}/unstyled.html`;
}

/**
 * Get auth headers (from existing code)
 */
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  
  // Add any authentication headers needed
  // This is a simplified version - expand as needed
  const token = localStorage.getItem('grafana-auth-token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
}

/**
 * Extract metadata from HTML without DOM processing
 * Uses simple string parsing instead of DOM manipulation
 */
async function extractMetadata(html: string, url: string, contentType: ContentType): Promise<ContentMetadata> {
  const title = extractTitle(html);
  
  if (contentType === 'learning-journey') {
    const learningJourney = await extractLearningJourneyMetadata(html, url);
    return { title, learningJourney };
  } else {
    const singleDoc = extractSingleDocMetadata(html);
    return { title, singleDoc };
  }
}

/**
 * Extract page title using simple string parsing
 */
function extractTitle(html: string): string {
  // Try multiple title extraction strategies
  const titlePatterns = [
    /<title[^>]*>([^<]+)<\/title>/i,
    /<h1[^>]*>([^<]+)<\/h1>/i,
    /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i,
  ];

  for (const pattern of titlePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return 'Documentation';
}

/**
 * Extract learning journey metadata using simple parsing
 * Replaces complex DOM processing with string-based extraction
 */
async function extractLearningJourneyMetadata(html: string, url: string): Promise<LearningJourneyMetadata> {
  const baseUrl = getLearningJourneyBaseUrl(url);
  
  // Extract milestones from index.json metadata file
  const milestones = await fetchLearningJourneyMetadataFromJson(baseUrl);
  const currentMilestone = findCurrentMilestoneFromUrl(url, milestones);
  
  // Extract summary from first few paragraphs (simple string matching)
  const summary = extractJourneySummary(html);

  return {
    currentMilestone,
    totalMilestones: milestones.length,
    milestones,
    baseUrl,
    summary,
  };
}

/**
 * Extract single doc metadata
 */
function extractSingleDocMetadata(html: string): SingleDocMetadata {
  // Check for interactive elements (simple string search)
  const hasInteractiveElements = html.includes('data-targetaction') || 
                                 html.includes('class="interactive"');
  
  // Extract summary from meta description or first paragraph
  const summary = extractDocSummary(html);
  
  return {
    hasInteractiveElements,
    summary,
  };
}

/**
 * Simple summary extraction using string parsing
 */
function extractJourneySummary(html: string): string {
  // Look for first few paragraphs
  const paragraphMatches = html.match(/<p[^>]*>(.*?)<\/p>/gi);
  if (paragraphMatches && paragraphMatches.length > 0) {
    const firstParagraphs = paragraphMatches.slice(0, 3);
    const text = firstParagraphs
      .map(p => p.replace(/<[^>]+>/g, '').trim())
      .join(' ')
      .substring(0, 300);
    
    return text + (text.length >= 300 ? '...' : '');
  }
  
  return '';
}

function extractDocSummary(html: string): string {
  // Try meta description first
  const metaMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);
  if (metaMatch && metaMatch[1]) {
    return metaMatch[1];
  }
  
  // Fallback to first paragraph
  const paragraphMatch = html.match(/<p[^>]*>(.*?)<\/p>/i);
  if (paragraphMatch && paragraphMatch[1]) {
    return paragraphMatch[1].replace(/<[^>]+>/g, '').trim().substring(0, 200);
  }
  
  return '';
}

/**
 * Learning journey specific functions
 * These are simplified versions that focus on data extraction only
 */
function getLearningJourneyBaseUrl(url: string): string {
  // Extract base URL for learning journey
  return url.replace(/\/milestone-\d+.*$/, '').replace(/\/$/, '');
}

async function fetchLearningJourneyMetadataFromJson(baseUrl: string): Promise<Milestone[]> {
  try {
    const indexJsonUrl = `${baseUrl}/index.json`;
    const response = await fetch(indexJsonUrl);
    
    if (response.ok) {
      const data = await response.json();
      
      // The actual structure is an array of Hugo/Jekyll page objects
      if (Array.isArray(data)) {
        const milestones = data.map((item, index) => {
          // Transform Hugo/Jekyll structure to our Milestone format
          const milestone: Milestone = {
            number: item.params?.step || index + 1,
            title: item.params?.title || item.params?.menutitle || `Step ${index + 1}`,
            duration: '5-10 min', // Default duration as it's not in the data
            url: `https://grafana.com${item.permalink || item.params?.permalink || ''}`,
            isActive: false,
          };
          
          // Add optional fields if they exist
          if (item.params?.side_journeys) {
            milestone.sideJourneys = item.params.side_journeys;
          }
          
          if (item.params?.related_journeys) {
            milestone.relatedJourneys = item.params.related_journeys;
          }
          
          if (item.params?.cta?.image) {
            milestone.conclusionImage = {
              src: `https://grafana.com${item.params.cta.image.src}`,
              width: item.params.cta.image.width,
              height: item.params.cta.image.height,
            };
          }
          
          return milestone;
                }).sort((a, b) => a.number - b.number); // Sort by step number
        
        return milestones;
      }
    } else {
      console.warn(`Failed to fetch metadata (${response.status}): ${indexJsonUrl}`);
    }
  } catch (error) {
    console.warn(`Failed to fetch learning journey metadata from ${baseUrl}/index.json:`, error);
  }
  
  return [];
}

function findCurrentMilestoneFromUrl(url: string, milestones: Milestone[]): number {
  // Simple URL-based milestone detection
  const milestoneMatch = url.match(/\/milestone-(\d+)/);
  if (milestoneMatch) {
    return parseInt(milestoneMatch[1], 10);
  }
  
  // Check if URL matches any milestone URL
  const matchingMilestone = milestones.find(m => m.url === url);
  return matchingMilestone ? matchingMilestone.number : 0;
}

 
