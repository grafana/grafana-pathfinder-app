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
 * Generates context tags based on the current user state
 * Tags are one-word, generalized, and don't expose sensitive information
 * Extracted from context-panel.tsx generateContextTags method
 */
export function generateContextTags(state: ContextState): string[] {
  const tags: string[] = [];
  const { currentPath: path, pathSegments, searchParams, dataSources, dashboardInfo } = state;

  // Core section tags
  if (pathSegments.length > 0) {
    const section = pathSegments[0];
    switch (section) {
      case 'd':
        tags.push('dashboard');
        break;
      case 'datasources':
        tags.push('datasource');
        break;
      case 'explore':
        tags.push('explore');
        break;
      case 'alerting':
        tags.push('alerting');
        break;
      case 'admin':
        tags.push('admin');
        break;
      case 'plugins':
        tags.push('plugins');
        break;
      case 'org':
        tags.push('organization');
        break;
      case 'profile':
        tags.push('profile');
        break;
      case 'connections':
        tags.push('connections');
        break;
      case 'a':
        tags.push('app');
        // Add app plugin context if available
        if (pathSegments[1]) {
          tags.push('plugin');
        }
        break;
    }
  }

  // Action context tags
  if (path.includes('/new')) {
    tags.push('creating');
  } else if (path.includes('/edit') || searchParams.editPanel) {
    tags.push('editing');
  } else if (path.includes('/settings') || path.includes('/config')) {
    tags.push('configuring');
  } else if (searchParams.inspect) {
    tags.push('inspecting');
  } else if (searchParams.viewPanel) {
    tags.push('viewing');
  } else if (path.includes('/query')) {
    tags.push('querying');
  }

  // Dashboard-specific context
  if (dashboardInfo) {
    tags.push('dashboard');
    if (searchParams.editPanel) {
      tags.push('panel', 'editing');
    } else if (searchParams.addPanel) {
      tags.push('panel', 'creating');
    } else if (searchParams.sharePanel) {
      tags.push('panel', 'sharing');
    }
  }

  // Data source context
  if (path.includes('/datasources')) {
    tags.push('datasource');
    if (path.includes('/new')) {
      tags.push('creating');
    } else if (path.includes('/edit')) {
      tags.push('configuring');
    }
    
    // Add actual data source types
    dataSources.forEach(ds => {
      if (ds.type) {
        tags.push(ds.type.toLowerCase());
      }
    });
  }

  // Alerting context
  if (path.includes('/alerting')) {
    tags.push('alerting');
    if (path.includes('/rules')) {
      tags.push('rules');
    } else if (path.includes('/notifications')) {
      tags.push('notifications');
    } else if (path.includes('/groups')) {
      tags.push('groups');
    }
  }

  // Explore context
  if (path.includes('/explore')) {
    tags.push('explore', 'querying');
    if (searchParams.left && searchParams.right) {
      tags.push('split');
    }
  }

  // Admin context
  if (path.includes('/admin')) {
    tags.push('admin');
    if (path.includes('/users')) {
      tags.push('users');
    } else if (path.includes('/orgs')) {
      tags.push('organizations');
    } else if (path.includes('/plugins')) {
      tags.push('plugins');
    } else if (path.includes('/settings')) {
      tags.push('settings');
    }
  }

  // Plugin context
  if (path.includes('/plugins')) {
    tags.push('plugins');
    if (path.includes('/app/')) {
      tags.push('app');
    } else if (path.includes('/datasource/')) {
      tags.push('datasource');
    } else if (path.includes('/panel/')) {
      tags.push('panel');
    }
  }

  // User interaction patterns
  if (searchParams.tab) {
    tags.push('tabbed');
  }
  if (searchParams.editview) {
    tags.push('editing');
  }
  if (searchParams.fullscreen) {
    tags.push('fullscreen');
  }

  // Add visualization type tag if detected
  if (state.visualizationType) {
    tags.push(`visualization:${state.visualizationType}`);
    tags.push('panel-editing');
  }

  // Remove duplicates and return
  return [...new Set(tags)];
} 
