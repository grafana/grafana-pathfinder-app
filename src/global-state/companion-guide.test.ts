import { JsonGuideSchema } from '../types/json-guide.schema';
import { closeCompanionGuide, getCompanionGuide, openAuthoringGuide, subscribeCompanionGuide } from './companion-guide';

beforeEach(() => {
  closeCompanionGuide();
  localStorage.clear();
});

afterEach(closeCompanionGuide);

it('opens only the built-in authoring lesson without changing the saved workspace or surface', () => {
  localStorage.setItem('existing-draft', 'keep this draft');
  const before = { ...localStorage };
  openAuthoringGuide();
  const tab = getCompanionGuide()!;
  expect(tab.currentUrl).toBe('bundled:create-your-first-guide/content.json');
  expect(tab.content?.metadata.packageManifest?.repository).toBe('bundled');
  expect(tab.content?.metadata.title).toBe('Create your first interactive guide');
  expect(JsonGuideSchema.safeParse(JSON.parse(tab.content!.content)).success).toBe(true);
  expect({ ...localStorage }).toEqual(before);
});

it('notifies subscribers when the authoring lesson opens or closes', () => {
  const listener = jest.fn();
  const unsubscribe = subscribeCompanionGuide(listener);
  openAuthoringGuide();
  expect(listener).toHaveBeenCalledTimes(1);
  closeCompanionGuide();
  expect(getCompanionGuide()).toBeNull();
  expect(listener).toHaveBeenCalledTimes(2);
  closeCompanionGuide();
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
  openAuthoringGuide();
  expect(listener).toHaveBeenCalledTimes(2);
});

it('keeps publishing out of executable lesson actions', () => {
  openAuthoringGuide();
  const guide = JSON.parse(getCompanionGuide()!.content!.content);
  const blocks = guide.blocks.flatMap((block: { blocks?: unknown[] }) => block.blocks ?? [block]);
  const actions = blocks.flatMap((block: { steps?: unknown[] }) => block.steps ?? [block]);
  for (const action of actions) {
    expect(action.reftarget ?? '').not.toMatch(/publish|delete|new-guide/);
  }
});
