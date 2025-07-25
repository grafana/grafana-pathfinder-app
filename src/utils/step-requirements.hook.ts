import { useState, useCallback, useEffect } from 'react';
import { useInteractiveElements } from './interactive.hook';

interface UseStepRequirementsProps {
  requirements?: string;
  hints?: string;
  stepId: string;
  isEligibleForChecking: boolean; // Passed by parent based on sequential logic
}

interface StepRequirementsState {
  isEnabled: boolean;
  explanation: string;
  isChecking: boolean;
  error?: string;
}

interface UseStepRequirementsReturn extends StepRequirementsState {
  checkRequirements: () => Promise<void>;
}

/**
 * Map common data-requirements to user-friendly explanatory messages
 * These serve as fallback messages when data-hint is not provided
 */
function mapRequirementToUserFriendlyMessage(requirement: string): string {
  const requirementMappings: Record<string, string> = {
    // Navigation requirements
    'navmenu-open': 'The navigation menu needs to be open. Look for the menu icon (☰) in the top-left corner.',
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
function getRequirementExplanation(requirements?: string, hints?: string, error?: string): string {
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

/**
 * Hook for requirements checking logic that can be reused across components
 * Handles the requirements checking but delegates sequential logic to parent
 */
export function useStepRequirements({
  requirements,
  hints,
  stepId,
  isEligibleForChecking
}: UseStepRequirementsProps): UseStepRequirementsReturn {
  const [state, setState] = useState<StepRequirementsState>({
    isEnabled: false,
    explanation: '',
    isChecking: false,
  });
  
  const { checkElementRequirements } = useInteractiveElements();
  
  const checkRequirements = useCallback(async () => {
    // If not eligible for checking due to sequential dependencies
    if (!isEligibleForChecking) {
      setState({
        isEnabled: false,
        explanation: 'Complete the previous steps in order before this one becomes available.',
        isChecking: false,
        error: 'Sequential dependency not met'
      });
      return;
    }
    
    // If no requirements, step is enabled
    if (!requirements) {
      setState({
        isEnabled: true,
        explanation: '',
        isChecking: false,
      });
      return;
    }
    
    setState(prev => ({ ...prev, isChecking: true }));
    
    try {
      // Create mock element for requirements checking (reusing existing logic)
      const mockElement = document.createElement('div');
      mockElement.setAttribute('data-requirements', requirements);
      mockElement.setAttribute('data-targetaction', 'button');
      mockElement.setAttribute('data-reftarget', stepId);
      
      // Add timeout to prevent hanging  
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Requirements check timeout')), 5000);
      });
      
      const result = await Promise.race([
        checkElementRequirements(mockElement),
        timeoutPromise
      ]);
      
      const errorMessage = result.pass ? undefined : result.error?.map((e: any) => e.error || e.requirement).join(', ');
      const explanation = result.pass ? '' : getRequirementExplanation(requirements, hints, errorMessage);
      
      setState({
        isEnabled: result.pass,
        explanation,
        isChecking: false,
        error: errorMessage,
      });
    } catch (error) {
      console.error(`Requirements check failed for ${stepId}:`, error);
      const errorMessage = 'Failed to check requirements';
      const explanation = getRequirementExplanation(requirements, hints, errorMessage);
      
      setState({
        isEnabled: false,
        explanation,
        isChecking: false,
        error: errorMessage,
      });
    }
  }, [requirements, hints, stepId, isEligibleForChecking, checkElementRequirements]);
  
  // Auto-check requirements when eligibility changes
  useEffect(() => {
    checkRequirements();
  }, [checkRequirements]);
  
  return {
    ...state,
    checkRequirements,
  };
} 