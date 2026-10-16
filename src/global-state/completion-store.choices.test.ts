import type { JsonBlock } from '../types/json-guide.types';
import { computeGuideBlockIndex } from '../lib/guide-stats';
import { createChoiceProgressModel, CHOICE_COMPLETION_VARIABLE } from '../lib/guide-stats/choice-progress';
import { guideCompletionMarkStorage, guideResponseStorage, interactiveCompletionStorage } from '../lib/user-storage';
import { resetGuideProgress } from '../components/docs-panel/hooks/resetGuideProgress';
import { subscribeProgressEvent } from './progress-events';
import { evictAllContentCaches, peekGuidePercentage, refreshAndNotifyGuideProgress } from './completion-store';
import {
  publishGuideIndex,
  setGuideChoiceResponses,
  setGuideSectionVisibility,
  getHiddenGuideSections,
} from './active-guide-index';

const key = 'bundled:choice-progress-regression';
const blocks: JsonBlock[] = [
  {
    type: 'input',
    inputType: 'checkbox-group',
    variableName: 'signals',
    prompt: 'Signals?',
    choices: [{ id: 'logs', text: 'Logs' }],
  },
  { type: 'markdown', id: 'common', content: 'Common content' },
  {
    type: 'section',
    id: 'logs',
    requirements: ['var-signals:includes:logs'],
    whenRequirementsUnmet: 'hide',
    blocks: [{ type: 'markdown', id: 'logs-step', content: 'Logs' }],
  },
];

function publish(guideBlocks = blocks) {
  const index = computeGuideBlockIndex(guideBlocks);
  publishGuideIndex({
    contentKey: key,
    index,
    denominatorSource: 'live-pre-inlining',
    choiceModel: createChoiceProgressModel(guideBlocks, index),
  });
}

beforeEach(() => {
  localStorage.clear();
  evictAllContentCaches();
});
afterEach(() => {
  jest.restoreAllMocks();
  evictAllContentCaches();
  localStorage.clear();
});

it('does not persist or announce optional-choice completion before saved responses hydrate', async () => {
  await guideCompletionMarkStorage.set(key, true, ['common']);
  publish();
  const set = jest.spyOn(interactiveCompletionStorage, 'set');
  const events = jest.fn();
  const unsubscribe = subscribeProgressEvent(events);
  try {
    refreshAndNotifyGuideProgress(key);
    expect(peekGuidePercentage(key)).toBe(0);
    expect(set).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
    setGuideChoiceResponses(key, { signals: 'logs' });
    refreshAndNotifyGuideProgress(key);
    await Promise.resolve();
    expect(peekGuidePercentage(key)).toBeLessThan(100);
    expect(set).toHaveBeenCalledWith(key, 66);
    expect(events.mock.calls.some(([event]) => event.percentage === 100)).toBe(false);
  } finally {
    unsubscribe();
  }
});

it('waits for environment visibility, including a still-checking section', async () => {
  await guideCompletionMarkStorage.set(key, true, ['common']);
  publish(
    blocks.map((block) =>
      block.type === 'section' ? { ...block, requirements: ['has-datasource:prometheus'] } : block
    )
  );
  setGuideChoiceResponses(key, {});
  const set = jest.spyOn(interactiveCompletionStorage, 'set');
  expect(getHiddenGuideSections(key).has('section-logs')).toBe(false);
  refreshAndNotifyGuideProgress(key);
  expect(set).not.toHaveBeenCalled();
  setGuideSectionVisibility(key, 'section-logs', undefined);
  refreshAndNotifyGuideProgress(key);
  expect(set).not.toHaveBeenCalled();
  setGuideSectionVisibility(key, 'section-logs', true);
  refreshAndNotifyGuideProgress(key);
  expect(peekGuidePercentage(key)).toBe(66);
  setGuideSectionVisibility(key, 'section-logs', false);
  refreshAndNotifyGuideProgress(key);
  expect(peekGuidePercentage(key)).toBe(100);
  set.mockClear();
  setGuideSectionVisibility(key, 'section-logs', undefined);
  refreshAndNotifyGuideProgress(key);
  expect(peekGuidePercentage(key)).toBe(0);
  expect(set).not.toHaveBeenCalled();
});

it('clears marked-path evidence on reset and ignores obsolete snapshots in input responses', async () => {
  await guideCompletionMarkStorage.set(key, true, ['common', 'logs-step']);
  await guideCompletionMarkStorage.set('bundled:other-choice', true, ['other-step']);
  await guideResponseStorage.setResponse('choice-guide', 'signals', 'logs');
  publish();
  const responses = { signals: 'logs', [CHOICE_COMPLETION_VARIABLE]: JSON.stringify(['common', 'logs-step']) };
  setGuideChoiceResponses(key, responses);
  expect(peekGuidePercentage(key)).toBe(100);
  await resetGuideProgress(key);
  expect(guideCompletionMarkStorage.getChoiceCompletionKeys(key)).toEqual([]);
  expect(guideCompletionMarkStorage.getChoiceCompletionKeys('bundled:other-choice')).toEqual(['other-step']);
  await expect(guideResponseStorage.getForGuide('choice-guide')).resolves.toEqual({ signals: 'logs' });
  publish();
  setGuideChoiceResponses(key, responses);
  expect(peekGuidePercentage(key)).toBe(33);
});
