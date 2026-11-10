import React, { useState } from 'react';

import fallbackBadge from '../../img/achievements/fallback-badge.svg';

interface AchievementBadgeProps {
  artUrl: string | null;
  size: number;
  className?: string;
}

/** Decorative: the title next to it names the achievement. Falls back to the bundled badge on any load error. */
export function AchievementBadge({ artUrl, size, className }: AchievementBadgeProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <img
      src={artUrl && artUrl !== failedUrl ? artUrl : fallbackBadge}
      onError={() => setFailedUrl(artUrl)}
      width={size}
      height={size}
      alt=""
      className={className}
      data-testid="achievement-badge-image"
    />
  );
}
