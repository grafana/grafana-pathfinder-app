import React, { useState } from 'react';
import { Icon, useTheme2, Modal } from '@grafana/ui';
import { config } from '@grafana/runtime';
import { t } from '@grafana/i18n';
import { NavModelItem } from '@grafana/data';
import { getHelpFooterStyles } from '../../styles/help-footer.styles';

interface HelpFooterProps {
  className?: string;
  helpNode?: NavModelItem;
}

export const HelpFooter: React.FC<HelpFooterProps> = ({ className, helpNode }) => {
  const theme = useTheme2();
  const styles = getHelpFooterStyles(theme);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  const handleKeyboardShortcuts = () => {
    setIsHelpModalOpen(true);
  };

  const handleCloseHelpModal = () => {
    setIsHelpModalOpen(false);
  };

  // Used when helpNode isn't provided.
  const defaultHelpButtons = [
    {
      key: 'documentation',
      label: t('helpFooter.buttons.documentation', 'Documentation'),
      icon: 'file-alt' as const,
      href: 'https://grafana.com/docs/grafana/latest/?utm_source=grafana_footer',
      target: '_blank',
    },
    {
      key: 'support',
      label: t('helpFooter.buttons.support', 'Support'),
      icon: 'question-circle' as const,
      href: 'https://grafana.com/support/?utm_source=grafana_footer',
      target: '_blank',
    },
    {
      key: 'community',
      label: t('helpFooter.buttons.community', 'Community'),
      icon: 'comments-alt' as const,
      href: 'https://community.grafana.com/?utm_source=grafana_footer',
      target: '_blank',
    },
    {
      key: 'enterprise',
      label: t('helpFooter.buttons.enterprise', 'Enterprise'),
      icon: 'external-link-alt' as const,
      href: 'https://grafana.com/products/enterprise/?utm_source=grafana_footer',
      target: '_blank',
    },
    {
      key: 'download',
      label: t('helpFooter.buttons.download', 'Download'),
      icon: 'download-alt' as const,
      href: 'https://grafana.com/grafana/download?utm_source=grafana_footer',
      target: '_blank',
      },
    {
      key: 'shortcuts',
      label: t('helpFooter.buttons.shortcuts', 'Shortcuts'),
      icon: 'keyboard' as const,
      onClick: handleKeyboardShortcuts,
      target: '_blank',
    },
  ];

  const helpButtons = React.useMemo(() => {
    if (helpNode?.children && helpNode.children.length > 0) {
      return helpNode.children
        .filter((child) => child.text && (child.url || child.onClick))
        .map((child, index) => ({
          key: child.id || `help-${index}`,
          label: child.text || '',
          icon: (child.icon || 'question-circle') as any,
          href: child.url,
          target: child.target,
          onClick: child.onClick,
        }));
    }
    return defaultHelpButtons;
  }, [helpNode]);

  return (
    <div className={`${styles.helpFooter} ${className || ''}`}>
      <div className={styles.helpButtons}>
        {helpButtons.map((button) => {
          const ButtonComponent = button.href ? 'a' : 'button';
          const buttonProps = button.href
            ? {
                href: button.href,
                target: button.target || '_blank',
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
              <h3 style={{ marginBottom: '8px' }}>{t('helpFooter.modal.dashboardShortcuts', 'Dashboard Shortcuts')}</h3>
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
};
