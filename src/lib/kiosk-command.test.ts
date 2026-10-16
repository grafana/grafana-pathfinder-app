import { resolveKioskCommand } from './kiosk-command';

const command = 'setup --stack {{grafana.stackUrl}}';

it.each(['https://team.grafana.net', 'https://pathfinder.grafana-dev.net', 'https://grafana.example.com:8443'])(
  'preserves and shell-quotes %s',
  (origin) => expect(resolveKioskCommand(command, origin)).toBe(`setup --stack '${origin}'`)
);

it.each([
  'http://team.grafana.net',
  'https://localhost',
  'https://app.localhost',
  'https://127.0.0.1',
  'https://[::1]',
  'invalid',
  'javascript:alert(1)',
  'https://user:secret@example.com',
  'https://example.com/path',
  'https://example.com?stack=other',
  'https://example.com#other',
  "https://evil'host.com",
])('falls back for %s', (origin) => {
  expect(resolveKioskCommand(command, origin)).toBe('setup --stack your-stack');
});

it('replaces repeated reserved placeholders only', () => {
  expect(resolveKioskCommand('{{grafana.stackUrl}} {{grafana.stackUrl}} {{answer}}', 'https://team.grafana.net')).toBe(
    "'https://team.grafana.net' 'https://team.grafana.net' {{answer}}"
  );
});

it('preserves static commands', () => {
  expect(resolveKioskCommand('setup --stack fixed-stack', 'https://team.grafana.net')).toBe(
    'setup --stack fixed-stack'
  );
});
