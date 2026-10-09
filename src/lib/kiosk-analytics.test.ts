import {
  getKioskName,
  getKioskSessionId,
  reportKioskInteraction,
  setKioskSessionName,
  startKioskSession,
} from './kiosk-analytics';
import { reportAppInteraction } from './analytics';

jest.mock('./analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { KioskInteraction: 'kiosk_interaction' },
}));

it('allowlists data source interaction metadata without forwarding values or authored fields', () => {
  reportKioskInteraction('instance', 2, {
    ...{ value: 'private-datasource', variableName: 'private-variable', prompt: 'Private prompt' },
    component: 'input',
    action: 'change',
    inputType: 'datasource',
    inputIndex: 1,
  });
  expect(reportAppInteraction).toHaveBeenCalledWith('kiosk_interaction', {
    launch_mode: 'instance',
    block_index: 2,
    component: 'input',
    action: 'change',
    input_type: 'datasource',
    input_index: 1,
  });
});

it('reports product opens with a bounded rule id', () => {
  reportKioskInteraction('presentation', 3, { component: 'guide-links', action: 'open_product', ruleId: 'synthetic' });
  expect(reportAppInteraction).toHaveBeenLastCalledWith('kiosk_interaction', {
    launch_mode: 'presentation',
    block_index: 3,
    component: 'guide-links',
    action: 'open_product',
    rule_id: 'synthetic',
  });
  reportKioskInteraction('instance', undefined, {
    component: 'guide-links',
    action: 'open_product',
    ruleId: 'https://private.example/rule',
  });
  expect(reportAppInteraction).toHaveBeenLastCalledWith('kiosk_interaction', {
    launch_mode: 'instance',
    component: 'guide-links',
    action: 'open_product',
  });
});

it('correlates pre-launch inputs, submit, and exit without a guide session', () => {
  const session = startKioskSession('dem');
  reportKioskInteraction('instance', 0, { component: 'input', action: 'change', inputIndex: 0, inputType: 'text' });
  reportKioskInteraction('instance', 0, { component: 'launch-form', action: 'submit' });
  reportKioskInteraction('instance', undefined, { component: 'kiosk', action: 'exit', method: 'escape' });
  for (const [, properties] of jest.mocked(reportAppInteraction).mock.calls.slice(-3)) {
    expect(properties).toEqual(expect.objectContaining({ kiosk_session_id: session.id, kiosk_name: 'dem' }));
  }
  session.end();
  expect(getKioskSessionId()).toBeUndefined();
  expect(getKioskName()).toBeUndefined();
});

it('does not let stale cleanup clear a new kiosk session', () => {
  const previous = startKioskSession();
  const current = startKioskSession();
  expect(current.id).not.toBe(previous.id);
  previous.end();
  expect(getKioskSessionId()).toBe(current.id);
  current.end();
});

it('ignores a name update from an old catalog load', () => {
  const previous = startKioskSession('dem');
  const current = startKioskSession('customer-onboarding');
  setKioskSessionName(previous.id, 'default');
  expect(getKioskName()).toBe('customer-onboarding');
  current.end();
});
