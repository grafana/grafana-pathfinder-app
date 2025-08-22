import React, { useState } from 'react';
import { Icon, useTheme2, Modal } from '@grafana/ui';
import { config } from '@grafana/runtime';
import { getHelpFooterStyles } from '../../styles/help-footer.styles';

interface HelpFooterProps {
  className?: string;
}

export const HelpFooter: React.FC<HelpFooterProps> = ({ className }) => {
  const theme = useTheme2();
  const styles = getHelpFooterStyles(theme);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  const handleKeyboardShortcuts = () => {
    setIsHelpModalOpen(true);
  };

  const handleCloseHelpModal = () => {
    setIsHelpModalOpen(false);
  };

  const helpButtons = [
    {
      key: 'documentation',
      label: 'Documentation',
      icon: 'file-alt' as const,
      href: 'https://grafana.com/docs/grafana/latest/?utm_source=grafana_footer',
    },
    {
      key: 'support',
      label: 'Support',
      icon: 'question-circle' as const,
      href: 'https://grafana.com/products/enterprise/?utm_source=grafana_footer',
    },
    {
      key: 'community',
      label: 'Community',
      icon: 'comments-alt' as const,
      href: 'https://community.grafana.com/?utm_source=grafana_footer',
    },
    {
      key: 'enterprise',
      label: 'Enterprise',
      icon: 'external-link-alt' as const,
      href: 'https://grafana.com/products/enterprise/?utm_source=grafana_footer',
    },
    {
      key: 'download',
      label: 'Download',
      icon: 'download-alt' as const,
      href: 'https://grafana.com/grafana/download?utm_source=grafana_footer',
    },
    {
      key: 'shortcuts',
      label: 'Shortcuts',
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
        <Modal title="Keyboard Shortcuts" isOpen={isHelpModalOpen} onDismiss={handleCloseHelpModal}>
          <div style={{ minWidth: '500px', padding: '16px' }}>
            <div style={{ marginBottom: '16px' }}>
              <h3 style={{ marginBottom: '8px' }}>Global Shortcuts</h3>
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
                <div>Show all keyboard shortcuts</div>
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
                <div>Go to Home Dashboard</div>
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
                <div>Go to Dashboards</div>
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
                <div>Exit edit/setting views</div>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <h3 style={{ marginBottom: '8px' }}>Dashboard Shortcuts</h3>
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
                <div>Refresh all panels</div>
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
                <div>Dashboard settings</div>
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
                <div>Toggle view mode</div>
              </div>
            </div>

            <div
              style={{ fontSize: '12px', color: theme.colors.text.secondary, marginTop: '16px', fontStyle: 'italic' }}
            >
              This is a simplified view. You can replace this with Grafana&apos;s full HelpModal component.
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
