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
  /**
   * Called synchronously BEFORE type switch begins, to set dismiss guard.
   *
   * This prevents a race condition where Grafana's nested modal cleanup
   * can trigger the parent modal's onDismiss before the type switch completes.
   * Must be called BEFORE any React state updates that would close the ConfirmModal.
   *
   * @see BlockFormProps.onPrepareTypeSwitch for detailed explanation
   */
  onPrepareTypeSwitch?: () => void;
}

/**
 * Dropdown for switching between compatible block types.
 * Only shows types that can be sensibly converted from the current type.
 * Shows a confirmation dialog when conversion may result in data loss.
 *
 * IMPORTANT: This component handles a tricky nested modal timing issue.
 * When the ConfirmModal closes, Grafana's modal cleanup can trigger dismiss
 * events on the parent modal. The onPrepareTypeSwitch callback must be called
 * SYNCHRONOUSLY before any state changes to set a dismiss guard in the parent.
 *
 * @see TypeSwitchDropdownProps.onPrepareTypeSwitch for the full explanation
 */
export function TypeSwitchDropdown({
  currentType,
  onSwitch,
  blockData,
  onPrepareTypeSwitch,
}: TypeSwitchDropdownProps) {
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
          // Show confirmation dialog - no guard needed yet, user must confirm first
          setPendingType(type);
          setWarningMessage(warning.message);
          setWarningFields(warning.lostFields);
          return;
        }
      }

      // No data loss - proceed directly
      // CRITICAL: Set dismiss guard BEFORE any deferred operations.
      // Even without ConfirmModal, the Dropdown closing could trigger events.
      onPrepareTypeSwitch?.();
      // Defer to next tick so Dropdown can close before form remounts
      setTimeout(() => onSwitch(type), 0);
    },
    [currentType, blockData, onSwitch, onPrepareTypeSwitch]
  );

  /**
   * Handle confirmation from the data loss warning dialog.
   *
   * CRITICAL TIMING: This function must set the dismiss guard SYNCHRONOUSLY
   * before clearing pendingType. Here's why:
   *
   * The execution order is:
   *   1. onPrepareTypeSwitch() - sets guard in parent (SYNCHRONOUS)
   *   2. setPendingType(null) - schedules React update
   *   3. React batched update runs - ConfirmModal receives isOpen=false
   *   4. ConfirmModal unmounts, Grafana cleanup runs
   *   5. Cleanup might trigger parent's handleDismiss - but guard is already set!
   *   6. setTimeout fires, type switch proceeds
   *
   * Without step 1, the guard wouldn't be set until step 6, and the parent
   * modal would close at step 5.
   */
  const handleConfirm = useCallback(() => {
    const typeToSwitch = pendingType;

    // CRITICAL: Set dismiss guard SYNCHRONOUSLY, BEFORE any state changes.
    // This must happen before setPendingType(null) which triggers React update
    // and ConfirmModal unmount. Grafana's modal cleanup during unmount can
    // fire onDismiss on the parent modal - the guard prevents that dismissal.
    onPrepareTypeSwitch?.();

    // Now safe to close the ConfirmModal - guard is already set
    setPendingType(null);
    setWarningMessage(null);
    setWarningFields([]);

    // Defer the actual switch to next tick so modal closes gracefully before form remounts
    if (typeToSwitch) {
      setTimeout(() => onSwitch(typeToSwitch), 0);
    }
  }, [pendingType, onSwitch, onPrepareTypeSwitch]);

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
