import { workflowReadyCheck } from './workflow';
import { CLOUD_TOKEN_OBJECTIVE } from '../../lib/workflow-objectives';
import { parseJsonGuide } from '../../docs-retrieval/json-parser';
import { CompletionCoordinator, type ObservationStep } from '../../global-state/observation/coordinator';
import { checkPostconditions } from '../requirements-checker.utils';
import { locationService } from '@grafana/runtime';

const page = 'on-page:/a/grafana-collector-app/alloy';
const block = {
  type: 'guided',
  id: 'name-and-create-token',
  content: 'Name and create a token',
  steps: [
    { action: 'formfill', reftarget: '#tokenName', requirements: ['exists-reftarget', page], validateInput: false },
    { action: 'button', reftarget: 'Create token', requirements: ['exists-reftarget', page] },
  ],
};

function parse(override = {}) {
  const result = parseJsonGuide(
    JSON.stringify({ id: 'token-demo', title: 'Token demo', blocks: [{ ...block, ...override }] })
  );
  expect(result.isValid).toBe(true);
  return result.data!.elements.find((element) => element.type === 'interactive-guided')!.props;
}

function tokenForm(success = false) {
  const form = document.createElement('form');
  const input = document.createElement('input');
  input.id = 'tokenName';
  input.dataset.testid = 'generate-token-name-input';
  input.disabled = success;
  form.append(input);
  if (success) {
    const marker = document.createElement('div');
    marker.dataset.testid = 'generate-token-success-message';
    form.append(marker);
  }
  document.body.append(form);
  return form;
}

const settle = async () => {
  for (let index = 0; index < 40; index++) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  document.body.replaceChildren();
  jest.spyOn(locationService, 'getLocation').mockReturnValue({
    pathname: '/a/grafana-collector-app/alloy',
    search: '',
    hash: '',
    state: null,
  });
});

afterEach(() => jest.restoreAllMocks());

it('infers objectives on the original two-action block without changing authored JSON', () => {
  expect(parse().objectives).toEqual([page, CLOUD_TOKEN_OBJECTIVE]);
  expect(parse({ type: 'guided', objectives: ['has-datasources'] }).objectives).toEqual(['has-datasources']);
  expect(parse({ objectives: [] }).objectives).toBeUndefined();
});

it('also wires multistep and standalone submit blocks, preserving explicit verification', () => {
  const standalone = {
    type: 'interactive',
    action: 'button',
    reftarget: '[data-testid="generate-token-submit-button"]',
    content: 'Create token',
    requirements: [page],
  };
  const result = parseJsonGuide(
    JSON.stringify({
      id: 'token-demo',
      title: 'Token demo',
      blocks: [{ ...block, type: 'multistep' }, standalone, { ...standalone, verify: 'has-datasources' }],
    })
  );
  expect(result.isValid).toBe(true);
  const elements = result.data!.elements;
  expect(elements[0]!.props.objectives).toEqual([page, CLOUD_TOKEN_OBJECTIVE]);
  expect(elements[1]!.props.objectives).toEqual([page, CLOUD_TOKEN_OBJECTIVE]);
  expect(elements[2]!.props.objectives).toBeUndefined();
  expect(elements[2]!.props.postVerify).toBe('has-datasources');
});

it('requires a visible success marker in the same unique product form', async () => {
  const form = tokenForm();
  form.querySelector('input')!.disabled = true;
  expect((await workflowReadyCheck(CLOUD_TOKEN_OBJECTIVE)).verdict).toBe('unsatisfied');
  const outside = document.createElement('div');
  outside.dataset.testid = 'generate-token-success-message';
  document.body.append(outside);
  expect((await workflowReadyCheck(CLOUD_TOKEN_OBJECTIVE)).pass).toBe(false);
  form.append(outside);
  expect((await workflowReadyCheck(CLOUD_TOKEN_OBJECTIVE)).pass).toBe(true);
  outside.style.display = 'none';
  expect((await workflowReadyCheck(CLOUD_TOKEN_OBJECTIVE)).pass).toBe(false);
});

it('does not read field values or success text, or expose either in the result', async () => {
  const form = tokenForm(true);
  Object.defineProperty(form, 'innerHTML', {
    get: () => {
      throw new Error('Do not read form contents');
    },
  });
  Object.defineProperty(form.querySelector('input'), 'value', {
    get: () => {
      throw new Error('Do not read values');
    },
  });
  Object.defineProperty(form.querySelector('div'), 'textContent', {
    get: () => {
      throw new Error('Do not read text');
    },
  });
  expect(await workflowReadyCheck(CLOUD_TOKEN_OBJECTIVE)).toEqual({
    requirement: CLOUD_TOKEN_OBJECTIVE,
    pass: true,
    verdict: 'satisfied',
    error: undefined,
  });
});

it('fails closed for missing, ambiguous, hidden, or guide-owned forms and unsupported checks', async () => {
  expect((await workflowReadyCheck(CLOUD_TOKEN_OBJECTIVE)).verdict).toBe('unavailable');
  const form = tokenForm(true);
  form.dataset.pathfinderContent = 'true';
  expect((await workflowReadyCheck(CLOUD_TOKEN_OBJECTIVE)).verdict).toBe('unavailable');
  delete form.dataset.pathfinderContent;
  form.style.display = 'none';
  expect((await workflowReadyCheck(CLOUD_TOKEN_OBJECTIVE)).verdict).toBe('unavailable');
  form.style.display = '';
  tokenForm(true);
  expect((await workflowReadyCheck(CLOUD_TOKEN_OBJECTIVE)).verdict).toBe('unavailable');
  expect((await workflowReadyCheck('workflow-ready:unknown')).verdict).toBe('invalid');
});

function observe() {
  const props = parse();
  const coordinator = new CompletionCoordinator(async (requirements) => {
    const result = await checkPostconditions({ requirements, maxRetries: 0 });
    return result.verdict === 'unavailable' ? undefined : result.pass;
  });
  const step: ObservationStep = {
    id: 'token-step',
    stepId: 'token-step',
    actions: props.internalActions,
    objectives: props.objectives,
    eligible: false,
    executing: false,
    completed: false,
    commit: jest.fn(),
  };
  coordinator.register(step);
  coordinator.start();
  return { coordinator, step };
}

it('reconciles early creation and a guide reset without replaying token creation', async () => {
  tokenForm(true);
  const { coordinator, step } = observe();
  try {
    await settle();
    expect(step.commit).toHaveBeenCalledWith('objectives', 'load');
    coordinator.reset();
    coordinator.recheck();
    await settle();
    expect(step.commit).toHaveBeenCalledTimes(2);
  } finally {
    coordinator.stop();
  }
});

it('waits after a create action, then completes only when the API success appears', async () => {
  const form = tokenForm();
  const { coordinator, step } = observe();
  try {
    coordinator.request(step.id);
    await settle();
    expect(step.commit).not.toHaveBeenCalled();
    expect(coordinator.waiting(step.id)).toBe(true);
    form.remove();
    tokenForm(true);
    coordinator.recheck();
    await settle();
    expect(step.commit).toHaveBeenCalledWith('objectives', 'change');
  } finally {
    coordinator.stop();
  }
});

it('does not complete on another page with a successful token form', async () => {
  tokenForm(true);
  jest
    .mocked(locationService.getLocation)
    .mockReturnValue({ pathname: '/a/another-app', search: '', hash: '', state: null });
  const { coordinator, step } = observe();
  try {
    await settle();
    expect(step.commit).not.toHaveBeenCalled();
  } finally {
    coordinator.stop();
  }
});
