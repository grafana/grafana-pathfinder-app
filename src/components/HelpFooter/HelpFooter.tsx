import React from 'react';
import { Button, LinkButton, useTheme2 } from '@grafana/ui';
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
