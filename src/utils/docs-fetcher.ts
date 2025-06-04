export interface LearningJourneyContent {
  title: string;
  content: string;
  url: string;
  currentMilestone: number;
  totalMilestones: number;
  milestones: Milestone[];
  lastFetched: string;
  videoUrl?: string; // YouTube video URL for this page
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
    const mainContentResult = extractMainContent(doc, currentMilestone === 0);
    
    return {
      title,
      content: mainContentResult.content,
      url,
      currentMilestone,
      totalMilestones,
      milestones,
      lastFetched: new Date().toISOString(),
      videoUrl: mainContentResult.videoUrl
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
function extractMainContent(doc: Document, isCoverPage: boolean): { content: string; videoUrl?: string } {
  // Find the main content section
  const contentElement = doc.querySelector('.journey-grid__content');
  
  if (!contentElement) {
    return {
      content: 'Content not available - journey-grid__content section not found'
    };
  }
  
  // Process the content
  const processedContent = processLearningJourneyContent(contentElement, isCoverPage);
  return processedContent;
}

/**
 * Process learning journey content for better display
 */
function processLearningJourneyContent(element: Element, isCoverPage: boolean): { content: string; videoUrl?: string } {
  const clonedElement = element.cloneNode(true) as Element;
  let extractedVideoUrl: string | undefined;
  
  // Remove unwanted navigation elements
  const unwantedElements = clonedElement.querySelectorAll(
    '.journey-pagination__grid, .milestone-bottom'
  );
  unwantedElements.forEach(el => el.remove());
  
  // First, scan ALL video-related buttons/elements before removing any
  console.log('🔍 Scanning for all video elements...');
  
  // Scan for youtube-lazyload buttons (highest priority)
  const lazyloadButtons = clonedElement.querySelectorAll('.youtube-lazyload, .responsive-video');
  console.log(`Found ${lazyloadButtons.length} youtube-lazyload/responsive-video buttons`);
  
  lazyloadButtons.forEach((button, index) => {
    const videoId = button.getAttribute('data-embed');
    const dataUrl = button.getAttribute('data-url');
    const dataTitle = button.getAttribute('data-title');
    const clickHandler = button.getAttribute('@click');
    const classes = button.className;
    
    console.log(`🎥 Button ${index + 1}:`, {
      classes,
      videoId,
      dataUrl,
      dataTitle,
      clickHandler,
      hasExtractedVideo: !!extractedVideoUrl
    });
    
    if (videoId && !extractedVideoUrl) {
      let finalVideoUrl = '';
      
      if (dataUrl) {
        console.log(`🎥 Processing data-url: ${dataUrl}`);
        finalVideoUrl = convertEmbedToWatchUrl(dataUrl);
      } else {
        finalVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      }
      
      // Check for timing parameters in other places
      // 1. Look for timing in surrounding text/attributes
      const timingFromText = extractTimingFromContext(button);
      
      // 2. Look for timing in modal ID or click handler
      const timingFromModal = extractTimingFromModal(clickHandler);
      
      // 3. Check for timing in sibling elements or parent context
      const timingFromSiblings = extractTimingFromSiblings(button);
      
      const timing = timingFromText || timingFromModal || timingFromSiblings;
      
      if (timing) {
        finalVideoUrl += finalVideoUrl.includes('?') ? `&t=${timing}` : `?t=${timing}`;
        console.log(`⏰ Added timing from context: ${timing}s -> ${finalVideoUrl}`);
      }
      
      extractedVideoUrl = finalVideoUrl;
      console.log(`🎥 Final video URL: ${extractedVideoUrl}`);
    }
  });

  // Extract and remove video containers
  const videoContainers = clonedElement.querySelectorAll('.docs-video__trigger');
  videoContainers.forEach(container => {
    const button = container.querySelector('button[data-embed]');
    
    if (button) {
      const videoId = button.getAttribute('data-embed');
      const dataUrl = button.getAttribute('data-url'); // Full YouTube URL with parameters
      
      if (videoId && !extractedVideoUrl) {
        // Check if we have a full URL with parameters first
        if (dataUrl) {
          console.log(`🎥 Found data-url: ${dataUrl}`);
          // Convert embed URL to watch URL while preserving timing parameters
          extractedVideoUrl = convertEmbedToWatchUrl(dataUrl);
          console.log(`🎥 Converted to watch URL: ${extractedVideoUrl}`);
        } else {
          // Fallback to basic video ID
          extractedVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;
          console.log(`🎥 Extracted basic video URL: ${extractedVideoUrl}`);
        }
      }
    }
    
    // Remove the entire video container from content
    container.remove();
  });

  // Now remove all video-related elements
  const videoButtons = clonedElement.querySelectorAll('button[data-embed], .youtube-lazyload, .responsive-video');
  console.log(`🗑️ Removing ${videoButtons.length} video buttons`);
  videoButtons.forEach(button => button.remove());
  
  // Extract and remove "Watch video" modal buttons
  const modalVideoButtons = clonedElement.querySelectorAll(
    'button.btn--empty, button[class*="btn--empty"], button[class*="text-action-blue"]'
  );
  modalVideoButtons.forEach(button => {
    const buttonText = button.textContent?.toLowerCase() || '';
    const clickHandler = button.getAttribute('@click') || button.getAttribute('onclick') || '';
    
    // Check if this is a video button
    if (buttonText.includes('watch video') || buttonText.includes('video')) {
      console.log(`🎥 Found modal video button: "${buttonText}"`);
      
      // Try to extract video ID from modal handler like @click="open_modal('journey-modal-_ojYThjkpN0')"
      const modalMatch = clickHandler.match(/open_modal\(['"]journey-modal-([^'"]+)['"]\)/);
      if (modalMatch && modalMatch[1] && !extractedVideoUrl) {
        const potentialVideoId = modalMatch[1];
        // Check if this looks like a YouTube video ID (typically 11 characters)
        if (potentialVideoId.length >= 10 && potentialVideoId.match(/^[a-zA-Z0-9_-]+$/)) {
          extractedVideoUrl = `https://www.youtube.com/watch?v=${potentialVideoId}`;
          console.log(`🎥 Extracted video URL from modal: ${extractedVideoUrl}`);
        }
      }
      
      // Remove the button regardless of whether we extracted a video
      button.remove();
      console.log(`🗑️ Removed modal video button`);
    }
  });
  
  // Also remove any remaining buttons containing "Watch video" text (fallback)
  const allButtons = clonedElement.querySelectorAll('button');
  allButtons.forEach(button => {
    const buttonText = button.textContent?.toLowerCase() || '';
    if (buttonText.includes('watch video')) {
      console.log(`🎥 Found additional video button: "${buttonText}"`);
      button.remove();
      console.log(`🗑️ Removed additional video button`);
    }
  });
  
  // Remove any standalone "Watch video" links and extract URLs
  const links = clonedElement.querySelectorAll('a[href]');
  links.forEach(link => {
    const href = link.getAttribute('href');
    const linkText = link.textContent?.toLowerCase() || '';
    
    if (href) {
      // Check if this is a video link
      const isVideoLink = linkText.includes('watch video') || 
                         linkText.includes('video') ||
                         linkText.includes('watch');
      
      if (isVideoLink) {
        console.log(`🎥 Found video link: "${linkText}" -> ${href}`);
        
        // Fix relative video URLs
        let videoUrl = href;
        if (href.startsWith('/')) {
          videoUrl = `https://grafana.com${href}`;
        } else if (href.startsWith('./')) {
          videoUrl = `https://grafana.com/docs/${href.substring(2)}`;
        } else if (href.startsWith('../')) {
          videoUrl = `https://grafana.com/docs/${href.replace(/^\.\.\//, '')}`;
        }
        
        // Try to extract YouTube ID and convert to clean YouTube URL
        const youtubeId = extractYouTubeVideoId(videoUrl);
        if (youtubeId && !extractedVideoUrl) {
          // Check if the original URL has timing parameters we should preserve
          if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
            extractedVideoUrl = preserveYouTubeTimingParams(videoUrl);
            console.log(`🎥 Extracted YouTube URL with params: ${extractedVideoUrl}`);
          } else {
            extractedVideoUrl = `https://www.youtube.com/watch?v=${youtubeId}`;
            console.log(`🎥 Extracted basic YouTube URL: ${extractedVideoUrl}`);
          }
        } else if (!extractedVideoUrl) {
          extractedVideoUrl = videoUrl;
          console.log(`🎥 Extracted video URL: ${extractedVideoUrl}`);
        }
        
        // Remove the video link from content
        link.remove();
      } else {
        // Regular links - just ensure they open in new tabs
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        link.setAttribute('data-journey-link', 'true');
      }
    }
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
  
  return {
    content: clonedElement.innerHTML,
    videoUrl: extractedVideoUrl
  };
}

/**
 * Extract YouTube video ID from various YouTube URL formats
 */
function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/,
    /youtube\.com\/watch\?.*v=([^&\n?#]+)/,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Preserve YouTube timing parameters when extracting YouTube URLs from links
 */
function preserveYouTubeTimingParams(url: string): string {
  try {
    const urlObj = new URL(url);
    let videoId: string | null = null;
    let startTime: string | null = null;
    
    // Handle different YouTube URL formats
    if (urlObj.hostname.includes('youtube.com')) {
      if (urlObj.pathname.startsWith('/embed/')) {
        // Embed URL: https://www.youtube.com/embed/VIDEO_ID?start=123
        const pathMatch = urlObj.pathname.match(/\/embed\/([a-zA-Z0-9_-]+)/);
        videoId = pathMatch?.[1] || null;
        startTime = urlObj.searchParams.get('start');
      } else if (urlObj.pathname === '/watch') {
        // Watch URL: https://www.youtube.com/watch?v=VIDEO_ID&t=123
        videoId = urlObj.searchParams.get('v');
        startTime = urlObj.searchParams.get('t');
      }
    } else if (urlObj.hostname.includes('youtu.be')) {
      // Short URL: https://youtu.be/VIDEO_ID?t=123
      const pathMatch = urlObj.pathname.match(/\/([a-zA-Z0-9_-]+)/);
      videoId = pathMatch?.[1] || null;
      startTime = urlObj.searchParams.get('t');
    }
    
    if (!videoId) {
      console.warn('Could not extract video ID from URL:', url);
      return url;
    }
    
    // Construct clean watch URL
    let watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    if (startTime) {
      // Convert start time from seconds to t parameter format if needed
      const timeParam = startTime.match(/^\d+$/) ? startTime : startTime;
      watchUrl += `&t=${timeParam}`;
      console.log(`⏰ Preserving start time: ${timeParam}s`);
    }
    
    return watchUrl;
  } catch (error) {
    console.warn('Failed to preserve YouTube timing parameters:', error);
    return url;
  }
}

/**
 * Convert YouTube embed URL to watch URL while preserving timing parameters
 */
function convertEmbedToWatchUrl(embedUrl: string): string {
  return preserveYouTubeTimingParams(embedUrl);
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

/**
 * Extract timing parameters from button context, attributes, or surrounding text
 */
function extractTimingFromContext(button: Element): string | null {
  // Check various attributes that might contain timing info
  const attributes = [
    'data-time', 'data-start', 'data-timestamp', 'data-seconds', 
    'data-timing', 'data-position', 'data-offset'
  ];
  
  for (const attr of attributes) {
    const value = button.getAttribute(attr);
    if (value && /^\d+$/.test(value)) {
      console.log(`⏰ Found timing in ${attr}: ${value}s`);
      return value;
    }
  }
  
  // Check if timing is in the button text or title
  const text = button.textContent || '';
  const title = button.getAttribute('title') || '';
  const combined = `${text} ${title}`;
  
  const timeMatch = combined.match(/(?:start|at|@)\s*(\d+)(?:s|sec|seconds?)?/i);
  if (timeMatch) {
    console.log(`⏰ Found timing in text: ${timeMatch[1]}s`);
    return timeMatch[1];
  }
  
  return null;
}

/**
 * Extract timing parameters from modal click handlers
 */
function extractTimingFromModal(clickHandler: string | null): string | null {
  if (!clickHandler) return null;
  
  // Look for timing patterns in modal ID like: journey-modal-_ojYThjkpN0-45s
  const timingInModal = clickHandler.match(/journey-modal-[^'"-]*[-_](\d+)(?:s|sec)?['"]/i);
  if (timingInModal) {
    console.log(`⏰ Found timing in modal ID: ${timingInModal[1]}s`);
    return timingInModal[1];
  }
  
  // Look for timing parameters in the modal call itself
  const modalParams = clickHandler.match(/open_modal\([^)]*[,\s]+(\d+)/);
  if (modalParams) {
    console.log(`⏰ Found timing in modal params: ${modalParams[1]}s`);
    return modalParams[1];
  }
  
  return null;
}

/**
 * Extract timing parameters from sibling elements or parent context
 */
function extractTimingFromSiblings(button: Element): string | null {
  // Check parent element for timing attributes
  const parent = button.parentElement;
  if (parent) {
    const parentTiming = extractTimingFromContext(parent);
    if (parentTiming) {
      console.log(`⏰ Found timing in parent: ${parentTiming}s`);
      return parentTiming;
    }
  }
  
  // Check preceding/following text nodes for timing info
  const container = button.closest('div, section, article') || button.parentElement;
  if (container) {
    const containerText = container.textContent || '';
    const timeMatch = containerText.match(/(?:video\s+at|starts?\s+at|jump\s+to)\s*(\d+)(?::\d+)?\s*(?:s|sec|seconds?|minutes?)?/i);
    if (timeMatch) {
      let seconds = timeMatch[1];
      // Convert mm:ss format to seconds if needed
      if (timeMatch[0].includes(':')) {
        const [minutes, secs] = timeMatch[1].split(':').map(Number);
        seconds = String(minutes * 60 + (secs || 0));
      }
      console.log(`⏰ Found timing in container text: ${seconds}s`);
      return seconds;
    }
  }
  
  return null;
} 