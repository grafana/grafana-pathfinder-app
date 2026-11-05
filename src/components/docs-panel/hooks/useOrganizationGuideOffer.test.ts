import { act, renderHook } from '@testing-library/react';
import { useOrganizationGuideOffer } from './useOrganizationGuideOffer';
import {
  offerOrganizationGuide,
  organizationGuideRendered,
  type OrganizationGuideOffer,
} from '../../../global-state/organization-guide-offer';
import type { LearningJourneyTab } from '../../../types/content-panel.types';

const makeModel = () => ({
  restoreTabsAsync: jest.fn().mockResolvedValue(undefined),
  getActiveTab: jest.fn(() => ({ type: 'recommendations' }) as LearningJourneyTab),
  openDocsPage: jest.fn().mockResolvedValue('intro'),
});
let offer: OrganizationGuideOffer;
beforeEach(() => {
  offer = {
    url: 'backend-guide:welcome',
    title: 'Welcome',
    content: {} as never,
    canLaunch: jest.fn(() => true),
    rendered: jest.fn(),
  };
  offerOrganizationGuide(offer);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => offerOrganizationGuide(null));

it('waits for tab restoration, opens prepared content, and counts only the matching rendered tab', async () => {
  const model = makeModel();
  await act(async () => {
    renderHook(() => useOrganizationGuideOffer(model, true));
  });
  expect(model.openDocsPage).toHaveBeenCalledWith(offer.url, offer.title, {
    source: 'organization_guide',
    preparedContent: offer.content,
  });
  expect(offer.rendered).not.toHaveBeenCalled();
  organizationGuideRendered('different');
  expect(offer.rendered).not.toHaveBeenCalled();
  organizationGuideRendered('intro');
  expect(offer.rendered).toHaveBeenCalledTimes(1);
});

it.each(['restored-guide', 'user-intent', 'floating', 'unmounted'])(
  'preserves %s instead of consuming a late offer',
  async (condition) => {
    const model = makeModel();
    if (condition === 'restored-guide') {
      model.getActiveTab.mockReturnValue({ type: 'docs' } as LearningJourneyTab);
    }
    if (condition === 'user-intent') {
      jest.mocked(offer.canLaunch).mockReturnValue(false);
    }
    let finish!: () => void;
    if (condition === 'unmounted') {
      model.restoreTabsAsync.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      );
    }
    const view = renderHook(() => useOrganizationGuideOffer(model, condition !== 'floating'));
    await act(async () => {
      if (condition === 'unmounted') {
        view.unmount();
        finish();
      }
    });
    expect(model.openDocsPage).not.toHaveBeenCalled();
  }
);
