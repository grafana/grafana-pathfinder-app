import { reportInteraction } from '@grafana/runtime';
import { reportKioskInteraction } from './kiosk-analytics';
import { drainValueCasingViolations, findKebabCaseValues } from './analytics-value-check';

jest.mock('@grafana/runtime', () => ({
  reportInteraction: jest.fn(),
}));

jest.mock('./telemetry/bridge', () => ({
  pushFaroUserAction: jest.fn(),
  pushFaroLog: jest.fn(),
  pushFaroError: jest.fn(),
}));

it('reports every kiosk interaction with snake_case values through the real analytics boundary', () => {
  reportKioskInteraction('instance', undefined, { component: 'kiosk', action: 'exit', method: 'escape' });
  reportKioskInteraction('instance', 0, {
    component: 'input',
    action: 'change',
    inputType: 'datasource',
    inputIndex: 0,
  });
  reportKioskInteraction('instance', 0, { component: 'launch_form', action: 'submit' });
  reportKioskInteraction('instance', 0, { component: 'launch_form', action: 'error', reason: 'validation' });
  reportKioskInteraction('presentation', 1, { component: 'command', action: 'copy', outcome: 'success' });
  reportKioskInteraction('presentation', 2, { component: 'guide_links', action: 'open_product', ruleId: 'product' });

  const sent = jest.mocked(reportInteraction).mock.calls.map(([, properties]) => properties ?? {});
  expect(sent.map((properties) => properties.component)).toEqual([
    'kiosk',
    'input',
    'launch_form',
    'launch_form',
    'command',
    'guide_links',
  ]);
  for (const properties of sent) {
    expect(findKebabCaseValues(properties)).toEqual([]);
  }
  expect(drainValueCasingViolations()).toEqual([]);
});
