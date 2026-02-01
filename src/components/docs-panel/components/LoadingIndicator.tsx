/**
 * Loading indicator component for docs-panel content loading states.
 * Displays a skeleton loader appropriate for the content type.
 */

import React from 'react';
import { SkeletonLoader } from '../../SkeletonLoader';
import { testIds } from '../../testIds';

export interface LoadingIndicatorProps {
  /** The type of content being loaded - affects skeleton layout */
  contentType: 'documentation' | 'learning-journey';
  /** CSS class name for the container */
  className?: string;
}

/**
 * Displays a skeleton loading state for docs-panel content.
 * Uses the SkeletonLoader component with appropriate type based on content.
 */
export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({ contentType, className }) => {
  return (
    <div className={className} data-testid={testIds.docsPanel.loadingState}>
      <SkeletonLoader type={contentType} />
    </div>
  );
};
