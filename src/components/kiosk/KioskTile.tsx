import { launchKioskGuide } from './launch-kiosk-guide';
import React, { useCallback } from 'react';
import { Icon, useStyles2 } from '@grafana/ui';
import { testIds } from '../../constants/testIds';
import { getKioskOverlayStyles } from './kiosk-mode.styles';
import type { KioskRule } from './kiosk-rules';

import type { KioskMode } from '../../types/kiosk-page.schema';

interface KioskTileProps {
  rule: KioskRule;
  index: number;
  mode?: KioskMode;
  onLaunch?: () => void;
}

export const KioskTile: React.FC<KioskTileProps> = ({ rule, index, mode = 'presentation', onLaunch }) => {
  const styles = useStyles2(getKioskOverlayStyles);

  const handleClick = useCallback(() => {
    launchKioskGuide(rule, mode, onLaunch);
  }, [rule, mode, onLaunch]);

  return (
    <button type="button" className={styles.tile} onClick={handleClick} data-testid={testIds.kioskMode.tile(index)}>
      <span className={styles.tileIconRow}>
        <span className={styles.tileIcon}>
          <Icon name="compass" size="lg" />
        </span>
        <span className={styles.tileBadge}>{rule.type}</span>
      </span>
      <span className={styles.tileTitle} data-testid={testIds.kioskMode.tileTitle(index)}>
        {rule.title}
      </span>
      <span className={styles.tileDescription}>{rule.description}</span>
      <span className={styles.tileArrow}>
        <span>Launch guide</span>
        <Icon name="arrow-right" size="sm" />
      </span>
    </button>
  );
};
