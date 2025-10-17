import React, { useState } from 'react';
import { Button } from '@grafana/ui';

export interface ExpandableTableProps {
  defaultCollapsed?: boolean;
  toggleText?: string;
  className?: string;
  children?: React.ReactNode;
  isCollapseSection?: boolean; // Flag to identify collapse sections
}

export function ExpandableTable({
  defaultCollapsed = false,
  toggleText,
  className,
  children,
  isCollapseSection = false,
}: ExpandableTableProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  // If this is a collapse section, render with the proper CSS structure
  if (isCollapseSection) {
    return (
      <div className={`journey-collapse${className ? ` ${className}` : ''}`}>
        <button onClick={() => setIsCollapsed(!isCollapsed)} className="journey-collapse-trigger" type="button">
          <span>{toggleText || 'Toggle section'}</span>
          <span className={`journey-collapse-icon${isCollapsed ? ' collapsed' : ''}`}>▼</span>
        </button>
        {!isCollapsed && <div className="journey-collapse-content">{children}</div>}
      </div>
    );
  }

  // Original expandable table implementation for other cases
  return (
    <div className={`expandable-table${className ? ` ${className}` : ''}`}>
      <Button
        onClick={() => setIsCollapsed(!isCollapsed)}
        variant="secondary"
        size="sm"
        className="expandable-table-toggle-btn"
      >
        {toggleText || (isCollapsed ? 'Expand table' : 'Collapse table')}
      </Button>
      <div className={`expandable-table-content${isCollapsed ? ' collapsed' : ''}`}>{children}</div>
    </div>
  );
}
