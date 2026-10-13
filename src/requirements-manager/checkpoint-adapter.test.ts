import { createCheckpointAdapter } from './checkpoint-adapter';
import { JsonSectionCheckpointSchema } from '../types/json-guide.schema';

jest.mock('../lib/dom/selector-resolver', () => ({ resolveSelector: (value: string) => value }));

const controller = new AbortController();
const requirements = jest.fn();
const context = jest.fn();
const adapter = () => createCheckpointAdapter(requirements, context, controller.signal);

beforeEach(() => {
  document.body.replaceChildren();
  jest.clearAllMocks();
});

function control(attributes: Record<string, string | undefined>) {
  const element = document.createElement('button');
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      element.setAttribute(key, value);
    }
  }
  element.id = 'control';
  document.body.append(element);
  return element;
}

it.each(['expanded', 'selected'] as const)(
  'restores a %s control only when false, and verifies its actual state',
  async (state) => {
    const element = control({ type: 'button', [`aria-${state}`]: 'false' });
    const click = jest.fn(() => element.setAttribute(`aria-${state}`, 'true'));
    element.addEventListener('click', click);
    const check = { target: '#control', state };
    expect(await adapter().check(check)).toMatchObject({ passed: false, canRestore: true });
    expect(await adapter().restore(check)).toBe(true);
    expect(await adapter().check(check)).toMatchObject({ passed: true });
    await adapter().restore(check);
    expect(click).toHaveBeenCalledTimes(1);
  }
);

it.each([
  { type: 'submit' },
  { type: 'reset' },
  { type: 'button', disabled: '' },
  { type: 'button', 'aria-disabled': 'true' },
])('never clicks an unsafe or disabled control %j', async (attributes) => {
  const element = control({ ...attributes, 'aria-expanded': 'false' });
  const click = jest.fn();
  element.addEventListener('click', click);
  expect(await adapter().restore({ target: '#control', state: 'expanded' })).toBe(false);
  expect(click).not.toHaveBeenCalled();
});

it('refuses ambiguous and missing controls; visibility has no inferred click action', async () => {
  expect(await adapter().check({ target: '#missing', state: 'visible' })).toMatchObject({
    passed: false,
    canRestore: false,
  });
  control({ type: 'button', 'aria-expanded': 'false' });
  control({ type: 'button', 'aria-expanded': 'false' });
  expect(await adapter().restore({ target: '#control', state: 'expanded' })).toBe(false);
});

it('does not treat an unknown or unavailable requirement as readiness', async () => {
  requirements.mockResolvedValue({ pass: true, verdict: 'invalid', error: [] });
  expect(await adapter().check({ requirement: 'unknown:x' })).toMatchObject({ passed: false });
  expect(await adapter().check({ requirement: 'coda-exit-zero:touch file' })).toMatchObject({ passed: false });
  expect(requirements).toHaveBeenCalledTimes(1);
});

it('validates the bounded checkpoint shape and rejects arbitrary replay actions', () => {
  expect(
    JsonSectionCheckpointSchema.safeParse({
      checks: [{ requirement: 'on-page:/dashboards' }, { target: '#options', state: 'expanded' }],
    }).success
  ).toBe(true);
  for (const checks of [
    [],
    [{ action: 'button', target: '#save' }],
    [{ requirement: 'coda-exit-zero:touch file' }],
    [{ requirement: 'exists-reftarget' }],
    [{ target: '#x', state: 'hidden' }],
  ]) {
    expect(JsonSectionCheckpointSchema.safeParse({ checks }).success).toBe(false);
  }
});

it('uses the existing navigation adapter and requires fresh verification', async () => {
  let atPage = false;
  requirements.mockImplementation(async () => ({
    pass: atPage,
    verdict: atPage ? 'satisfied' : 'unsatisfied',
    error: atPage
      ? []
      : [
          {
            requirement: 'on-page:/playlists',
            pass: false,
            canFix: true,
            fixType: 'location',
            targetHref: '/playlists',
          },
        ],
  }));
  const navigate = jest.fn(async () => {
    atPage = true;
    return true;
  });
  context.mockResolvedValue({
    stepId: 'test',
    navigationManager: { fixLocationRequirement: navigate },
    fixNavigationRequirements: jest.fn(),
  });
  const check = { requirement: 'on-page:/playlists' };
  expect(await adapter().check(check)).toMatchObject({ passed: false, canRestore: true });
  expect(await adapter().restore(check)).toBe(true);
  expect(await adapter().check(check)).toMatchObject({ passed: true });
  expect(navigate).toHaveBeenCalledWith('/playlists');
});

it('does not perform a delayed repair after cancellation', async () => {
  const abort = new AbortController();
  requirements.mockResolvedValue({
    pass: false,
    verdict: 'unsatisfied',
    error: [{ pass: false, canFix: true, fixType: 'location', targetHref: '/playlists' }],
  });
  const navigate = jest.fn();
  context.mockImplementation(async () => {
    abort.abort();
    return { stepId: 'test', navigationManager: { fixLocationRequirement: navigate } };
  });
  const delayed = createCheckpointAdapter(requirements, context, abort.signal);
  expect(await delayed.restore({ requirement: 'on-page:/playlists' })).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
});
