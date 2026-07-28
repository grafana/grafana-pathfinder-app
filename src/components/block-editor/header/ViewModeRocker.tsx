import React from 'react';
import { RadioButtonGroup, useStyles2 } from '@grafana/ui';
import type { SelectableValue } from '@grafana/data';
import type { ViewMode } from '../types';
import { testIds } from '../../../constants/testIds';
import { getHeaderStyles } from './header.styles';

export interface ViewModeRockerProps {
  viewMode: ViewMode;
  onSetViewMode: (mode: ViewMode) => void;
}

const LABELED_OPTIONS: Array<SelectableValue<ViewMode>> = [
  { value: 'edit', label: 'Edit', icon: 'pen' },
  { value: 'preview', label: 'Preview', icon: 'eye' },
  { value: 'json', label: 'JSON', icon: 'brackets-curly' },
];

// Same options without visible labels. `ariaLabel` names each radio for screen
// readers and e2e locators; `description` restores the hover tooltip that the
// old icon rocker had (RadioButton renders `description` as a Tooltip), so the
// collapsed icon-only rocker stays discoverable for sighted users.
const ICON_ONLY_OPTIONS: Array<SelectableValue<ViewMode>> = [
  { value: 'edit', icon: 'pen', ariaLabel: 'Edit', description: 'Edit' },
  { value: 'preview', icon: 'eye', ariaLabel: 'Preview', description: 'Preview' },
  { value: 'json', icon: 'brackets-curly', ariaLabel: 'JSON', description: 'JSON' },
];

/**
 * Edit / Preview / JSON view-mode toggle.
 *
 * Renders two sibling `RadioButtonGroup`s — one labeled, one icon-only — inside a
 * single testid wrapper, and swaps between them purely with a container query
 * (see `getHeaderStyles`). `RadioButtonGroup` has no built-in label collapse, and
 * hiding its internal label spans via CSS would couple us to `@grafana/ui`'s
 * markup; two groups toggled by `display: none` keep that decoupled and drop the
 * hidden group from the accessibility tree, so only one set of radios is exposed.
 */
export function ViewModeRocker({ viewMode, onSetViewMode }: ViewModeRockerProps) {
  const styles = useStyles2(getHeaderStyles);
  return (
    <div className={styles.viewModeRocker} data-testid={testIds.blockEditor.viewModeToggle}>
      <RadioButtonGroup
        className={styles.viewModeRockerLabeled}
        size="sm"
        options={LABELED_OPTIONS}
        value={viewMode}
        onChange={onSetViewMode}
      />
      <RadioButtonGroup
        className={styles.viewModeRockerIconOnly}
        size="sm"
        options={ICON_ONLY_OPTIONS}
        value={viewMode}
        onChange={onSetViewMode}
      />
    </div>
  );
}

ViewModeRocker.displayName = 'ViewModeRocker';
