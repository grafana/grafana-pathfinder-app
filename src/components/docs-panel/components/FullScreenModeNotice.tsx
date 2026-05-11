/**
 * FullScreenModeNotice — placeholder rendered in the sidebar's content area
 * when Pathfinder is currently mounted in full-screen mode on this browser
 * session.
 *
 * Why this exists: the extension sidebar can be opened by Grafana's nav at
 * any time (browser refresh on a docked sidebar, the user toggling the
 * extension, etc.). Without this gate, the sidebar would mount a *second*
 * `CombinedLearningJourneyPanel` instance that races the full-screen
 * instance on the shared `tabStorage` keys — drift. Rendering this notice
 * instead keeps the tab bar interactive (so users can switch tabs and queue
 * the next active tab for full-screen) while keeping content fetch /
 * milestone state ownership with the full-screen instance.
 *
 * Includes a "Return to sidebar" CTA: switches panelMode back to 'sidebar'
 * so this surface takes over rendering. If the user is currently sitting on
 * the dedicated `/fullscreen` route, we also navigate away to the prior
 * route — otherwise the FullScreenPanel stays mounted on that page and the
 * user would re-enter fullscreen on next refresh.
 */

import React, { useCallback } from 'react';
import { Button, Icon, useStyles2 } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { t } from '@grafana/i18n';

import { testIds } from '../../../constants/testIds';
import { panelModeManager } from '../../../global-state/panel-mode';
import { PLUGIN_BASE_URL, ROUTES } from '../../../constants';

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(2),
    padding: theme.spacing(4, 2),
    textAlign: 'center',
    color: theme.colors.text.secondary,
  }),
  iconWrap: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  title: css({
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    margin: 0,
  }),
  description: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    margin: 0,
    maxWidth: '320px',
    lineHeight: 1.4,
  }),
});

export function FullScreenModeNotice() {
  const styles = useStyles2(getStyles);

  const handleReturnToSidebar = useCallback(() => {
    panelModeManager.setMode('sidebar');
    const fullScreenPath = `${PLUGIN_BASE_URL}/${ROUTES.FullScreen}`;
    if (window.location.pathname.startsWith(fullScreenPath)) {
      const priorPath = panelModeManager.consumePriorPath();
      locationService.push(priorPath ?? PLUGIN_BASE_URL);
    }
  }, []);

  return (
    <div className={styles.container} data-testid={testIds.fullScreenMode.notice}>
      <div className={styles.iconWrap}>
        <Icon name="expand-arrows" size="xl" />
      </div>
      <h3 className={styles.title}>{t('docsPanel.fullScreenNoticeTitle', 'Pathfinder is in full screen')}</h3>
      <p className={styles.description}>
        {t(
          'docsPanel.fullScreenNoticeBody',
          'Switch tabs in the sidebar to queue what shows the next time you return to the full-screen page.'
        )}
      </p>
      <Button
        variant="secondary"
        size="sm"
        icon="arrow-left"
        onClick={handleReturnToSidebar}
        data-testid={testIds.fullScreenMode.noticeReturnButton}
      >
        {t('docsPanel.fullScreenNoticeReturn', 'Return to sidebar')}
      </Button>
    </div>
  );
}
