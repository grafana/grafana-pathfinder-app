/**
 * Shared badge icon component
 *
 * Renders either an emoji character or a Grafana Icon depending on the badge.
 * Eliminates the duplicated `badge.emoji ? <span> : <Icon>` conditional
 * across BadgesDisplay, BadgeUnlockedToast, MyLearningTab, and BadgeDetailCard.
 */

import React from 'react';
import { Icon, type IconSize } from '@grafana/ui';

interface BadgeIconProps {
  /** Emoji character (rendered when present) */
  emoji?: string;
  /** Grafana icon name (fallback when no emoji) */
  icon: string;
  /** Grafana Icon size — only used for the Icon fallback */
  size: IconSize;
  /** CSS class applied to the emoji <span> */
  emojiClassName?: string;
  /** CSS class applied to the Icon */
  iconClassName?: string;
}

export function BadgeIcon({ emoji, icon, size, emojiClassName, iconClassName }: BadgeIconProps) {
  if (emoji) {
    return <span className={emojiClassName}>{emoji}</span>;
  }
  return <Icon name={icon as any} size={size} className={iconClassName} />;
}
