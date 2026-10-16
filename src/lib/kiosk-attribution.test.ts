import { getKioskNameFromCatalogUrl, parseKioskName } from './kiosk-attribution';

it.each([
  [undefined, 'default'],
  ['https://interactive-learning.grafana.net/guides/kiosk/dem/rules.json', 'dem'],
  ['https://interactive-learning.grafana.net/guides/kiosk/dem-command/rules.json', 'dem-command'],
  ['https://catalog.example/custom-team/rules.json?token=private#secret', 'custom-team'],
  ['https://catalog.example/catalogs/Customer-Onboarding.json?token=private', 'customer-onboarding'],
  ['https://catalog.example/rules.json', 'custom'],
  ['https://catalog.example/private%20name/rules.json', 'custom'],
  [`https://catalog.example/${'x'.repeat(65)}.json`, 'custom'],
  ['not a URL', 'custom'],
  ['javascript:private-name', 'custom'],
])('derives a bounded kiosk name from %s', (url, expected) => {
  expect(getKioskNameFromCatalogUrl(url)).toBe(expected);
});

it.each([undefined, '', 'private title', 'https://private.example', 'name?token=secret', 'x'.repeat(65)])(
  'rejects an invalid name from a deep link: %s',
  (value) => expect(parseKioskName(value)).toBeUndefined()
);
