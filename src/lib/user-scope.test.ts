import { config } from '@grafana/runtime';
import { getUserScope } from './user-scope';

jest.mock('@grafana/runtime', () => ({ config: {} }));

it.each([
  [{ namespace: 'stack', bootData: { user: { orgId: 1, id: 2 } } }, 'stack:1:2'],
  [{ namespace: '', bootData: { user: { orgId: 0, id: 0 } } }, ':0:0'],
  [{ namespace: undefined, bootData: undefined }, '::'],
])('derives the current namespace, organization and user scope', (value, expected) => {
  Object.assign(config, value);
  expect(getUserScope()).toBe(expected);
});

it('reads identity changes rather than caching a previous scope', () => {
  Object.assign(config, { namespace: 'stack', bootData: { user: { orgId: 1, id: 2 } } });
  expect(getUserScope()).toBe('stack:1:2');
  config.bootData.user.orgId = 3;
  expect(getUserScope()).toBe('stack:3:2');
});
