import React from 'react';
import { Button, ButtonGroup } from '@grafana/ui';
import type { ViewMode } from '../types';
import { testIds } from '../../../constants/testIds';

export interface ViewModeRockerProps {
  viewMode: ViewMode;
  onSetViewMode: (mode: ViewMode) => void;
}

/** Edit / Preview / JSON view-mode toggle. */
export function ViewModeRocker({ viewMode, onSetViewMode }: ViewModeRockerProps) {
  return (
    <ButtonGroup data-testid={testIds.blockEditor.viewModeToggle}>
      <Button
        variant={viewMode === 'edit' ? 'primary' : 'secondary'}
        size="sm"
        icon="pen"
        onClick={() => onSetViewMode('edit')}
        tooltip="Edit"
      />
      <Button
        variant={viewMode === 'preview' ? 'primary' : 'secondary'}
        size="sm"
        icon="eye"
        onClick={() => onSetViewMode('preview')}
        tooltip="Preview"
      />
      <Button
        variant={viewMode === 'json' ? 'primary' : 'secondary'}
        size="sm"
        icon="brackets-curly"
        onClick={() => onSetViewMode('json')}
        tooltip="JSON"
      />
    </ButtonGroup>
  );
}

ViewModeRocker.displayName = 'ViewModeRocker';
