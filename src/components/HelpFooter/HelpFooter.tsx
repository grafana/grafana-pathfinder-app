import React from 'react';
import { Icon, useTheme2 } from '@grafana/ui';
import { getHelpFooterStyles } from '../../styles/help-footer.styles';
import { useGrafanaHelpMenu } from '../../utils/help-menu.hook';

interface HelpFooterProps {
  className?: string;
}

export const HelpFooter: React.FC<HelpFooterProps> = ({ className }) => {
  const theme = useTheme2();
  const styles = getHelpFooterStyles(theme);

  // Get help menu data from Grafana's nav state
  const helpMenuData = useGrafanaHelpMenu();

  // Only render if we have menu items
  if (helpMenuData.items.length === 0) {
    return null;
  }

  return (
    <div className={`${styles.helpFooter} ${className || ''}`}>
      <div className={styles.helpButtons}>
        {helpMenuData.items.map((button) => {
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

      {/* Version info from help node subtitle */}
      {helpMenuData.subtitle && (
        <div className={styles.versionInfo}>
          <div className={styles.versionText}>
            {helpMenuData.subtitle}
          </div>
        </div>
      )}
    </div>
  );
};
