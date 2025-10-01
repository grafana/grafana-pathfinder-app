import React from 'react';
// @ts-expect-error - Icon kept available as core Grafana UI component
import { Button, Alert, Icon, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2, usePluginContext } from '@grafana/data';
import { css } from '@emotion/css';
import { locationService } from '@grafana/runtime';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { getConfigWithDefaults } from '../../constants';

interface EnableRecommenderBannerProps {
  className?: string;
}

export const EnableRecommenderBanner: React.FC<EnableRecommenderBannerProps> = ({ className }) => {
  const styles = useStyles2(getStyles);
  const context = usePluginContext();
  const configWithDefaults = getConfigWithDefaults(context?.meta?.jsonData || {});

  // Only show if recommender is disabled (uses centralized config with platform defaults)
  if (configWithDefaults.acceptedTermsAndConditions) {
    return null;
  }

  const handleEnableRecommender = () => {
    reportAppInteraction(UserInteraction.EnableRecommendationsBanner, {
      interaction_location: 'enable_recommender_banner',
      action: 'navigate_to_recommendations_config',
    });

    // Navigate to the Recommendations configuration tab
    // Use query parameter format as shown in the URL
    locationService.push('/plugins/grafana-grafanadocsplugin-app?page=recommendations-config');
  };

  return (
    <div className={`${styles.container} ${className || ''}`}>
      <Alert title="" severity="info" className={styles.alert}>
        <div className={styles.content}>
          <div className={styles.message}>
            <div className={styles.messageText}>
              <strong>Context-aware recommendations are disabled</strong>
              <p>
                Enable recommendations based on your current Grafana context for more relevant documentation
                suggestions.
              </p>
            </div>
          </div>
          <div className={styles.action}>
            <Button
              variant="primary"
              size="sm"
              onClick={handleEnableRecommender}
              icon="cog"
              className={styles.enableButton}
            >
              Go to plugin configuration
            </Button>
          </div>
        </div>
      </Alert>
    </div>
  );
};

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    marginTop: theme.spacing(3),
    marginBottom: theme.spacing(2),
    display: 'flex',
    justifyContent: 'center',
    width: '100%',
  }),
  alert: css({
    maxWidth: '600px',
    width: '100%',
    margin: '0 auto',
    '& > div': {
      padding: `${theme.spacing(2)} ${theme.spacing(2.5)}`,
      display: 'flex',
      justifyContent: 'center',
    },
  }),
  content: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    width: '100%',
  }),
  message: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    width: '100%',
    textAlign: 'center',
  }),
  messageText: css({
    width: '100%',
    textAlign: 'center',
    '& > strong': {
      display: 'block',
      color: theme.colors.text.primary,
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      marginBottom: theme.spacing(0.5),
      textAlign: 'center',
    },
    '& > p': {
      margin: 0,
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: theme.typography.bodySmall.lineHeight,
      textAlign: 'center',
    },
  }),
  action: css({
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }),
  enableButton: css({
    whiteSpace: 'nowrap',
  }),
});
