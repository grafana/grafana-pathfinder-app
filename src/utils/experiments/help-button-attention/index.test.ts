import { createTheme } from '@grafana/data';
import { randomUUID } from 'crypto';
import { serialize, deserialize } from 'v8';
import { TypedInMemoryProvider, OpenFeature } from '@openfeature/web-sdk';
import { config, reportExperimentView } from '@grafana/runtime';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import {
  HELP_BUTTON_EXPERIMENT_FLAG,
  HELP_BUTTON_EXPERIMENT_ID,
  HELP_BUTTON_CLICK_EVENT,
} from '../../../constants/help-button-experiment';
import { startHelpButtonExperiment } from './index';

const mockPushEvent = jest.fn();
const mockFaro = {
  api: { getSession: () => ({ id: 'test-session' }), pushEvent: mockPushEvent, getActiveUserAction: () => undefined },
  metas: { addListener: jest.fn(), removeListener: jest.fn() },
};
jest.mock('../../../lib/telemetry/faro-adapter', () => ({ getPathfinderFaro: () => mockFaro }));
jest.mock('../../../lib/telemetry/surface', () => ({
  isPathfinderOpen: () => false,
  onPathfinderSurfaceChange: () => () => {},
}));
jest.mock('../../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: {
    HelpButtonClickedToolbar: 'help_button_clicked_toolbar',
    HelpButtonDismissedHint: 'help_button_dismissed_hint',
  },
}));
jest.mock('../../openfeature', () => ({ getFeatureFlagClient: () => OpenFeature.getClient('help-button-test') }));
jest.mock('@grafana/i18n', () => ({ t: (_key: string, fallback: string) => fallback }));
jest.mock('./styles', () => ({ getHelpButtonAttentionStyle: () => 'test-glow' }));
jest.mock('@grafana/runtime', () => ({
  config: { namespace: 'stacks-123', bootData: { user: { id: 42, isSignedIn: true } }, analytics: { enabled: true } },
  reportExperimentView: jest.fn(),
}));

let stop: (() => void) | undefined;
let button: HTMLButtonElement;
async function settle() {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
    jest.advanceTimersByTime(20);
  }
}
async function flag(value: unknown) {
  await OpenFeature.setProviderAndWait(
    'help-button-test',
    new TypedInMemoryProvider({
      [HELP_BUTTON_EXPERIMENT_FLAG]: {
        defaultVariant: 'configured',
        variants: { configured: value as never },
        disabled: false,
      },
    })
  );
}

