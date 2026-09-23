import { panelModeManager } from '../../global-state/panel-mode';
import React, { useCallback } from 'react';
import { locationService } from '@grafana/runtime';
import { stripPathfinderParams } from '../../utils/pathfinder-search-params';
import { Icon, useStyles2 } from '@grafana/ui';
import { testIds } from '../../constants/testIds';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { getKioskOverlayStyles } from './kiosk-mode.styles';
import type { KioskRule } from './kiosk-rules';
import { parseKioskWebUrl } from '../../security/kiosk-url';
import { isAllowedContentUrl, validateInternalNavigationPath } from '../../security/url-validator';

export type KioskMode = 'instance' | 'presentation';

interface KioskTileProps {
  rule: KioskRule;
  index: number;
  mode?: KioskMode;
  onLaunch?: () => void;
}

export const KioskTile: React.FC<KioskTileProps> = ({ rule, index, mode = 'presentation', onLaunch }) => {
  const styles = useStyles2(getKioskOverlayStyles);

  const handleClick = useCallback(() => {
    const page = rule.page === undefined ? undefined : validateInternalNavigationPath(rule.page);
    if (page === null || !isAllowedContentUrl(rule.url)) {
      return;
    }
    const current = locationService.getLocation();
    const url =
      mode === 'instance'
        ? new URL(page ?? `${current.pathname}${current.search}${current.hash}`, window.location.origin)
        : parseKioskWebUrl(rule.targetUrl || window.location.origin, window.location.origin);
    if (!url) {
      return;
    }
    if (mode === 'presentation') {
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
      url.search = '';
      url.hash = '';
      if (page) {
        url.searchParams.set('page', page);
      }
    } else {
      const orgId = new URLSearchParams(current.search).get('orgId');
      if (orgId && !url.searchParams.has('orgId')) {
        url.searchParams.set('orgId', orgId);
      }
      stripPathfinderParams(url);
      if (page) {
        // The destination query and fragment are already on the URL; prevent a second redirect.
        url.searchParams.set('page', url.pathname);
      }
    }
    const sessionId = crypto.randomUUID();

    reportAppInteraction(UserInteraction.KioskDemoStarted, {
      kiosk_session_id: sessionId,
      guide_url: rule.url,
      guide_title: rule.title,
      guide_type: rule.type,
      launch_mode: mode,
      target_instance: mode === 'instance' ? window.location.origin : rule.targetUrl || window.location.origin,
    });

    url.searchParams.set('doc', rule.url);
    url.searchParams.set('kiosk_session', sessionId);
    if (rule.type === 'learning-journey') {
      url.searchParams.set('type', 'learning-journey');
    }
    if (mode === 'instance') {
      onLaunch?.();
      panelModeManager.setModeTransient('sidebar');
      locationService.push(`${url.pathname}${url.search}${url.hash}`);
    } else {
      window.open(url.toString(), '_blank', 'noopener,noreferrer');
    }
  }, [rule.targetUrl, rule.url, rule.title, rule.type, rule.page, mode, onLaunch]);

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
