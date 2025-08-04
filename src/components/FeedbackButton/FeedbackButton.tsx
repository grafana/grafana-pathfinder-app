import React from 'react';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { getFeedbackButtonStyles } from '../../styles/feedback-button.styles';
import { useTheme2 } from '@grafana/ui';

interface FeedbackButtonProps {
  className?: string;
}

export const FeedbackButton: React.FC<FeedbackButtonProps> = ({ className }) => {
  const theme = useTheme2();
  const styles = getFeedbackButtonStyles(theme);

  const handleClick = () => {
    reportAppInteraction(UserInteraction.GeneralPluginFeedbackButton, {
      interaction_location: 'feedback_button',
      panel_type: 'combined_learning_journey'
    });
    window.open('https://docs.google.com/forms/d/e/1FAIpQLSdBvntoRShjQKEOOnRn4_3AWXomKYq03IBwoEaexlwcyjFe5Q/viewform?usp=header', '_blank', 'noopener,noreferrer');
  };

  return (
    <button
      className={`${styles.feedbackButton} ${className || ''}`}
      onClick={handleClick}
      aria-label="Give feedback about this plugin"
      title="Give feedback about this plugin"
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
      <span className={styles.feedbackText}>Give feedback</span>
    </button>
  );
}; 