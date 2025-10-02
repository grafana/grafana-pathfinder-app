import React from 'react';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { getFeedbackButtonStyles } from '../../styles/feedback-button.styles';
import { useTheme2 } from '@grafana/ui';
import { t } from '@grafana/i18n';

interface FeedbackButtonProps {
  className?: string;
  variant?: 'primary' | 'secondary';
  contentUrl?: string;
  contentType?: string;
  interactionLocation?: string; // Specific location identifier for analytics
  currentMilestone?: number; // For learning journeys - current milestone user is viewing
  totalMilestones?: number; // For learning journeys - total milestones in journey
}

export const FeedbackButton: React.FC<FeedbackButtonProps> = ({
  className,
  variant = 'primary',
  contentUrl = '',
  contentType = '',
  interactionLocation = 'feedback_button', // Default fallback
  currentMilestone,
  totalMilestones,
}) => {
  const theme = useTheme2();
  const styles = getFeedbackButtonStyles(theme);

  const handleClick = () => {
    // Calculate completion percentage if we have milestone data
    const completionPercentage =
      currentMilestone !== undefined && totalMilestones !== undefined && totalMilestones > 0
        ? Math.round((currentMilestone / totalMilestones) * 100)
        : undefined;

    // Track analytics first
    reportAppInteraction(UserInteraction.GeneralPluginFeedbackButton, {
      interaction_location: interactionLocation,
      panel_type: 'combined_learning_journey',
      ...(contentUrl && { content_url: contentUrl }),
      ...(contentType && { content_type: contentType }),
      ...(currentMilestone !== undefined && { current_milestone: currentMilestone }),
      ...(totalMilestones !== undefined && { total_milestones: totalMilestones }),
      ...(completionPercentage !== undefined && { completion_percentage: completionPercentage }),
    });

    // Add small delay to ensure analytics event is sent before opening new tab
    // This prevents the event from being lost when browser opens new tab
    setTimeout(() => {
      window.open(
        'https://docs.google.com/forms/d/e/1FAIpQLSdBvntoRShjQKEOOnRn4_3AWXomKYq03IBwoEaexlwcyjFe5Q/viewform?usp=header',
        '_blank',
        'noopener,noreferrer'
      );
    }, 100); // 100ms delay - imperceptible to users but ensures event is sent
  };

  return (
    <button
      className={`${variant === 'secondary' ? styles.feedbackButtonSecondary : styles.feedbackButtonPrimary} ${
        className || ''
      }`}
      onClick={handleClick}
      aria-label={t('feedbackButton.ariaLabel', 'Give feedback about this plugin')}
      title={t('feedbackButton.title', 'Give feedback about this plugin')}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        aria-hidden="true"
        width="12"
        height="12"
        className={styles.feedbackIcon}
      >
        <path d="M19,2H5A3,3,0,0,0,2,5V15a3,3,0,0,0,3,3H16.59l3.7,3.71A1,1,0,0,0,21,22a.84.84,0,0,0,.38-.08A1,1,0,0,0,22,21V5A3,3,0,0,0,19,2Zm1,16.59-2.29-2.3A1,1,0,0,0,17,16H5a1,1,0,0,1-1-1V5A1,1,0,0,1,5,4H19a1,1,0,0,1,1,1Z"></path>
      </svg>
      <span className={styles.feedbackText}>{t('feedbackButton.text', 'Give feedback')}</span>
    </button>
  );
};
