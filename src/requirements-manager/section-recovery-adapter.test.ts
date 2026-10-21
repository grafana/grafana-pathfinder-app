import { locationService } from '@grafana/runtime';
import { restoreRecovery } from '../recovery/section-recovery';
import { createRecoveryAdapter } from './section-recovery-adapter';
import type { RecoveryAction } from '../recovery/section-recovery-plan';

jest.mock('@grafana/runtime', () => ({ locationService: { getLocation: jest.fn() } }));
jest.mock('../lib/dom/selector-resolver', () => ({ resolveSelector: (value: string) => value }));
jest.mock('../lib/dom/element-validator', () => ({
  ...jest.requireActual('../lib/dom/element-validator'),
  isElementVisible: () => true,
}));

const requirements = jest.fn();
const navigate = jest.fn(async () => true);
const context = jest.fn(async () => ({ stepId: 'section', navigationManager: { fixLocationRequirement: navigate } }));
let lastReadyUrl: string | undefined;
const adapter = (signal = new AbortController().signal) =>
  createRecoveryAdapter(requirements, context as never, signal, () => lastReadyUrl);

function at(pathname: string) {
  jest.mocked(locationService.getLocation).mockReturnValue({ pathname, search: '' } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  document.body.replaceChildren();
  lastReadyUrl = undefined;
  at('/explore');
});

const offPage = {
  pass: false,
  verdict: 'unsatisfied',
  error: [{ requirement: 'on-page:/explore', pass: false, canFix: true, fixType: 'location', targetHref: '/explore' }],
};

describe('page requirements', () => {
  it('returns to the URL the step was last ready on, keeping its query but not a guide launch', async () => {
    requirements.mockResolvedValue(offPage);
    lastReadyUrl = '/explore?panes=%7B%22a%22%3A1%7D&doc=bundled%3Aother';
    expect(await adapter().check({ kind: 'requirement', requirement: 'on-page:/explore' })).toEqual({
      passed: false,
      canRestore: true,
    });
    expect(await adapter().restore({ kind: 'requirement', requirement: 'on-page:/explore' })).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/explore?panes=%7B%22a%22%3A1%7D');
  });

  it('falls back to the required path when the last ready page was elsewhere', async () => {
    requirements.mockResolvedValue(offPage);
    lastReadyUrl = '/dashboards?folder=current';
    await adapter().restore({ kind: 'requirement', requirement: 'on-page:/explore' });
    expect(navigate).toHaveBeenCalledWith('/explore');
  });

  it('never evaluates requirements that are not live page state', async () => {
    expect(await adapter().check({ kind: 'requirement', requirement: 'has-datasource:loki' })).toEqual({
      passed: false,
      canRestore: false,
    });
    expect(requirements).not.toHaveBeenCalled();
  });
});

it('checks the cursor target with the same exists-reftarget check the step uses', async () => {
  requirements.mockResolvedValue({ pass: true, verdict: 'satisfied', error: [] });
  expect(await adapter().check({ kind: 'target-present', refTarget: 'Run query', targetAction: 'button' })).toEqual({
    passed: true,
    canRestore: false,
  });
  expect(requirements).toHaveBeenCalledWith(
    expect.objectContaining({
      requirements: ['exists-reftarget'],
      refTarget: 'Run query',
      targetAction: 'button',
      maxRetries: 0,
    })
  );
});

describe('returning to the last ready page', () => {
  const resume: RecoveryAction = { kind: 'resume-location', objectives: [{ kind: 'resume-location' }] };

  it('is satisfied on the same path, or before the step was ever ready', async () => {
    expect(await adapter().check({ kind: 'resume-location' })).toMatchObject({ passed: true });
    lastReadyUrl = '/explore?left=1';
    expect(await adapter().check({ kind: 'resume-location' })).toMatchObject({ passed: true });
    expect(await adapter().canReplay(resume)).toBe(false);
  });

  it('navigates back through the location fix when the learner left', async () => {
    lastReadyUrl = '/explore?left=1&panelMode=floating';
    at('/dashboards');
    expect(await adapter().check({ kind: 'resume-location' })).toMatchObject({ passed: false });
    expect(await adapter().canReplay(resume)).toBe(true);
    expect(await adapter().replay(resume)).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/explore?left=1');
  });
});

