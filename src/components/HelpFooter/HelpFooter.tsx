import React from 'react';
import { Button, LinkButton, useTheme2 } from '@grafana/ui';
import { useHelpNavItem } from '@grafana/runtime';
import { getHelpFooterStyles } from '../../styles/help-footer.styles';
import { testIds } from '../../constants/testIds';

interface HelpFooterProps {
  className?: string;
  variant?: 'default' | 'compact';
}

export const HelpFooter: React.FC<HelpFooterProps> = ({ className, variant = 'default' }) => {
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

  const compact = variant === 'compact';

  return (
    <div
      className={`${compact ? styles.compactFooter : styles.helpFooter} ${className || ''}`}
      data-testid={testIds.helpFooter.container}
    >
      <div className={compact ? styles.compactLinks : styles.helpButtons}>
        {helpButtons.map((button: any, index: number) => {
          const common = {
            variant: 'secondary' as const,
            size: 'sm' as const,
            icon: compact ? undefined : button.icon,
            className: compact ? styles.compactLink : undefined,
          };
          if (button.href) {
            return (
              <LinkButton
                key={button.key}
                {...common}
                href={button.href}
                target={button.target || '_blank'}
                data-testid={testIds.helpFooter.link(index)}
              >
                {button.label}
              </LinkButton>
            );
          }

          return (
            <Button key={button.key} {...common} onClick={button.onClick} data-testid={testIds.helpFooter.link(index)}>
              {button.label}
            </Button>
          );
        })}
      </div>

      {versionInfo &&
        (compact ? (
          <div className={styles.compactVersion}>{versionInfo}</div>
        ) : (
          <div className={styles.versionInfo}>
            <div className={styles.versionText}>{versionInfo}</div>
          </div>
        ))}
    </div>
  );
};
