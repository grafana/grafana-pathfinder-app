import React, { useState } from 'react';
import { Button, LinkButton, useTheme2, Icon, Modal } from '@grafana/ui';
import { useHelpNavItem, config } from '@grafana/runtime';
import { t } from '@grafana/i18n';
import { getHelpFooterStyles } from '../../styles/help-footer.styles';

interface HelpFooterProps {
  className?: string;
}

export const HelpFooter: React.FC<HelpFooterProps> = ({ className }) => {
  const theme = useTheme2();
  const styles = getHelpFooterStyles(theme);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const helpNode = typeof useHelpNavItem !== 'undefined' ? useHelpNavItem() : null;
  const useHelpNavItemAvailable = typeof useHelpNavItem !== 'undefined' && helpNode !== null;

  const helpButtons = React.useMemo(() => {
    if (useHelpNavItemAvailable && helpNode?.children && helpNode.children.length > 0) {
      return helpNode.children.map((child: any) => ({
        key: child.id || child.text.toLowerCase().replace(/\s+/g, '-'),
        label: child.text,
        icon: (child.icon || 'question-circle') as any,
        href: child.url,
        target: child.target,
        onClick: child.onClick,
      }));
    }
    return [];
  }, [useHelpNavItemAvailable, helpNode]);

  const versionInfo = React.useMemo(() => {
    if (useHelpNavItemAvailable && helpNode?.subTitle) {
      return helpNode.subTitle;
    }
    return null;
  }, [useHelpNavItemAvailable, helpNode]);

  // Check if useHelpNavItem is available for backwards compatibility
  if (!useHelpNavItemAvailable) {
    // Old implementation for backwards compatibility
    const handleKeyboardShortcuts = () => {
      setIsHelpModalOpen(true);
    };

    const handleCloseHelpModal = () => {
      setIsHelpModalOpen(false);
    };

    const helpButtons = [
      {
        key: 'documentation',
        label: t('helpFooter.buttons.documentation', 'Documentation'),
        icon: 'file-alt' as const,
        href: 'https://grafana.com/docs/grafana/latest/?utm_source=grafana_footer',
      },
      {
        key: 'support',
        label: t('helpFooter.buttons.support', 'Support'),
        icon: 'question-circle' as const,
        href: 'https://grafana.com/support/?utm_source=grafana_footer',
      },
      {
        key: 'community',
        label: t('helpFooter.buttons.community', 'Community'),
        icon: 'comments-alt' as const,
        href: 'https://community.grafana.com/?utm_source=grafana_footer',
      },
      {
        key: 'enterprise',
        label: t('helpFooter.buttons.enterprise', 'Enterprise'),
        icon: 'external-link-alt' as const,
        href: 'https://grafana.com/products/enterprise/?utm_source=grafana_footer',
      },
      {
        key: 'download',
        label: t('helpFooter.buttons.download', 'Download'),
        icon: 'download-alt' as const,
        href: 'https://grafana.com/grafana/download?utm_source=grafana_footer',
      },
      {
        key: 'shortcuts',
        label: t('helpFooter.buttons.shortcuts', 'Shortcuts'),
        icon: 'keyboard' as const,
        onClick: handleKeyboardShortcuts,
      },
    ];

    return (
      <div className={`${styles.helpFooter} ${className || ''}`}>
        <div className={styles.helpButtons}>
          {helpButtons.map((button) => {
            const ButtonComponent = button.href ? 'a' : 'button';
            const buttonProps = button.href
              ? {
                  href: button.href,
                  target: '_blank',
                  rel: 'noopener noreferrer',
                }
              : {
                  onClick: button.onClick,
                  type: 'button' as const,
                };

            return (
              <ButtonComponent key={button.key} className={styles.helpButton} {...buttonProps}>
                <div className={styles.helpButtonContent}>
                  <Icon name={button.icon} size="sm" className={styles.helpButtonIcon} />
                  <span className={styles.helpButtonText}>{button.label}</span>
                </div>
              </ButtonComponent>
            );
          })}
        </div>

        {/* Version info */}
        {config.buildInfo && (
          <div className={styles.versionInfo}>
            <div className={styles.versionText}>
              Grafana v{config.buildInfo.version} ({config.buildInfo.commit?.substring(0, 10) || 'unknown'})
            </div>
          </div>
        )}

        {/* Keyboard Shortcuts Modal */}
        {isHelpModalOpen && (
          <Modal
            title={t('helpFooter.modal.keyboardShortcuts', 'Keyboard Shortcuts')}
            isOpen={isHelpModalOpen}
            onDismiss={handleCloseHelpModal}
          >
            <div style={{ minWidth: '500px', padding: '16px' }}>
              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ marginBottom: '8px' }}>{t('helpFooter.modal.globalShortcuts', 'Global Shortcuts')}</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '8px', fontSize: '14px' }}>
                  <div>
                    <kbd
                      style={{
                        padding: '2px 6px',
                        backgroundColor: theme.colors.background.secondary,
                        border: `1px solid ${theme.colors.border.medium}`,
                        borderRadius: '3px',
                      }}
                    >
                      ?
                    </kbd>
                  </div>
                  <div>{t('helpFooter.modal.showAllShortcuts', 'Show all keyboard shortcuts')}</div>
                  <div>
                    <kbd
                      style={{
                        padding: '2px 6px',
                        backgroundColor: theme.colors.background.secondary,
                        border: `1px solid ${theme.colors.border.medium}`,
                        borderRadius: '3px',
                      }}
                    >
                      g h
                    </kbd>
                  </div>
                  <div>{t('helpFooter.modal.goToHomeDashboard', 'Go to Home Dashboard')}</div>
                  <div>
                    <kbd
                      style={{
                        padding: '2px 6px',
                        backgroundColor: theme.colors.background.secondary,
                        border: `1px solid ${theme.colors.border.medium}`,
                        borderRadius: '3px',
                      }}
                    >
                      g d
                    </kbd>
                  </div>
                  <div>{t('helpFooter.modal.goToDashboards', 'Go to Dashboards')}</div>
                  <div>
                    <kbd
                      style={{
                        padding: '2px 6px',
                        backgroundColor: theme.colors.background.secondary,
                        border: `1px solid ${theme.colors.border.medium}`,
                        borderRadius: '3px',
                      }}
                    >
                      esc
                    </kbd>
                  </div>
                  <div>{t('helpFooter.modal.exitEditViews', 'Exit edit/setting views')}</div>
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ marginBottom: '8px' }}>
                  {t('helpFooter.modal.dashboardShortcuts', 'Dashboard Shortcuts')}
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '8px', fontSize: '14px' }}>
                  <div>
                    <kbd
                      style={{
                        padding: '2px 6px',
                        backgroundColor: theme.colors.background.secondary,
                        border: `1px solid ${theme.colors.border.medium}`,
                        borderRadius: '3px',
                      }}
                    >
                      d r
                    </kbd>
                  </div>
                  <div>{t('helpFooter.modal.refreshAllPanels', 'Refresh all panels')}</div>
                  <div>
                    <kbd
                      style={{
                        padding: '2px 6px',
                        backgroundColor: theme.colors.background.secondary,
                        border: `1px solid ${theme.colors.border.medium}`,
                        borderRadius: '3px',
                      }}
                    >
                      d s
                    </kbd>
                  </div>
                  <div>{t('helpFooter.modal.dashboardSettings', 'Dashboard settings')}</div>
                  <div>
                    <kbd
                      style={{
                        padding: '2px 6px',
                        backgroundColor: theme.colors.background.secondary,
                        border: `1px solid ${theme.colors.border.medium}`,
                        borderRadius: '3px',
                      }}
                    >
                      d v
                    </kbd>
                  </div>
                  <div>{t('helpFooter.modal.toggleViewMode', 'Toggle view mode')}</div>
                </div>
              </div>

              <div
                style={{ fontSize: '12px', color: theme.colors.text.secondary, marginTop: '16px', fontStyle: 'italic' }}
              >
                {t(
                  'helpFooter.modal.simplifiedView',
                  "This is a simplified view. You can replace this with Grafana's full HelpModal component."
                )}
              </div>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  // New implementation using useHelpNavItem

  if (helpButtons.length === 0) {
    return null;
  }

  return (
    <div className={`${styles.helpFooter} ${className || ''}`}>
      <div className={styles.helpButtons}>
        {helpButtons.map((button: any) => {
          if (button.href) {
            return (
              <LinkButton
                key={button.key}
                variant="secondary"
                size="sm"
                icon={button.icon}
                href={button.href}
                target={button.target || '_blank'}
              >
                {button.label}
              </LinkButton>
            );
          }

          return (
            <Button key={button.key} variant="secondary" size="sm" icon={button.icon} onClick={button.onClick}>
              {button.label}
            </Button>
          );
        })}
      </div>

      {versionInfo && (
        <div className={styles.versionInfo}>
          <div className={styles.versionText}>{versionInfo}</div>
        </div>
      )}
    </div>
  );
};
