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
 */

import React, { useCallback } from 'react';
import { Button, Icon, useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import { t } from '@grafana/i18n';

import { PLUGIN_BASE_URL, ROUTES } from '../../../constants';
import { testIds } from '../../../constants/testIds';

export interface FullScreenModeNoticeProps {
  /**
   * Override what happens when the user clicks "Return to full screen".
   * Defaults to pushing `/a/<plugin>/fullscreen`. Useful in tests.
   */
  onReturn?: () => void;
}

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

export function FullScreenModeNotice({ onReturn }: FullScreenModeNoticeProps = {}) {
  const styles = useStyles2(getStyles);

  const handleReturn = useCallback(() => {
    if (onReturn) {
      onReturn();
      return;
    }
    locationService.push(`${PLUGIN_BASE_URL}/${ROUTES.FullScreen}`);
  }, [onReturn]);

  return (
    <div className={styles.container} data-testid={testIds.fullScreenMode.notice}>
      <div className={styles.iconWrap}>
        <Icon name="expand-arrows" size="xl" />
      </div>
      <h3 className={styles.title}>{t('docsPanel.fullScreenNoticeTitle', 'Pathfinder is in full screen')}</h3>
      <p className={styles.description}>
        {t(
          'docsPanel.fullScreenNoticeBody',
          'Switch tabs in the sidebar to queue the next tab, or jump back to full screen to keep working.'
        )}
      </p>
      <Button
        variant="primary"
        size="sm"
        icon="external-link-alt"
        onClick={handleReturn}
        data-testid={testIds.fullScreenMode.noticeReturnButton}
      >
        {t('docsPanel.fullScreenNoticeReturn', 'Return to full screen')}
      </Button>
    </div>
  );
}
