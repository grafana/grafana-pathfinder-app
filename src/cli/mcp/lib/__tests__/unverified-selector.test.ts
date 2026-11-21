import type { ContentJson } from '../../../../types/package.types';
import type { CommandOutcome } from '../../../utils/output';
import { dropVerifiedSelectorWarnings } from '../unverified-selector';

const outcome = (): CommandOutcome =>
  ({
    status: 'ok',
    warnings: [{ code: 'UNVERIFIED_SELECTOR', message: 'unverified', path: 'blocks[0]/reftarget' }],
  }) as unknown as CommandOutcome;

const contentWith = (block: Record<string, unknown>) =>
  ({ id: 'g', title: 'G', blocks: [{ type: 'interactive', content: 'Go', ...block }] }) as unknown as ContentJson;

describe('dropVerifiedSelectorWarnings', () => {
  it('drops the warning for a navigate action written under its alias', () => {
    const result = dropVerifiedSelectorWarnings(
      outcome(),
      contentWith({ targetAction: 'navigate', refTarget: '/dash' }),
      new Set()
    );
    expect(result).toEqual({ status: 'ok' });
  });

  it('keeps the warning for an unknown selector with a non-navigate action', () => {
    const result = dropVerifiedSelectorWarnings(
      outcome(),
      contentWith({ action: 'highlight', reftarget: '[data-testid="guess"]' }),
      new Set()
    );
    expect(result.status === 'ok' && result.warnings).toHaveLength(1);
  });
});
