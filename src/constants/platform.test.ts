import { config } from '@grafana/runtime';

import { currentPlatform } from './platform';

jest.mock('@grafana/runtime', () => ({ config: { buildInfo: {}, namespace: undefined } }));

const mockConfig = config as unknown as { buildInfo: { versionString?: string }; namespace?: string };

describe('currentPlatform', () => {
  beforeEach(() => {
    mockConfig.buildInfo = {};
    mockConfig.namespace = undefined;
  });

  it('reads a Grafana Cloud build as cloud', () => {
    mockConfig.buildInfo = { versionString: 'Grafana Cloud v13.2.0' };
    expect(currentPlatform()).toBe('cloud');
  });

  it('reads a stack namespace as cloud when the build string does not say so', () => {
    mockConfig.buildInfo = { versionString: 'Grafana v13.2.0' };
    mockConfig.namespace = 'stacks-123';
    expect(currentPlatform()).toBe('cloud');
  });

  it.each(['default', 'org-2', 'stacks-', 'stacks-abc', undefined])('reads namespace %p as oss', (namespace) => {
    mockConfig.namespace = namespace;
    expect(currentPlatform()).toBe('oss');
  });
});
