import React from 'react';
import { Icon, useTheme2 } from '@grafana/ui';
import { useHelpNavItem } from '@grafana/runtime';
import { getHelpFooterStyles } from '../../styles/help-footer.styles';

interface HelpFooterProps {
  className?: string;
}

export const HelpFooter: React.FC<HelpFooterProps> = ({ className }) => {
  const theme = useTheme2();
  const styles = getHelpFooterStyles(theme);
  const helpNode = useHelpNavItem();

  const helpButtons = React.useMemo(() => {
    if (helpNode?.children && helpNode.children.length > 0) {
      return helpNode.children.map((child) => ({
        key: child.id || child.text.toLowerCase().replace(/\s+/g, '-'),
        label: child.text,
        icon: (child.icon || 'question-circle') as any,
        href: child.url,
        target: child.target,
        onClick: child.onClick,
      }));
    }

    return [];
  }, [helpNode]);

  const versionInfo = React.useMemo(() => {
    if (helpNode?.subTitle) {
      return helpNode.subTitle;
    }
    return null;
  }, [helpNode]);

  if (helpButtons.length === 0) {
    return null;
  }

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

      {versionInfo && (
        <div className={styles.versionInfo}>
          <div className={styles.versionText}>{versionInfo}</div>
        </div>
      )}
    </div>
  );
};
