import { reportKioskInteraction } from './kiosk-analytics';
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