beforeEach(() => {
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: randomUUID });
  globalThis.structuredClone = (value) => deserialize(serialize(value));
  jest.useFakeTimers();
  jest.clearAllMocks();
  sessionStorage.clear();
  config.theme2 = createTheme();
  config.analytics.enabled = true;
  config.bootData.user.isSignedIn = true;
  button = document.createElement('button');
  button.setAttribute('aria-label', 'Help');
  button.setAttribute('aria-expanded', 'false');
  const icon = document.createElement('span');
  icon.dataset.testid = 'icon-question-circle';
  button.append(icon);
  document.body.append(button);
  jest.spyOn(button, 'getBoundingClientRect').mockReturnValue({
    width: 32,
    height: 32,
    top: 10,
    left: 10,
    right: 42,
    bottom: 42,
    x: 10,
    y: 10,
    toJSON: () => ({}),
  });
});
afterEach(async () => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
  await OpenFeature.clearProviders();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it.each(['control', 'glow', 'tooltip'])(
  'uses the real SDK for one %s exposure and attributed click',
  async (variant) => {
    await flag({ variant });
    stop = await startHelpButtonExperiment();
    await settle();
    expect(reportExperimentView).toHaveBeenCalledWith(HELP_BUTTON_EXPERIMENT_ID, 'closed-help-toolbar', variant);
    expect(button.classList.contains('test-glow')).toBe(variant !== 'control');
    button.click();
    expect(document.querySelector('[data-testid="help-button-learning-hint"]')).toBeNull();
    expect(reportAppInteraction).toHaveBeenCalledWith(
      UserInteraction.HelpButtonClickedToolbar,
      expect.objectContaining({
        experiment_help_button_nudge: variant,
        exposure_id: expect.any(String),
        event_id: expect.any(String),
      }),
      { mirrorToFaro: false }
    );
    const exposures = mockPushEvent.mock.calls.filter(([name]) => name === 'experiment_viewed');
    const outcomes = mockPushEvent.mock.calls.filter(([name]) => name === HELP_BUTTON_CLICK_EVENT);
    expect(exposures).toHaveLength(1);
    expect(outcomes).toHaveLength(1);
    expect(JSON.parse(outcomes[0]![1].experiments)).toEqual([
      expect.objectContaining({ variant, exposure_id: exposures[0]![1].exposure_id }),
    ]);
    stop();
    stop = await startHelpButtonExperiment();
    await settle();
    expect(button.className).toBe('');
    expect(reportExperimentView).toHaveBeenCalledTimes(1);
  }
);

it.each([{ variant: 'excluded' }, { variant: 'unknown' }, {}, null, false])(
  'does not expose or change the button for %j',
  async (value) => {
    await flag(value);
    stop = await startHelpButtonExperiment();
    await settle();
    expect(reportExperimentView).not.toHaveBeenCalled();
    expect(button.className).toBe('');
    button.click();
    expect(reportAppInteraction).not.toHaveBeenCalled();
  }
);

it('does not turn a missing flag into control', async () => {
  await OpenFeature.setProviderAndWait('help-button-test', new TypedInMemoryProvider({}));
  stop = await startHelpButtonExperiment();
  await settle();
  expect(reportExperimentView).not.toHaveBeenCalled();
  expect(button.className).toBe('');
});

it('reuses the SDK exposure after remount without another impression', async () => {
  await flag({ variant: 'glow' });
  stop = await startHelpButtonExperiment();
  await settle();
  stop();
  stop = await startHelpButtonExperiment();
  await settle();
  expect(reportExperimentView).toHaveBeenCalledTimes(1);
  expect(button.className).toBe('test-glow');
});

it.each(['analytics', 'anonymous'])('does not enroll when disabled by %s', async (reason) => {
  await flag({ variant: 'glow' });
  if (reason === 'analytics') {
    config.analytics.enabled = false;
  } else {
    config.bootData.user.isSignedIn = false;
  }
  stop = await startHelpButtonExperiment();
  await settle();
  expect(reportExperimentView).not.toHaveBeenCalled();
  expect(button.className).toBe('');
});

it('keeps tooltip dismissal separate from a click and preserves its assignment', async () => {
  await flag({ variant: 'tooltip' });
  stop = await startHelpButtonExperiment();
  await settle();
  const close = document.querySelector<HTMLButtonElement>('[aria-label="Dismiss learning hint"]')!;
  expect(close).not.toBeNull();
  close.click();
  expect(document.querySelector('[data-testid="help-button-learning-hint"]')).toBeNull();
  expect(reportAppInteraction).toHaveBeenLastCalledWith(
    UserInteraction.HelpButtonDismissedHint,
    expect.objectContaining({ experiment_help_button_nudge: 'tooltip' }),
    { mirrorToFaro: false }
  );
  stop();
  stop = await startHelpButtonExperiment();
  await settle();
  expect(document.querySelector('[data-testid="help-button-learning-hint"]')).toBeNull();
  button.click();
  expect(reportAppInteraction).toHaveBeenLastCalledWith(
    UserInteraction.HelpButtonClickedToolbar,
    expect.objectContaining({ experiment_help_button_nudge: 'tooltip' }),
    { mirrorToFaro: false }
  );
  expect(reportExperimentView).toHaveBeenCalledTimes(1);
});
