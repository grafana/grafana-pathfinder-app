import { DataSource, DashboardInfo } from './context-data-fetcher';

export interface ContextState {
  currentPath: string;
  pathSegments: string[];
  searchParams: Record<string, string>;
  dataSources: DataSource[];
  dashboardInfo: DashboardInfo | null;
  visualizationType?: string;
}

/**
 * Detect the current visualization type from the dashboard edit interface
 */
export function detectVisualizationType(): string | null {
  try {
    // Look for the active visualization picker button - try multiple selectors
    let vizPickerButtons = document.querySelectorAll('[data-testid="data-testid toggle-viz-picker"]');
    
    // If not found, try alternative selectors
    if (vizPickerButtons.length === 0) {
      vizPickerButtons = document.querySelectorAll('[data-testid*="toggle-viz-picker"]');
    }
    
    // Also try finding by aria-label
    if (vizPickerButtons.length === 0) {
      vizPickerButtons = document.querySelectorAll('[aria-label="Change visualization"]');
    }
    
    for (const button of vizPickerButtons) {
      // Check if this button is in an active/visible state (not in a hidden dropdown)
      const buttonElement = button as HTMLElement;
      const isVisible = buttonElement.offsetParent !== null;
      
      if (isVisible) {
        // Try to extract viz type from image src
        const img = buttonElement.querySelector('img');
        if (img && img.src) {
          const srcMatch = img.src.match(/\/plugins\/panel\/([^\/]+)\//);
          if (srcMatch) {
            return srcMatch[1]; // e.g., "stat", "gauge", "timeseries"
          }
        }
        
        // Fallback: extract from text content
        const textDiv = buttonElement.querySelector('div');
        if (textDiv && textDiv.textContent) {
          return textDiv.textContent.trim().toLowerCase();
        }
      }
    }
    
    // Also check for panel type in edit mode query params
    const urlParams = new URLSearchParams(window.location.search);
    const editPanel = urlParams.get('editPanel');
    if (editPanel) {
      // Check if there's a panelType parameter
      const panelType = urlParams.get('panelType');
      if (panelType) {
        return panelType;
      }
    }
    
    return null;
  } catch (error) {
    console.warn('Failed to detect visualization type:', error);
    return null;
  }
}

/**
 * Helper function to create compound tags with actions
 */
function createCompoundTag(entity: string, action: string): string {
  return `${entity}:${action}`;
}

/**
 * Detect specific action from path and query parameters
 */
function detectAction(path: string, searchParams: Record<string, string>): string {
  // Check URL parameters first (more specific)
  if (searchParams.editPanel) return 'edit';
  if (searchParams.addPanel) return 'create';
  if (searchParams.sharePanel) return 'share';
  if (searchParams.inspect) return 'inspect';
  if (searchParams.viewPanel) return 'view';
  
  // Check path patterns
  if (path.includes('/new')) return 'create';
  if (path.includes('/edit')) return 'edit';
  if (path.includes('/settings') || path.includes('/config')) return 'configure';
  if (path.includes('/query')) return 'query';
  if (path.includes('/test')) return 'test';
  if (path.includes('/delete')) return 'delete';
  if (path.includes('/import')) return 'import';
  if (path.includes('/export')) return 'export';
  
  return 'view'; // Default action
}

/**
 * Extract specific entity from path segments with better context awareness
 */
function extractEntity(pathSegments: string[]): string | null {
  if (pathSegments.length === 0) return null;
  
  // Handle compound paths that need more context
  if (pathSegments.length >= 2) {
    // Handle /connections/datasources as datasource context
    if (pathSegments[0] === 'connections' && pathSegments[1] === 'datasources') {
      return 'datasource';
    }
    // Handle /connections/cloud-monitoring as datasource context (alternative path)
    if (pathSegments[0] === 'connections' && pathSegments[1] !== 'datasources') {
      return 'datasource'; // Most connections are datasource-related
    }
  }
  
  const entityMap: Record<string, string> = {
    'd': 'dashboard',
    'dashboard': 'dashboard',        // Handle both /d/ and /dashboard/ paths
    'datasources': 'datasource',
    'explore': 'explore',
    'alerting': 'alert',
    'admin': 'admin',
    'plugins': 'plugin',
    'org': 'organization',
    'profile': 'profile',
    'connections': 'connection',     // Fallback for non-datasource connections
    'a': 'app',
  };
  
  return entityMap[pathSegments[0]] || null;
}

/**
 * Detect datasource type from DOM elements with retry logic for rendering time
 */
function detectDatasourceTypeFromDOM(): string | null {
  // Known datasource types (common ones)
  const knownTypes = [
    'prometheus', 'grafana', 'cloudwatch', 'elasticsearch', 'influxdb',
    'mysql', 'postgres', 'postgresql', 'azure', 'stackdriver',
    'datadog', 'jaeger', 'zipkin', 'tempo', 'loki', 'alertmanager',
    'graphite', 'opentsdb', 'mixed', 'dashboard', 'testdata',
    'parca', 'pyroscope', 'x-ray', 'newrelic', 'splunk', 'mimir'
  ];
  
  const detectType = (): string | null => {
    try {
      // Strategy 1: Look for the specific pattern "Type: OpenTSDB"
      // <div class="css-3oq5wu">Type: OpenTSDB</div>
      const typeElements = document.querySelectorAll('div[class*="css-"], .type-label, .datasource-type');
      
      for (const element of typeElements) {
        const text = element.textContent?.trim() || '';
        
        // Look for "Type: {datasource}" pattern
        const typeMatch = text.match(/Type:\s*(.+)/i);
        if (typeMatch) {
          const typeValue = typeMatch[1].trim().toLowerCase();
          
          // Check if it matches a known type
          for (const type of knownTypes) {
            if (typeValue.includes(type)) {
              return type;
            }
          }
        }
      }
      
      // Strategy 2: Look for datasource type in page content
      const bodyText = document.body.textContent?.toLowerCase() || '';
      
      // Look for "Type: {datasource}" pattern in body text
      const typeMatch = bodyText.match(/type:\s*([a-zA-Z0-9\-_]+)/i);
      if (typeMatch) {
        const typeValue = typeMatch[1].toLowerCase();
        for (const type of knownTypes) {
          if (typeValue.includes(type)) {
            return type;
          }
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  };
  
  // Try immediately first
  let result = detectType();
  if (result) return result;
  
  // If not found, try again after a short delay to account for rendering
  setTimeout(() => {
    result = detectType();
  }, 100);
  
  return result;
}

/**
 * Get current datasource from path or context
 */
function getCurrentDataSource(pathSegments: string[], dataSources: DataSource[]): DataSource | null {
  // Check if we're in a datasource-specific path (legacy /datasources path)
  if (pathSegments[0] === 'datasources' && pathSegments.length > 1) {
    const dsId = pathSegments[1];
    
    // Find by ID (numeric) or name
    const foundDs = dataSources.find(ds => 
      ds.id.toString() === dsId || ds.name === dsId
    );
    
    return foundDs || null;
  }
  
  // For connections/datasources path, we can't match by UID in URL
  // We'll rely on DOM detection for the datasource type
  if (pathSegments[0] === 'connections' && pathSegments[1] === 'datasources') {
    return null; // Will fall back to DOM detection
  }
  
  // Check if we're in explore with a datasource
  if (pathSegments[0] === 'explore') {
    const urlParams = new URLSearchParams(window.location.search);
    const leftDs = urlParams.get('left');
    
    if (leftDs) {
      try {
        const leftData = JSON.parse(decodeURIComponent(leftDs));
        if (leftData.datasource) {
          return dataSources.find(ds => ds.name === leftData.datasource) || null;
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
    }
  }
  
  return null;
}

/**
 * Extract alert rule context with alert type detection
 */
function extractAlertContext(pathSegments: string[], searchParams: Record<string, string>): string[] {
  const tags: string[] = [];
  
  if (pathSegments[0] !== 'alerting') return tags;
  
  const alertSection = pathSegments[1];
  const action = detectAction(window.location.pathname, searchParams);
  
  // Detect alert type (alerting vs recording rules)
  const alertType = detectAlertType(pathSegments, searchParams);
  if (alertType) {
    tags.push(createCompoundTag('alert-type', alertType));
  }
  
  switch (alertSection) {
    case 'rules':
      tags.push(createCompoundTag('alert-rule', action));
      break;
    case 'notifications':
      tags.push(createCompoundTag('alert-notification', action));
      break;
    case 'groups':
      tags.push(createCompoundTag('alert-group', action));
      break;
    case 'silences':
      tags.push(createCompoundTag('alert-silence', action));
      break;
    default:
      tags.push(createCompoundTag('alert', action));
  }
  
  return tags;
}

/**
 * Detect alert type from URL patterns and DOM elements
 */
function detectAlertType(pathSegments: string[], searchParams: Record<string, string>): string | null {
  try {
    // Check URL query parameters first (most reliable)
    if (searchParams.type === 'recording') {
      return 'recording';
    }
    if (searchParams.type === 'alerting') {
      return 'alerting';
    }
    
    // Check for recording rule indicators in URL path
    const fullPath = window.location.pathname;
    if (fullPath.includes('recording') || fullPath.includes('record')) {
      return 'recording';
    }
    
    // Check DOM elements for alert type indicators
    const pageContent = document.body;
    
    // Look for text content that indicates recording rules
    if (pageContent.textContent?.includes('Recording rule') || 
        pageContent.textContent?.includes('recording rule')) {
      return 'recording';
    }
    
    // Look for specific selectors that indicate recording rules
    const recordingIndicators = [
      '[data-testid*="recording"]',
      '[aria-label*="recording" i]',
      '.recording-rule',
      '.rule-type-recording'
    ];
    
    for (const selector of recordingIndicators) {
      if (document.querySelector(selector)) {
        return 'recording';
      }
    }
    
    // Look for alerting rule indicators
    const alertingIndicators = [
      '[data-testid*="alert-rule"]',
      '[aria-label*="alert rule" i]',
      '.alert-rule',
      '.rule-type-alerting'
    ];
    
    for (const selector of alertingIndicators) {
      if (document.querySelector(selector)) {
        return 'alerting';
      }
    }
    
    // Check for form elements that might indicate the type
    const typeSelectors = document.querySelectorAll('select[name*="type"], input[name*="type"]');
    for (const element of typeSelectors) {
      const value = (element as HTMLInputElement | HTMLSelectElement).value;
      if (value === 'recording' || value === 'alerting') {
        return value;
      }
    }
    
    // Default to alerting if we're in the rules section (most common)
    if (pathSegments[1] === 'rules') {
      return 'alerting';
    }
    
    return null;
  } catch (error) {
    console.warn('Failed to detect alert type:', error);
    return null;
  }
}

/**
 * Extract plugin context with better specificity
 */
function extractPluginContext(pathSegments: string[]): string[] {
  const tags: string[] = [];
  
  if (pathSegments[0] !== 'plugins') return tags;
  
  const pluginType = pathSegments[1]; // app, datasource, panel
  const pluginId = pathSegments[2];
  
  if (pluginType && pluginId) {
    tags.push(createCompoundTag('plugin', pluginType));
    tags.push(createCompoundTag(`plugin-${pluginType}`, pluginId));
  } else if (pluginType) {
    tags.push(createCompoundTag('plugin', pluginType));
  }
  
  return tags;
}

/**
 * Extract dashboard context with panel specificity
 */
function extractDashboardContext(
  pathSegments: string[], 
  searchParams: Record<string, string>, 
  dashboardInfo: DashboardInfo | null,
  visualizationType?: string
): string[] {
  const tags: string[] = [];
  
  // Handle both /d/ and /dashboard/ paths
  if (pathSegments[0] !== 'd' && pathSegments[0] !== 'dashboard') return tags;
  
  // Add dashboard tags if available (only for existing dashboards)
  if (dashboardInfo && dashboardInfo.tags && dashboardInfo.tags.length > 0) {
    dashboardInfo.tags.forEach(tag => {
      tags.push(createCompoundTag('dashboard-tag', tag.toLowerCase()));
    });
  }
  
  // Panel-specific context
  if (searchParams.editPanel || searchParams.addPanel || searchParams.viewPanel) {
    const panelAction = searchParams.editPanel ? 'edit' : 
                       searchParams.addPanel ? 'create' : 'view';
    
    tags.push(createCompoundTag('panel', panelAction));
    
    // Add visualization type if available
    if (visualizationType) {
      // Clean visualization type (remove spaces, convert to kebab-case)
      const cleanVizType = visualizationType.toLowerCase().replace(/\s+/g, '-');
      tags.push(createCompoundTag('panel-type', cleanVizType));
    }
  }
  
  return tags;
}

/**
 * Extract datasource type from explore panes URL parameter
 */
function extractDatasourceTypeFromPanes(panesParam: string): string[] {
  const types: string[] = [];
  
  try {
    // Decode the URL-encoded JSON
    const decodedPanes = decodeURIComponent(panesParam);
    const panesData = JSON.parse(decodedPanes);
    
    // Iterate through all panes
    Object.values(panesData).forEach((pane: any) => {
      if (pane && pane.queries && Array.isArray(pane.queries)) {
        // Extract datasource types from queries
        pane.queries.forEach((query: any) => {
          if (query.datasource && query.datasource.type) {
            const type = query.datasource.type.toLowerCase();
            if (!types.includes(type)) {
              types.push(type);
            }
          }
        });
      }
    });
  } catch (error) {
    console.warn('Failed to parse explore panes parameter:', error);
  }
  
  return types;
}

/**
 * Extract explore context with datasource specificity
 */
function extractExploreContext(
  pathSegments: string[], 
  searchParams: Record<string, string>, 
  dataSources: DataSource[]
): string[] {
  const tags: string[] = [];
  
  if (pathSegments[0] !== 'explore') return tags;
  
  tags.push(createCompoundTag('explore', 'query'));
  
  // Check for split view
  if (searchParams.left && searchParams.right) {
    tags.push(createCompoundTag('explore', 'split-view'));
  }
  
  // Extract datasource types from panes parameter (new explore UI)
  if (searchParams.panes) {
    const datasourceTypes = extractDatasourceTypeFromPanes(searchParams.panes);
    datasourceTypes.forEach(type => {
      tags.push(createCompoundTag('query-type', type));
    });
  }
  
  // Legacy: Extract datasource context from left/right parameters
  const currentDs = getCurrentDataSource(pathSegments, dataSources);
  if (currentDs) {
    tags.push(createCompoundTag('query-type', currentDs.type.toLowerCase()));
  }
  
  return tags;
}

/**
 * Extract admin context
 */
function extractAdminContext(pathSegments: string[], searchParams: Record<string, string>): string[] {
  const tags: string[] = [];
  
  if (pathSegments[0] !== 'admin') return tags;
  
  const adminSection = pathSegments[1];
  const action = detectAction(window.location.pathname, searchParams);
  
  switch (adminSection) {
    case 'users':
      tags.push(createCompoundTag('admin-users', action));
      break;
    case 'orgs':
      tags.push(createCompoundTag('admin-orgs', action));
      break;
    case 'plugins':
      tags.push(createCompoundTag('admin-plugins', action));
      break;
    case 'settings':
      tags.push(createCompoundTag('admin-settings', action));
      break;
    default:
      tags.push(createCompoundTag('admin', action));
  }
  
  return tags;
}

/**
 * Extract datasource context with specific type and action
 */
function extractDatasourceContext(
  pathSegments: string[], 
  searchParams: Record<string, string>, 
  dataSources: DataSource[]
): string[] {
  const tags: string[] = [];
  
  // Handle both old (/datasources) and new (/connections/datasources) paths
  const isDatasourcePath = pathSegments[0] === 'datasources' || 
                          (pathSegments[0] === 'connections' && pathSegments[1] === 'datasources');
  
  if (!isDatasourcePath) return tags;
  
  const action = detectAction(window.location.pathname, searchParams);
  const currentDs = getCurrentDataSource(pathSegments, dataSources);
  
  // Try to get datasource type from multiple sources
  let datasourceType: string | null = null;
  
  if (currentDs) {
    // First priority: Use the datasource from the API
    datasourceType = currentDs.type.toLowerCase();
  } else {
    // Second priority: Try to detect from DOM
    datasourceType = detectDatasourceTypeFromDOM();
  }
  
  if (datasourceType) {
    // Add datasource type tag
    tags.push(createCompoundTag('datasource-type', datasourceType));
  }
  
  // Only add available datasource types when creating/browsing, not when editing a specific one
  if (action === 'create' || action === 'view') {
    const uniqueTypes = [...new Set(dataSources.map(ds => ds.type.toLowerCase()))];
    uniqueTypes.forEach(type => {
      tags.push(createCompoundTag('available-datasource', type));
    });
  }
  
  return tags;
}

/**
 * Extract app context with specific app name and action
 */
function extractAppContext(pathSegments: string[], searchParams: Record<string, string>): string[] {
  const tags: string[] = [];
  
  if (pathSegments[0] !== 'a') return tags;
  
  const action = detectAction(window.location.pathname, searchParams);
  
  // Add app:action tag
  tags.push(createCompoundTag('app', action));
  
  // Extract app name from second path segment
  if (pathSegments.length > 1) {
    const appName = pathSegments[1];
    
    // Extract shorter app identifier for app-type
    // e.g., "grafana-metricsdrilldown-app" -> "metricsdrilldown"
    const shortName = extractShortAppName(appName);
    tags.push(createCompoundTag('app-type', shortName));
  }
  
  return tags;
}

/**
 * Extract a shorter, more readable app name from the full app plugin name
 */
function extractShortAppName(appName: string): string {
  // Remove common prefixes and suffixes
  let shortName = appName
    .replace(/^grafana-/, '')  // Remove "grafana-" prefix
    .replace(/-app$/, '')      // Remove "-app" suffix
    .replace(/-plugin$/, '');  // Remove "-plugin" suffix
  
  // If we still have hyphens, take the main part
  const parts = shortName.split('-');
  if (parts.length > 1) {
    // Look for the main descriptive part (usually the longest or most meaningful)
    const mainPart = parts.find(part => part.length > 3) || parts[0];
    return mainPart;
  }
  
  return shortName;
}

/**
 * Generates detailed context tags for improved recommendations
 * Creates compound tags like dashboard:create, datasource:influxdb, etc.
 */
export function generateContextTags(state: ContextState): string[] {
  const tags: string[] = [];
  const { currentPath, pathSegments, searchParams, dataSources, dashboardInfo, visualizationType } = state;
  
  // Extract entity and action
  const entity = extractEntity(pathSegments);
  const action = detectAction(currentPath, searchParams);
  
  // Add primary entity:action tag
  if (entity) {
    tags.push(createCompoundTag(entity, action));
  }
  
  // Add context-specific tags based on the primary entity
  switch (entity) {
    case 'dashboard':
      tags.push(...extractDashboardContext(pathSegments, searchParams, dashboardInfo, visualizationType));
      break;
    case 'datasource':
      tags.push(...extractDatasourceContext(pathSegments, searchParams, dataSources));
      break;
    case 'explore':
      tags.push(...extractExploreContext(pathSegments, searchParams, dataSources));
      break;
    case 'alert':
      tags.push(...extractAlertContext(pathSegments, searchParams));
      break;
    case 'admin':
      tags.push(...extractAdminContext(pathSegments, searchParams));
      break;
    case 'plugin':
      tags.push(...extractPluginContext(pathSegments));
      break;
    case 'app':
      tags.push(...extractAppContext(pathSegments, searchParams));
      break;
  }
  
  // Add general context tags
  
  // User interaction patterns
  if (searchParams.tab) {
    tags.push(createCompoundTag('ui', 'tabbed'));
  }
  if (searchParams.fullscreen) {
    tags.push(createCompoundTag('ui', 'fullscreen'));
  }
  if (searchParams.kiosk) {
    tags.push(createCompoundTag('ui', 'kiosk'));
  }
  

  
  // Variable context
  if (searchParams['var-']) {
    tags.push(createCompoundTag('dashboard', 'variables'));
  }
  
  // Remove duplicates and return
  return [...new Set(tags)];
} 
