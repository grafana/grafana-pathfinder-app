import React from 'react';

import { createCompatRoot } from '../../lib/create-root-compat';

import { AchievementAnnouncementHost } from './AchievementAnnouncements';

const ROOT_ID = 'pathfinder-achievements-root';

export async function mountAchievementAnnouncementHost(): Promise<void> {
  if (document.getElementById(ROOT_ID)) {
    return;
  }
  const container = document.createElement('div');
  container.id = ROOT_ID;
  document.body.appendChild(container);
  try {
    (await createCompatRoot(container)).render(<AchievementAnnouncementHost />);
  } catch (error) {
    container.remove();
    throw error;
  }
}
