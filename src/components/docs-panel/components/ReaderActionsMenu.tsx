import React from 'react';
import { Dropdown, IconButton, Menu } from '@grafana/ui';
import { t } from '@grafana/i18n';

import { testIds } from '../../../constants/testIds';
import { usePanelModeControls } from '../../../global-state/use-panel-mode';

interface ReaderActionsMenuProps {
  onOpen?: () => void;
  openAriaLabel?: string;
  onOpenController?: () => void;
  onReset?: () => Promise<void> | void;
  showPanelModeActions?: boolean;
}

export function ReaderActionsMenu({
  onOpen,
  openAriaLabel,
  onOpenController,
  onReset,
  showPanelModeActions = true,
}: ReaderActionsMenuProps) {
  const { panelMode, handleTogglePanelMode, handleGoFullScreen } = usePanelModeControls();

  const kebabMenu = (
    <Menu>
      {onOpenController && (
        <Menu.Item
          label={t('docsPanel.openControllerInNewTab', 'Open in interactive window')}
          icon="external-link-alt"
          testId={testIds.docsPanel.openControllerTabButton}
          onClick={onOpenController}
        />
      )}
      {onOpen && (
        <Menu.Item
          label={t('docsPanel.open', 'Open')}
          ariaLabel={openAriaLabel}
          icon="external-link-alt"
          onClick={onOpen}
        />
      )}
      {onReset && (
        <Menu.Item
          label={t('docsPanel.resetGuide', 'Reset guide')}
          icon="history-alt"
          testId={testIds.docsPanel.resetGuideButton}
          onClick={onReset}
        />
      )}
      {showPanelModeActions && (onOpenController || onOpen || onReset) && <Menu.Divider />}
      {showPanelModeActions && (
        <Menu.Item
          label={panelMode === 'sidebar' ? t('docsPanel.popOut', 'Pop out') : t('docsPanel.dock', 'Dock')}
          ariaLabel={panelMode === 'sidebar' ? 'Pop out to floating panel' : 'Dock guide'}
          icon={panelMode === 'sidebar' ? 'corner-up-right' : 'corner-down-right-alt'}
          onClick={handleTogglePanelMode}
          testId={testIds.docsPanel.popOutButton}
        />
      )}
      {showPanelModeActions && panelMode !== 'fullscreen' && (
        <Menu.Item
          label={t('docsPanel.fullScreen', 'Full screen')}
          ariaLabel="Open in full screen"
          icon="expand-arrows"
          onClick={handleGoFullScreen}
          testId={testIds.docsPanel.fullScreenButton}
        />
      )}
    </Menu>
  );

  return (
    <Dropdown overlay={kebabMenu} placement="bottom-end">
      <IconButton
        size="md"
        name="ellipsis-v"
        tooltip={t('docsPanel.moreActions', 'More actions')}
        data-testid={testIds.docsPanel.milestoneMoreActionsButton}
      />
    </Dropdown>
  );
}
