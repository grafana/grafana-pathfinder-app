import { readFileSync } from 'fs';
import { join } from 'path';

import { testIds } from '../../constants/testIds';

const source = readFileSync(join(__dirname, 'BadgeUnlockedToast.tsx'), 'utf-8');

describe('Badge unlocked toast E2E contract', () => {
  it('keeps the guide-runner test IDs stable', () => {
    expect(testIds.learningPaths.badgeToast).toBe('learning-paths-badge-toast');
    expect(testIds.learningPaths.badgeToastDismiss).toBe('learning-paths-badge-toast-dismiss');
  });

  it('uses both guide-runner test IDs in the component source', () => {
    expect(source).toContain('data-testid={testIds.learningPaths.badgeToast}');
    expect(source).toContain('data-testid={testIds.learningPaths.badgeToastDismiss}');
  });
});
