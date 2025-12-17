/**
 * Interactive Conditional Component
 *
 * Evaluates conditions and renders the appropriate branch (whenTrue or whenFalse).
 * Re-evaluates when relevant state changes (datasources, plugins, page location, etc.).
 * Supports two display modes:
 * - 'inline' (default): Renders children directly without wrapper
 * - 'section': Renders children inside an InteractiveSection with full "Do Section" functionality
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useInteractiveElements } from '../../../interactive-engine';
import type { ParsedElement } from '../../html-parser';
import { testIds } from '../../../components/testIds';
import type { ConditionalDisplayMode, ConditionalSectionConfig } from '../../../types/json-guide.types';
import { InteractiveSection } from './interactive-section';

export interface InteractiveConditionalProps {
  /** Conditions to evaluate (uses same syntax as requirements) */
  conditions: string[];
  /** Optional description (shown in debug mode, not to users) */
  description?: string;
  /** Display mode: 'inline' (default) or 'section' for section-styled rendering */
  display?: ConditionalDisplayMode;
  /** Section config for the 'pass' branch (only used when display is 'section') */
  whenTrueSectionConfig?: ConditionalSectionConfig;
  /** Section config for the 'fail' branch (only used when display is 'section') */
  whenFalseSectionConfig?: ConditionalSectionConfig;
  /** Children to render when ALL conditions pass */
  whenTrueChildren: ParsedElement[];
  /** Children to render when ANY condition fails */
  whenFalseChildren: ParsedElement[];
  /** Function to render a ParsedElement to React */
  renderElement: (element: ParsedElement, key: string) => React.ReactNode;
  /** Key prefix for rendered children */
  keyPrefix: string;
}

/**
 * Parse conditions array into a requirements string for the checker
 */
function conditionsToRequirementsString(conditions: string[]): string {
  return conditions.join(',');
}

/**
 * Interactive conditional component that evaluates conditions and renders appropriate branch
 */
export function InteractiveConditional({
  conditions,
  description,
  display = 'inline',
  whenTrueSectionConfig,
  whenFalseSectionConfig,
  whenTrueChildren,
  whenFalseChildren,
  renderElement,
  keyPrefix,
}: InteractiveConditionalProps) {
  const [conditionsPassed, setConditionsPassed] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const { checkRequirementsFromData } = useInteractiveElements();

  // Generate a stable ID for this conditional
  const conditionalId = useMemo(
    () => conditions.join('-').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 50) || 'unknown',
    [conditions]
  );

  // Track mounted state to prevent state updates after unmount
  // REACT: Track mounted state (R4)
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Convert conditions to requirements string format
  const requirementsString = conditionsToRequirementsString(conditions);

  // Function to evaluate conditions
  const evaluateConditions = useCallback(async () => {
    if (!isMountedRef.current) {
      return;
    }

    setIsChecking(true);

    try {
      // Create requirement data for checking
      const requirementData = {
        requirements: requirementsString,
        targetaction: 'conditional',
        reftarget: 'conditional-block',
        targetvalue: undefined,
        textContent: description || 'Conditional block',
        tagName: 'div',
      };

      const result = await checkRequirementsFromData(requirementData);

      if (isMountedRef.current) {
        setConditionsPassed(result.pass);
        setIsChecking(false);
      }
    } catch (error) {
      console.warn('Failed to evaluate conditional conditions:', error);
      if (isMountedRef.current) {
        // Default to false branch on error
        setConditionsPassed(false);
        setIsChecking(false);
      }
    }
  }, [requirementsString, checkRequirementsFromData, description]);

  // Initial evaluation
  useEffect(() => {
    evaluateConditions();
  }, [evaluateConditions]);

  // Re-evaluate when relevant events occur
  useEffect(() => {
    // Listen for events that might change condition results
    const handleDataSourcesChanged = () => {
      evaluateConditions();
    };

    const handlePluginsChanged = () => {
      evaluateConditions();
    };

    const handleLocationChanged = () => {
      evaluateConditions();
    };

    // Subscribe to relevant events
    window.addEventListener('datasources-changed', handleDataSourcesChanged);
    window.addEventListener('plugins-changed', handlePluginsChanged);
    window.addEventListener('popstate', handleLocationChanged);

    // Also re-evaluate periodically to catch other state changes
    const intervalId = setInterval(() => {
      evaluateConditions();
    }, 5000); // Re-check every 5 seconds

    // REACT: cleanup subscriptions (R1)
    return () => {
      window.removeEventListener('datasources-changed', handleDataSourcesChanged);
      window.removeEventListener('plugins-changed', handlePluginsChanged);
      window.removeEventListener('popstate', handleLocationChanged);
      clearInterval(intervalId);
    };
  }, [evaluateConditions]);

  // Show loading state while checking
  if (isChecking && conditionsPassed === null) {
    return (
      <div className="interactive-conditional loading" data-testid={testIds.interactive.conditional(conditionalId)}>
        <div className="interactive-conditional-loading">
          <span className="interactive-conditional-spinner spinning">⟳</span>
          <span className="interactive-conditional-loading-text">Checking conditions...</span>
        </div>
      </div>
    );
  }

  // Select the appropriate branch and config based on condition result
  const childrenToRender = conditionsPassed ? whenTrueChildren : whenFalseChildren;
  const sectionConfig = conditionsPassed ? whenTrueSectionConfig : whenFalseSectionConfig;

  // Render as section if display mode is 'section'
  // Uses the full InteractiveSection component for "Do Section" button, step tracking, etc.
  if (display === 'section') {
    // Extract config values, using defaults if not provided
    const sectionTitle = sectionConfig?.title || (conditionsPassed ? 'When conditions pass' : 'When conditions fail');
    const sectionRequirements = sectionConfig?.requirements?.join(',');
    const sectionObjectives = sectionConfig?.objectives?.join(',');

    return (
      <div
        className={`interactive-conditional ${conditionsPassed ? 'conditions-passed' : 'conditions-failed'}`}
        data-testid={testIds.interactive.conditional(conditionalId)}
        data-conditions={conditions.join(', ')}
        data-passed={String(conditionsPassed)}
        data-display="section"
      >
        <InteractiveSection
          title={sectionTitle}
          id={`conditional-${conditionalId}-${conditionsPassed ? 'true' : 'false'}`}
          isSequence={true}
          requirements={sectionRequirements}
          objectives={sectionObjectives}
          className="conditional-section"
        >
          {childrenToRender.map((child, index) =>
            renderElement(child, `${keyPrefix}-${conditionsPassed ? 'true' : 'false'}-${index}`)
          )}
        </InteractiveSection>
      </div>
    );
  }

  // Render inline (default)
  return (
    <div
      className={`interactive-conditional ${conditionsPassed ? 'conditions-passed' : 'conditions-failed'}`}
      data-testid={testIds.interactive.conditional(conditionalId)}
      data-conditions={conditions.join(', ')}
      data-passed={String(conditionsPassed)}
    >
      {childrenToRender.map((child, index) =>
        renderElement(child, `${keyPrefix}-${conditionsPassed ? 'true' : 'false'}-${index}`)
      )}
    </div>
  );
}

// Add display name for debugging
InteractiveConditional.displayName = 'InteractiveConditional';
