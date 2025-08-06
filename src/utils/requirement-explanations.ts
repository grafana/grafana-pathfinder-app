/**
 * Shared utility functions for requirement explanations
 * Used across the interactive requirements system
 */

/**
 * Map common data-requirements to user-friendly explanatory messages
 * These serve as fallback messages when data-hint is not provided
 */
export function mapRequirementToUserFriendlyMessage(requirement: string): string {
  const requirementMappings: Record<string, string> = {
    // Navigation requirements
    'navmenu-open': 'The navigation menu needs to be open and docked. Click "Fix this" to automatically open and dock the navigation menu.',
    'navmenu-closed': 'Please close the navigation menu first.',
    
    // Authentication requirements  
    'is-admin': 'You need administrator privileges to perform this action. Please log in as an admin user.',
    'is-logged-in': 'You need to be logged in to continue. Please sign in to your Grafana account.',
    'is-editor': 'You need editor permissions or higher to perform this action.',
    
    // Plugin requirements
    'has-plugin': 'A required plugin needs to be installed first.',
    'plugin-enabled': 'The required plugin needs to be enabled in your Grafana instance.',
    
    // Dashboard requirements
    'dashboard-exists': 'A dashboard needs to be created or selected first.',
    'dashboard-edit-mode': 'The dashboard needs to be in edit mode. Look for the "Edit" button.',
    'panel-selected': 'Please select or create a panel first.',
    
    // Data source requirements
    'datasource-configured': 'A data source needs to be configured first.',
    'datasource-connected': 'Please ensure the data source connection is working.',
    'has-datasources': 'At least one data source needs to be configured.',
    
    // Page/URL requirements
    'on-page': 'Navigate to the correct page first.',
    'correct-url': 'You need to be on the right page to continue.',
    
    // Form requirements
    'form-valid': 'Please fill out all required form fields correctly.',
    'field-focused': 'Click on the specified form field first.',
    
    // General state requirements
    'element-visible': 'The required element needs to be visible on the page.',
    'element-enabled': 'The required element needs to be available for interaction.',
    'modal-open': 'A dialog or modal window needs to be open.',
    'modal-closed': 'Please close any open dialogs first.',
    'exists-reftarget': 'The target element must be visible and available on the page.',
  };
  
  // Enhanced requirement type handling
  const enhancedMappings: Array<{pattern: RegExp, message: (match: string) => string}> = [
    {
      pattern: /^has-permission:(.+)$/,
      message: (permission) => `You need the '${permission}' permission to perform this action.`
    },
    {
      pattern: /^has-role:(.+)$/,
      message: (role) => `You need ${role} role or higher to perform this action.`
    },
    {
      pattern: /^has-datasource:type:(.+)$/,
      message: (type) => `A ${type} data source needs to be configured first.`
    },
    {
      pattern: /^has-datasource:(.+)$/,
      message: (name) => `The '${name}' data source needs to be configured first.`
    },
    {
      pattern: /^has-plugin:(.+)$/,
      message: (plugin) => `The '${plugin}' plugin needs to be installed and enabled.`
    },
    {
      pattern: /^on-page:(.+)$/,
      message: (page) => `Navigate to the '${page}' page first.`
    },
    {
      pattern: /^has-feature:(.+)$/,
      message: (feature) => `The '${feature}' feature needs to be enabled.`
    },
    {
      pattern: /^in-environment:(.+)$/,
      message: (env) => `This action is only available in the ${env} environment.`
    },
    {
      pattern: /^min-version:(.+)$/,
      message: (version) => `This feature requires Grafana version ${version} or higher.`
    },
    {
      pattern: /^section-completed:(.+)$/,
      message: (sectionId) => `Complete the '${sectionId}' section before continuing to this section.`
    }
  ];
  
  // Check enhanced pattern-based requirements first
  for (const mapping of enhancedMappings) {
    const match = requirement.match(mapping.pattern);
    if (match) {
      return mapping.message(match[1]);
    }
  }

  // Handle plugin-specific requirements (e.g., "require-has-plugin="volkovlabs-rss-datasource")
  if (requirement.includes('has-plugin') || requirement.includes('plugin')) {
    const pluginMatch = requirement.match(/['"]([\w-]+)['"]/);
    if (pluginMatch) {
      const pluginName = pluginMatch[1];
      return `The "${pluginName}" plugin needs to be installed and enabled first.`;
    }
    return requirementMappings['has-plugin'] || 'A required plugin needs to be installed first.';
  }
  
  // Direct mapping lookup
  if (requirementMappings[requirement]) {
    return requirementMappings[requirement];
  }
  
  // Partial matching for compound requirements
  for (const [key, message] of Object.entries(requirementMappings)) {
    if (requirement.includes(key)) {
      return message;
    }
  }
  
  // Fallback to a generic but helpful message
  return `Requirement "${requirement}" needs to be satisfied. Check the page state and try again.`;
}

/**
 * Get user-friendly explanation for why requirements aren't met
 * Prioritizes data-hint over mapped requirement messages
 */
export function getRequirementExplanation(requirements?: string, hints?: string, error?: string): string {
  // Priority 1: Use data-hint if provided
  if (hints && hints.trim()) {
    return hints.trim();
  }
  
  // Priority 2: Map data-requirements to user-friendly message
  if (requirements && requirements.trim()) {
    return mapRequirementToUserFriendlyMessage(requirements.trim());
  }
  
  // Priority 3: Use error message if available
  if (error && error.trim()) {
    return error.trim();
  }
  
  // Fallback
  return 'Requirements not met. Please check the page state and try again.';
} 
