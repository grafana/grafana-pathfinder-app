import React, { useCallback } from 'react';
import { Icon, useStyles2 } from '@grafana/ui';
import { testIds } from '../../constants/testIds';
import { getKioskOverlayStyles } from './kiosk-mode.styles';
import type { KioskRule } from './kiosk-rules';

interface KioskTileProps {
  rule: KioskRule;
  index: number;
}

export const KioskTile: React.FC<KioskTileProps> = ({ rule, index }) => {
  const styles = useStyles2(getKioskOverlayStyles);

  const handleClick = useCallback(() => {
    const base = (rule.targetUrl || window.location.origin).replace(/\/+$/, '');
    const docParam = encodeURIComponent(rule.url);
    window.open(`${base}/?doc=${docParam}`, '_blank', 'noopener,noreferrer');
  }, [rule.targetUrl, rule.url]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick]
  );

  return (
    <div
      className={styles.tile}
      style={{ animationDelay: `${index * 0.05}s` }}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      data-testid={testIds.kioskMode.tile(index)}
    >
      <div className={styles.tileIconRow}>
        <div className={styles.tileIcon}>
          <Icon name="compass" size="lg" />
        </div>
        <span className={styles.tileBadge}>{rule.type}</span>
      </div>
      <h3 className={styles.tileTitle} data-testid={testIds.kioskMode.tileTitle(index)}>
        {rule.title}
      </h3>
      <p className={styles.tileDescription}>{rule.description}</p>
      <div className={styles.tileArrow}>
        <span>Launch guide</span>
        <Icon name="arrow-right" size="sm" />
      </div>
    </div>
  );
};
