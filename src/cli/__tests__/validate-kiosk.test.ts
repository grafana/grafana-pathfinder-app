import path from 'path';
import { runValidateCli, ValidateCliCommand } from '../commands/validate';

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());
it.each(['event-v2.json', 'onboarding-v2.json', 'dem.json'])('validates %s through the CLI contract', async (file) => {
  const result = await runValidateCli(
    ValidateCliCommand.parse({ kiosk: path.resolve(__dirname, '../../../docs/examples/kiosk', file) })
  );
  expect(result.status).toBe('ok');
});
it('rejects conflicting input modes', async () => {
  const result = await runValidateCli(ValidateCliCommand.parse({ kiosk: 'catalog.json', stdin: true }));
  expect(result.status).toBe('error');
});
