/**
 * Type Switch Dropdown
 *
 * Dropdown component that allows switching a block to a different type.
 * Shows only compatible target types based on the conversion matrix.
 * Computes conversion warnings and delegates confirmation to the parent modal.
 */

import React, { useMemo, useCallback } from 'react';
import { Button, Menu, Dropdown, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { BLOCK_TYPE_METADATA } from '../constants';
import { getAvailableConversions, getConversionWarning, ConversionWarning } from '../utils/block-conversion';
import type { BlockType, JsonBlock } from '../types';

// Re-export ConversionWarning for use by BlockFormModal
export type { ConversionWarning };

const getStyles = (theme: GrafanaTheme2) => ({
  menuIcon: css({
    marginRight: theme.spacing(1),
    fontSize: '14px',
  }),
});

export interface TypeSwitchDropdownProps {
  /** Current block type */
  currentType: BlockType;
  /** Called when user selects a new type. Warning is provided if conversion may lose data. */
  onSwitch: (newType: BlockType, warning?: ConversionWarning) => void;
  /** Current block data - used to check for lossy conversions */
  blockData?: JsonBlock;
}

/**
 * Dropdown for switching between compatible block types.
 * Only shows types that can be sensibly converted from the current type.
 * Delegates confirmation UI to the parent modal to avoid nested modal issues.
 */
export function TypeSwitchDropdown({ currentType, onSwitch, blockData }: TypeSwitchDropdownProps) {
  const styles = useStyles2(getStyles);

  // Get available target types for the current block type
  const availableTypes = useMemo(() => getAvailableConversions(currentType), [currentType]);

  // Handle menu item click - compute warning and pass to parent
  const handleSelect = useCallback(
    (type: BlockType) => {
      if (type === currentType) {
        return;
      }

      // Check if this conversion will lose data
      const warning = blockData ? getConversionWarning(blockData, type) : null;
      onSwitch(type, warning ?? undefined);
    },
    [currentType, blockData, onSwitch]
  );

  // Don't render if no conversions available
  if (availableTypes.length === 0) {
    return null;
  }

  const renderMenu = () => (
    <Menu>
      {availableTypes.map((type) => {
        const meta = BLOCK_TYPE_METADATA[type];
        return (
          <Menu.Item
            key={type}
            label={meta.name}
            icon={meta.grafanaIcon as 'file-alt'}
            onClick={() => handleSelect(type)}
          />
        );
      })}
    </Menu>
  );

  return (
    <Dropdown overlay={renderMenu} placement="bottom-start">
      <Button variant="secondary" type="button" icon="exchange-alt" tooltip="Switch to a different block type">
        <span className={styles.menuIcon}>{BLOCK_TYPE_METADATA[currentType].icon}</span>
        Switch type
      </Button>
    </Dropdown>
  );
}

// Add display name for debugging
TypeSwitchDropdown.displayName = 'TypeSwitchDropdown';
