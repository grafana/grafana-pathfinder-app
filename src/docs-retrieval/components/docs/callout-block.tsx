import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

export interface CalloutBlockProps {
  variant: 'info' | 'warning' | 'success' | 'error';
  title?: string;
  children?: React.ReactNode;
}

const VARIANT_ICONS: Record<string, string> = {
  info: 'ℹ️',
  warning: '⚠️',
  success: '✅',
  error: '❌',
};

const getStyles = (theme: GrafanaTheme2) => {
  const variantColors = {
    info: {
      bg: theme.colors.info.transparent,
      border: theme.colors.info.border,
      text: theme.colors.info.text,
    },
    warning: {
      bg: theme.colors.warning.transparent,
      border: theme.colors.warning.border,
      text: theme.colors.warning.text,
    },
    success: {
      bg: theme.colors.success.transparent,
      border: theme.colors.success.border,
      text: theme.colors.success.text,
    },
    error: {
      bg: theme.colors.error.transparent,
      border: theme.colors.error.border,
      text: theme.colors.error.text,
    },
  };

  return {
    ...Object.fromEntries(
      Object.entries(variantColors).map(([variant, colors]) => [
        variant,
        css({
          backgroundColor: colors.bg,
          borderLeft: `4px solid ${colors.border}`,
          padding: theme.spacing(2),
          marginBottom: theme.spacing(2),
          borderRadius: theme.shape.radius.default,
        }),
      ])
    ),
    title: css({
      fontWeight: theme.typography.fontWeightBold,
      marginBottom: theme.spacing(1),
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
    }),
    content: css({
      '& > *:last-child': {
        marginBottom: 0,
      },
    }),
    icon: css({
      flexShrink: 0,
    }),
  };
};

export function CalloutBlock({ variant, title, children }: CalloutBlockProps) {
  const styles = useStyles2(getStyles);
  const icon = VARIANT_ICONS[variant] || VARIANT_ICONS.info;
  const variantStyle = (styles as Record<string, string>)[variant] || (styles as Record<string, string>).info;

  return (
    <div className={variantStyle}>
      {title && (
        <div className={styles.title}>
          <span className={styles.icon}>{icon}</span>
          <span>{title}</span>
        </div>
      )}
      <div className={styles.content}>{children}</div>
    </div>
  );
}