describe('toggles', () => {
  const action: RecoveryAction = {
    kind: 'toggle',
    refTarget: '#row',
    targetAction: 'highlight',
    targetState: 'aria-expanded:true',
    objectives: [],
  };

  it('replays a collapsed toggle once and reads its state without clicking', async () => {
    document.body.innerHTML = '<button type="button" id="row" aria-expanded="false">Row</button>';
    const row = document.getElementById('row')!;
    const click = jest.fn(() => row.setAttribute('aria-expanded', 'true'));
    row.addEventListener('click', click);
    const condition = {
      kind: 'target-state',
      refTarget: '#row',
      targetAction: 'highlight',
      targetState: 'aria-expanded:true',
    } as const;
    expect(await adapter().check(condition)).toMatchObject({ passed: false });
    expect(await adapter().canReplay(action)).toBe(true);
    expect(click).not.toHaveBeenCalled();
    expect(await adapter().replay(action)).toBe(true);
    expect(await adapter().check(condition)).toMatchObject({ passed: true });
    expect(await adapter().replay(action)).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('never clicks a control whose state cannot be read', async () => {
    document.body.innerHTML = '<button type="button" id="row">Row</button>';
    const click = jest.fn();
    document.getElementById('row')!.addEventListener('click', click);
    expect(await adapter().canReplay(action)).toBe(false);
    expect(await adapter().replay(action)).toBe(false);
    expect(click).not.toHaveBeenCalled();
  });
});

it('does nothing once cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  lastReadyUrl = '/explore';
  at('/dashboards');
  expect(await adapter(controller.signal).replay({ kind: 'resume-location', objectives: [] })).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
});

it.each([true, false])(
  'does not click after navigation during a mount retry (explicit page requirement: %s)',
  async (explicitPage) => {
    jest.useFakeTimers();
    try {
      document.body.innerHTML = '<button id="row" aria-expanded="false">Row</button>';
      const row = document.getElementById('row')!;
      const click = jest.fn(() => row.setAttribute('aria-expanded', 'true'));
      row.addEventListener('click', click);
      requirements.mockImplementation(async (options) => {
        const passed =
          options.requirements[0] === 'on-page:/explore' && locationService.getLocation().pathname === '/explore';
        return { pass: passed, verdict: passed ? 'satisfied' : 'unsatisfied', error: [] };
      });
      lastReadyUrl = '/explore';
      const liveAdapter = adapter();
      const canReplay = liveAdapter.canReplay;
      liveAdapter.canReplay = async (action) => {
        const available = await canReplay(action);
        if (action.kind !== 'toggle') {
          return available;
        }
        row.remove();
        setTimeout(() => {
          at('/dashboards');
          document.body.append(row);
        }, 25);
        return available;
      };
      const result = restoreRecovery(
        [
          ...(explicitPage ? [{ kind: 'requirement' as const, requirement: 'on-page:/explore' }] : []),
          {
            kind: 'target-present',
            refTarget: '#dialog',
            targetAction: 'button',
            recover: [
              { kind: 'resume-location', objectives: [{ kind: 'resume-location' }] },
              {
                kind: 'toggle',
                refTarget: '#row',
                targetAction: 'highlight',
                targetState: 'aria-expanded:true',
                objectives: [
                  {
                    kind: 'target-state',
                    refTarget: '#row',
                    targetAction: 'highlight',
                    targetState: 'aria-expanded:true',
                  },
                ],
              },
            ],
          },
        ],
        liveAdapter,
        new AbortController().signal
      );
      await jest.runAllTimersAsync();
      expect(await result).toMatchObject({ passed: false, gaveUp: true });
      expect(click).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  }
);
