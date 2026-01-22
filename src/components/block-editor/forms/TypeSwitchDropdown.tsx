/**
 * Type Switch Dropdown
 *
 * Dropdown component that allows switching a block to a different type.
 * Shows only compatible target types based on the conversion matrix.
 * Shows a confirmation dialog for conversions that may result in data loss.
 */

import React, { useMemo, useCallback, useState } from 'react';
import { Button, Menu, Dropdown, ConfirmModal, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { BLOCK_TYPE_METADATA } from '../constants';
import { getAvailableConversions, getConversionWarning } from '../utils/block-conversion';
import type { BlockType, JsonBlock } from '../types';

const getStyles = (theme: GrafanaTheme2) => ({
  menuIcon: css({
    marginRight: theme.spacing(1),
    fontSize: '14px',
  }),
  warningDetails: css({
    marginTop: theme.spacing(2),
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.warning.transparent,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.warning.border}`,
  }),
  warningFields: css({
    marginTop: theme.spacing(1),
    paddingLeft: theme.spacing(2),
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    '& li': {
      marginBottom: theme.spacing(0.5),
    },
  }),
});

export interface TypeSwitchDropdownProps {
  /** Current block type */
  currentType: BlockType;
  /** Called when user selects a new type */
  onSwitch: (newType: BlockType) => void;
  /** Current block data - used to check for lossy conversions */
  blockData?: JsonBlock;
}

/**
 * Dropdown for switching between compatible block types.
 * Only shows types that can be sensibly converted from the current type.
 * Shows a confirmation dialog when conversion may result in data loss.
 */
export function TypeSwitchDropdown({ currentType, onSwitch, blockData }: TypeSwitchDropdownProps) {
  const styles = useStyles2(getStyles);

  // State for confirmation modal
  const [pendingType, setPendingType] = useState<BlockType | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [warningFields, setWarningFields] = useState<string[]>([]);

  // Get available target types for the current block type
  const availableTypes = useMemo(() => getAvailableConversions(currentType), [currentType]);

  // Handle menu item click - check for lossy conversion
  const handleSelect = useCallback(
    (type: BlockType) => {
      if (type === currentType) {
        return;
      }

      // Check if this conversion will lose data
      if (blockData) {
        const warning = getConversionWarning(blockData, type);
        if (warning) {
          // Show confirmation dialog
          setPendingType(type);
          setWarningMessage(warning.message);
          setWarningFields(warning.lostFields);
          return;
        }
      }

      // No data loss - proceed directly
      onSwitch(type);
    },
    [currentType, blockData, onSwitch]
  );

  // Handle confirmation
  const handleConfirm = useCallback(() => {
    if (pendingType) {
      onSwitch(pendingType);
    }
    setPendingType(null);
    setWarningMessage(null);
    setWarningFields([]);
  }, [pendingType, onSwitch]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    setPendingType(null);
    setWarningMessage(null);
    setWarningFields([]);
  }, []);

  // Don't render if no conversions available
  if (availableTypes.length === 0) {
    return null;
  }

  const pendingTypeMeta = pendingType ? BLOCK_TYPE_METADATA[pendingType] : null;

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
    <>
      <Dropdown overlay={renderMenu} placement="bottom-start">
        <Button variant="secondary" type="button" icon="exchange-alt" tooltip="Switch to a different block type">
          <span className={styles.menuIcon}>{BLOCK_TYPE_METADATA[currentType].icon}</span>
          Switch type
        </Button>
      </Dropdown>

      {/* Confirmation modal for lossy conversions */}
      <ConfirmModal
        isOpen={pendingType !== null}
        title={`Convert to ${pendingTypeMeta?.name}?`}
        body={
          <div>
            <p>{warningMessage}</p>
            {warningFields.length > 0 && (
              <div className={styles.warningDetails}>
                <strong>Fields that will be lost:</strong>
                <ul className={styles.warningFields}>
                  {warningFields.map((field, i) => (
                    <li key={i}>{field}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        }
        confirmText="Convert anyway"
        dismissText="Cancel"
        onConfirm={handleConfirm}
        onDismiss={handleCancel}
      />
    </>
  );
}

// Add display name for debugging
TypeSwitchDropdown.displayName = 'TypeSwitchDropdown';
