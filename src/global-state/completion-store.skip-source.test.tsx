import React from 'react';
import { act, render, screen } from '@testing-library/react';

import {
  evictAllContentCaches,
  evictContentCache,
  getGuideCompletionSource,
  markStepCompleted,
  peekGuidePercentage,
  resetCompletionStoreForTests,
  resetSection,
  resetStep,
  resetSteps,
  useStepCompletion,
} from './completion-store';
import { resetContentKeyForTests, setActiveTabUrl } from './content-key';
import { publishGuideIndex } from './active-guide-index';
import { computeGuideBlockIndex } from '../lib/guide-stats';
import { guideCompletionMarkStorage, interactiveStepStorage } from '../lib/user-storage';
import { StorageKeys, buildVersionedSectionStorageKey } from '../lib/storage-keys';

const GUIDE = 'bundled:skip-source';
const SECTION = 'section-one';

function publish() {
  publishGuideIndex({
    contentKey: GUIDE,
    denominatorSource: 'live-pre-inlining',
    index: computeGuideBlockIndex([
      { type: 'interactive', id: 'first' },
      { type: 'interactive', id: 'last' },
    ]),
  });
}

async function completeWithSkip() {
  markStepCompleted('first', SECTION, 'skipped');
  markStepCompleted('last', SECTION, 'objectives');
  await Promise.resolve();
}

beforeEach(async () => {
  localStorage.clear();
  await interactiveStepStorage.clearAll();
  resetCompletionStoreForTests();
  resetContentKeyForTests();
  setActiveTabUrl(GUIDE);
  publish();
});

it('attributes automatic completion to skipped evidence even when the final action succeeds', async () => {
  await completeWithSkip();
  expect(peekGuidePercentage(GUIDE)).toBe(100);
  expect(getGuideCompletionSource(GUIDE)).toBe('skipped');
});

it('keeps ordinary performed actions as objectives', async () => {
  markStepCompleted('last', SECTION, 'manual');
  await Promise.resolve();
  expect(peekGuidePercentage(GUIDE)).toBe(100);
  expect(getGuideCompletionSource(GUIDE)).toBe('objectives');
});

it('restores skip attribution and the sticky step reason after a reload', async () => {
  await completeWithSkip();
  resetCompletionStoreForTests();
  publish();
  expect(getGuideCompletionSource(GUIDE)).toBe('skipped');
  function Probe() {
    const { reason } = useStepCompletion('first', SECTION);
    return <span>{reason ?? 'loading'}</span>;
  }
  render(<Probe />);
  expect(await screen.findByText('skipped')).toBeInTheDocument();
  act(() => markStepCompleted('first', SECTION, 'manual'));
  expect(screen.getByText('skipped')).toBeInTheDocument();
});

it('gives an explicit guide mark priority over skipped evidence', async () => {
  await completeWithSkip();
  await guideCompletionMarkStorage.set(GUIDE, true);
  expect(getGuideCompletionSource(GUIDE)).toBe('manual');
});

it.each(['step', 'tail', 'section', 'guide', 'all'])('clears skip attribution on a %s reset', async (scope) => {
  await completeWithSkip();
  if (scope === 'step') {
    resetStep('first', SECTION);
  } else if (scope === 'tail') {
    resetSteps(['first', 'last'], SECTION);
  } else if (scope === 'section') {
    resetSection(SECTION);
  } else if (scope === 'guide') {
    await interactiveStepStorage.clearAllForContent(GUIDE);
    evictContentCache(GUIDE);
  } else {
    await interactiveStepStorage.clearAll();
    evictAllContentCaches();
  }
  await Promise.resolve();
  expect(getGuideCompletionSource(GUIDE)).toBe('objectives');
  resetCompletionStoreForTests();
  expect(getGuideCompletionSource(GUIDE)).toBe('objectives');
});

it('preserves skip attribution through completion writes that only know the IDs', async () => {
  await completeWithSkip();
  await interactiveStepStorage.setCompleted(GUIDE, SECTION, new Set(['first', 'last']));
  resetCompletionStoreForTests();
  expect(getGuideCompletionSource(GUIDE)).toBe('skipped');
});

it('does not borrow skipped evidence from a prefix-sharing guide or a removed block', async () => {
  await interactiveStepStorage.setCompleted(`${GUIDE}-other`, SECTION, new Set(['first']), new Set(['first']));
  await interactiveStepStorage.setCompleted(GUIDE, SECTION, new Set(['removed']), new Set(['removed']));
  expect(getGuideCompletionSource(GUIDE)).toBe('objectives');
});

it('reads legacy completion arrays without fabricating historical skip reasons', async () => {
  localStorage.setItem(
    buildVersionedSectionStorageKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, GUIDE, SECTION),
    JSON.stringify(['last'])
  );
  expect(await interactiveStepStorage.getCompleted(GUIDE, SECTION)).toEqual(new Set(['last']));
  expect(peekGuidePercentage(GUIDE)).toBe(100);
  expect(getGuideCompletionSource(GUIDE)).toBe('objectives');
});

it('keeps skip attribution for steps that complete before saved progress loads', async () => {
  await completeWithSkip();
  resetCompletionStoreForTests();
  publish();
  let resolveStored: (ids: Set<string>) => void = () => undefined;
  jest
    .spyOn(interactiveStepStorage, 'getCompleted')
    .mockImplementationOnce(() => new Promise((resolve) => (resolveStored = resolve)));
  function Probe() {
    const { reason } = useStepCompletion('first', SECTION);
    return <span>{reason ?? 'loading'}</span>;
  }
  render(<Probe />);

  act(() => markStepCompleted('last', SECTION, 'objectives'));
  await act(async () => resolveStored(new Set(['first', 'last'])));

  expect(await screen.findByText('skipped')).toBeInTheDocument();
  expect(getGuideCompletionSource(GUIDE)).toBe('skipped');
  resetCompletionStoreForTests();
  expect(getGuideCompletionSource(GUIDE)).toBe('skipped');
});

it('drops the skip attribution of a step reset while saved progress loads', async () => {
  await completeWithSkip();
  resetCompletionStoreForTests();
  publish();
  let resolveStored: (ids: Set<string>) => void = () => undefined;
  jest
    .spyOn(interactiveStepStorage, 'getCompleted')
    .mockImplementationOnce(() => new Promise((resolve) => (resolveStored = resolve)));
  function Probe() {
    const { completed } = useStepCompletion('first', SECTION);
    return <span>{completed ? 'done' : 'open'}</span>;
  }
  render(<Probe />);

  act(() => resetStep('first', SECTION));
  act(() => markStepCompleted('last', SECTION, 'objectives'));
  await act(async () => resolveStored(new Set(['first', 'last'])));

  expect(getGuideCompletionSource(GUIDE)).toBe('objectives');
});
