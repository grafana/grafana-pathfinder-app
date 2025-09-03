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
    'navmenu-open':
      'The navigation menu needs to be open and docked. Click "Fix this" to automatically open and dock the navigation menu.',
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
  const enhancedMappings: Array<{ pattern: RegExp; message: (match: string) => string }> = [
    {
      pattern: /^has-permission:(.+)$/,
      message: (permission) => `You need the '${permission}' permission to perform this action.`,
    },
    {
      pattern: /^has-role:(.+)$/,
      message: (role) => `You need ${role} role or higher to perform this action.`,
    },
    {
      pattern: /^has-datasource:type:(.+)$/,
      message: (type) => `A ${type} data source needs to be configured first.`,
    },
    {
      pattern: /^has-datasource:(.+)$/,
      message: (name) => `The '${name}' data source needs to be configured first.`,
    },
    {
      pattern: /^has-dashboard-named:(.+)$/,
      message: (dashboard) =>
        `The dashboard '${dashboard}' needs to exist first. Complete the previous tutorial or create it manually.`,
    },
    {
      pattern: /^has-plugin:(.+)$/,
      message: (plugin) => `The '${plugin}' plugin needs to be installed and enabled.`,
    },
    {
      pattern: /^on-page:(.+)$/,
      message: (page) => `Navigate to the '${page}' page first.`,
    },
    {
      pattern: /^has-feature:(.+)$/,
      message: (feature) => `The '${feature}' feature needs to be enabled.`,
    },
    {
      pattern: /^in-environment:(.+)$/,
      message: (env) => `This action is only available in the ${env} environment.`,
    },
    {
      pattern: /^min-version:(.+)$/,
      message: (version) => `This feature requires Grafana version ${version} or higher.`,
    },
    {
      pattern: /^section-completed:(.+)$/,
      message: (sectionId) => `Complete the '${sectionId}' section before continuing to this section.`,
    },
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
 * Analyze error message to determine if it's a known, safe error type
 * Returns a user-friendly message for known errors, null for unknown/unsafe errors
 */
function getSafeErrorMessage(error: string): string | null {
  const lowerError = error.toLowerCase();

  // Network-related errors (safe to expose)
  if (lowerError.includes('network') || lowerError.includes('connection') || lowerError.includes('timeout')) {
    return 'Network connection issue. Please check your internet connection and try again.';
  }

  // Permission/authentication errors (safe to expose)
  if (lowerError.includes('permission') || lowerError.includes('unauthorized') || lowerError.includes('forbidden')) {
    return 'Permission denied. You may need to log in or request additional permissions.';
  }

  // Common HTTP status codes (safe to expose)
  if (lowerError.includes('404') || lowerError.includes('not found')) {
    return 'The requested resource was not found. Please check the URL or try again later.';
  }
  if (lowerError.includes('500') || lowerError.includes('server error')) {
    return 'Server error occurred. Please try again later.';
  }
  if (lowerError.includes('503') || lowerError.includes('service unavailable')) {
    return 'Service temporarily unavailable. Please try again later.';
  }

  // Element not found errors (safe to expose)
  if (lowerError.includes('element') && (lowerError.includes('not found') || lowerError.includes('missing'))) {
    return 'The expected element is not available on the page. Please check if the page has loaded completely.';
  }

  // Timeout errors (safe to expose)
  if (lowerError.includes('timeout')) {
    return 'Operation timed out. Please try again.';
  }

  // Return null for unknown/unsafe errors to avoid information leakage
  return null;
}

/**
 * Get user-friendly explanation for why requirements aren't met
 * Prioritizes data-hint over mapped requirement messages
 * Enhanced to handle skippable steps with appropriate messaging
 */
export function getRequirementExplanation(
  requirements?: string,
  hints?: string,
  error?: string,
  isSkippable?: boolean
): string {
  // Priority 1: Use data-hint if provided
  if (hints && hints.trim()) {
    const baseHint = hints.trim();
    if (isSkippable) {
      return `${baseHint} This step can be skipped if you don't have the necessary permissions or setup.`;
    }
    return baseHint;
  }

  // Priority 2: Map data-requirements to user-friendly message
  if (requirements && requirements.trim()) {
    const baseMessage = mapRequirementToUserFriendlyMessage(requirements.trim());
    if (isSkippable) {
      return `${baseMessage} You can skip this step if you don't have the necessary permissions.`;
    }
    return baseMessage;
  }

  // Priority 3: Use safe error message if available
  if (error && error.trim()) {
    const safeError = getSafeErrorMessage(error.trim());
    if (safeError) {
      const baseError = safeError;
      if (isSkippable) {
        return `${baseError} This step can be skipped if the requirement cannot be met.`;
      }
      return baseError;
    }
  }

  // Fallback
  if (isSkippable) {
    return 'Requirements not met, but this step can be skipped to continue the tutorial.';
  }
  return 'Requirements not met. Please check the page state and try again.';
}

/**
 * Get user-friendly explanation for why a post-verify (data-verify) failed
 * Uses the same mapping as requirements, but prioritizes any concrete error details
 */
export function getPostVerifyExplanation(verify?: string, error?: string): string {
  // Priority 1: Use safe error details if provided
  if (error && error.trim()) {
    const safeError = getSafeErrorMessage(error.trim());
    if (safeError) {
      return safeError;
    }
  }

  // Priority 2: Map verification tokens to friendly messages
  if (verify && verify.trim()) {
    return mapRequirementToUserFriendlyMessage(verify.trim());
  }

  return 'Verification failed. The expected result was not achieved. Review the step and try again.';
}
