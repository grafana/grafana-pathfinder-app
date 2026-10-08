import { launchKioskGuide } from './launch-kiosk-guide';
import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Icon, useStyles2 } from '@grafana/ui';
import { getGuideProgressRevision, subscribeGuideProgressRevision } from '../../global-state/progress-events';
import { interactiveCompletionStorage, journeyCompletionStorage } from '../../lib/user-storage';
import { sanitizeContentKey } from '../../global-state/content-key';
import { testIds } from '../../constants/testIds';
import { getKioskOverlayStyles } from './kiosk-mode.styles';
import type { KioskRule } from './kiosk-rules';

import type { KioskMode } from '../../types/kiosk-page.schema';

interface KioskTileProps {
  rule: KioskRule;
  index: number;
  mode?: KioskMode;
  onLaunch?: () => void;
  blockIndex?: number;
}

export const KioskTile: React.FC<KioskTileProps> = ({ rule, index, mode = 'presentation', onLaunch, blockIndex }) => {
  const styles = useStyles2(getKioskOverlayStyles);
  const revision = useSyncExternalStore(subscribeGuideProgressRevision, getGuideProgressRevision);
  const [progress, setProgress] = useState<{ url: string; type: string; percentage: number }>();
  const sameInstance =
    mode === 'instance' ||
    !rule.targetUrl ||
    new URL(rule.targetUrl, window.location.origin).origin === window.location.origin;
  useEffect(() => {
    if (!sameInstance || rule.interactiveLearning === false) {
      return;
    }
    let cancelled = false;
    const storage = rule.type === 'learning-journey' ? journeyCompletionStorage : interactiveCompletionStorage;
    void storage.get(rule.type === 'learning-journey' ? rule.url : sanitizeContentKey(rule.url)).then((value) => {
      if (!cancelled) {
        const percentage = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.floor(value))) : 0;
        setProgress({ url: rule.url, type: rule.type, percentage });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [rule.url, rule.type, rule.interactiveLearning, sameInstance, revision]);
  const percentage =
    rule.interactiveLearning !== false && sameInstance && progress?.url === rule.url && progress.type === rule.type
      ? progress.percentage
      : undefined;

  const handleClick = useCallback(() => {
    launchKioskGuide(rule, mode, onLaunch, undefined, blockIndex);
  }, [rule, mode, onLaunch, blockIndex]);

  return (
    <button type="button" className={styles.tile} onClick={handleClick} data-testid={testIds.kioskMode.tile(index)}>
      <span className={styles.tileIconRow}>
        <span className={styles.tileIcon}>
          <Icon name="compass" size="lg" />
        </span>
        <span className={styles.tileBadge}>{rule.interactiveLearning === false ? 'Product' : rule.type}</span>
      </span>
      <span className={styles.tileTitle} data-testid={testIds.kioskMode.tileTitle(index)}>
        {rule.title}
      </span>
      <span className={styles.tileDescription}>{rule.description}</span>
      {percentage !== undefined && (
        <span className={styles.tileProgress} data-complete={percentage === 100}>
          {percentage === 100 && <Icon name="check-circle" size="sm" aria-hidden="true" />}
          <span>{percentage}% complete</span>
        </span>
      )}
      <span className={styles.tileArrow}>
        <span>{rule.interactiveLearning === false ? 'Open product' : 'Launch guide'}</span>
        <Icon name="arrow-right" size="sm" />
      </span>
    </button>
  );
};
