import React from 'react';
import { render } from '@testing-library/react';
import {
  lookupGuideIdentity,
  __resetGuideIdentityRegistryForTests,
} from '../../completion-records/guide-identity-registry';
import { useGuideIdentityRegistration } from './useGuideIdentityRegistration';

jest.mock('../../completion-records', () => jest.requireActual('../../completion-records/guide-identity-registry'));
jest.mock('../../docs-retrieval', () => ({
  resolveSurfaceGuideIdentity: () => ({
    guideSource: 'bundled',
    guideId: 'g',
    guideTitle: 'G',
    guideCategory: 'interactive',
  }),
}));
jest.mock('../../global-state/guide-content-key', () => ({ resolveGuideContentKey: () => 'bundled:g' }));

function Surface() {
  useGuideIdentityRegistration('bundled:g', { contentUrl: 'bundled:g', metadata: { title: 'G' } });
  return null;
}

beforeEach(() => __resetGuideIdentityRegistryForTests());

it('keeps the original mounted surface registered after a temporary surface disappears', () => {
  const view = render(
    <>
      <Surface key="fullscreen" />
      <Surface key="sidebar-notice" />
    </>
  );
  expect(lookupGuideIdentity('bundled:g')?.guideId).toBe('g');
  view.rerender(
    <>
      <Surface key="fullscreen" />
    </>
  );
  expect(lookupGuideIdentity('bundled:g')?.guideId).toBe('g');
  view.unmount();
  expect(lookupGuideIdentity('bundled:g')).toBeNull();
});
