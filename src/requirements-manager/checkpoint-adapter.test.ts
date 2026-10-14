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

it('resolves targets written with enhanced selectors', async () => {
  const element = control({ type: 'button', 'aria-expanded': 'false' });
  element.textContent = 'Options';
  const click = jest.fn(() => element.setAttribute('aria-expanded', 'true'));
  element.addEventListener('click', click);
  const check = { target: 'button:contains("Options")', state: 'expanded' } as const;
  expect(await adapter().check(check)).toMatchObject({ passed: false, canRestore: true });
  expect(await adapter().restore(check)).toBe(true);
  expect(await adapter().check(check)).toMatchObject({ passed: true });
});

it('restores the same controls that recovery recipes may replay', async () => {
  const element = document.createElement('div');
  element.id = 'control';
  element.setAttribute('role', 'button');
  element.setAttribute('aria-expanded', 'false');
  element.addEventListener('click', () => element.setAttribute('aria-expanded', 'true'));
  document.body.append(element);
  expect(await adapter().check({ target: '#control', state: 'expanded' })).toMatchObject({ canRestore: true });
  expect(await adapter().restore({ target: '#control', state: 'expanded' })).toBe(true);
});

it('keeps gating on missing controls; visibility has no inferred click action', async () => {
  expect(await adapter().check({ target: '#missing', state: 'visible' })).toMatchObject({
    passed: false,
    canRestore: false,
  });
});

it('stops gating on targets the guide cannot verify, without clicking anything', async () => {
  const first = control({ type: 'button', 'aria-expanded': 'false' });
  const second = control({ type: 'button', 'aria-expanded': 'false' });
  const click = jest.fn();
  first.addEventListener('click', click);
  second.addEventListener('click', click);
  const ambiguous = { target: '#control', state: 'expanded' } as const;
  expect(await adapter().check(ambiguous)).toEqual({ passed: true, canRestore: false, unverifiable: 'ambiguous' });
  expect(await adapter().restore(ambiguous)).toBe(true);
  second.remove();
  first.removeAttribute('aria-expanded');
  expect(await adapter().check(ambiguous)).toEqual({
    passed: true,
    canRestore: false,
    unverifiable: 'no-state-attribute',
  });
  expect(click).not.toHaveBeenCalled();
});

it('does not treat an unknown or unavailable requirement as readiness', async () => {
  requirements.mockResolvedValue({ pass: true, verdict: 'invalid', error: [] });
  expect(await adapter().check({ requirement: 'on-page:/explore' })).toMatchObject({ passed: false });
  expect(await adapter().check({ requirement: 'unknown:x' })).toMatchObject({ passed: false });
  expect(await adapter().check({ requirement: 'coda-exit-zero:touch file' })).toMatchObject({ passed: false });
  expect(await adapter().check({ requirement: 'has-datasource:loki' })).toMatchObject({ passed: false });
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

it('requires explicit replay eligibility and live objectives for recovery actions', () => {
  const step = {
    action: 'button',
    reftarget: '#open-dialog',
    replaySafe: true,
    objectives: [{ target: '#dialog', state: 'visible' }],
  };
  const parse = (recovery: unknown) =>
    JsonSectionCheckpointSchema.safeParse({ checks: [{ target: '#dialog', state: 'visible', recover: [recovery] }] });
  expect(parse(step).success).toBe(true);
  expect(parse({ ...step, replaySafe: false }).success).toBe(false);
  expect(parse({ ...step, objectives: [] }).success).toBe(false);
  expect(parse({ ...step, objectives: [{ requirement: 'section-completed:old-step' }] }).success).toBe(false);
  expect(parse({ ...step, objectives: [{ requirement: 'coda-exit-zero:touch file' }] }).success).toBe(false);
  expect(parse({ ...step, action: 'formfill', targetvalue: 'overwrite' }).success).toBe(false);
});

describe('returning to the page the checkpoint last passed on', () => {
  const navigate = jest.fn(async () => true);
  beforeEach(() => {
    requirements.mockResolvedValue({
      pass: false,
      verdict: 'unsatisfied',
      error: [{ pass: false, canFix: true, fixType: 'location', targetHref: '/explore' }],
    });
    context.mockResolvedValue({ stepId: 'test', navigationManager: { fixLocationRequirement: navigate } });
  });

  it('keeps the query the learner had, without re-opening a guide', async () => {
    const restoring = createCheckpointAdapter(requirements, context, controller.signal, {
      lastReadyUrl: () => '/explore?schemaVersion=1&panes=%7B%22a%22%3A1%7D&doc=bundled%3Aother',
    });
    await restoring.restore({ requirement: 'on-page:/explore' });
    expect(navigate).toHaveBeenCalledWith('/explore?schemaVersion=1&panes=%7B%22a%22%3A1%7D');
  });

  it('uses the required path when the last ready page was somewhere else', async () => {
    const restoring = createCheckpointAdapter(requirements, context, controller.signal, {
      lastReadyUrl: () => '/dashboards?folder=current',
    });
    await restoring.restore({ requirement: 'on-page:/explore' });
    expect(navigate).toHaveBeenCalledWith('/explore');
  });
});

it('accepts only live page-state requirements in checks and objectives', () => {
  const parse = (requirement: string) =>
    JsonSectionCheckpointSchema.safeParse({
      checks: [
        {
          requirement,
          recover: [{ action: 'navigate', reftarget: '/explore', replaySafe: true, objectives: [{ requirement }] }],
        },
      ],
    }).success;
  expect(parse('on-page:/explore')).toBe(true);
  expect(parse('navmenu-open')).toBe(true);
  expect(parse('dashboard-group-by:abc:filter:job')).toBe(true);
  expect(parse('has-datasource:prometheus')).toBe(false);
  expect(parse('has-plugin:grafana-clock-panel')).toBe(false);
  expect(parse('is-admin')).toBe(false);
});
