import { config } from '@grafana/runtime';

import { currentUserAuthorName } from './current-user-name';

jest.mock('@grafana/runtime', () => ({ config: { bootData: { user: {} } } }));

function setUser(user: Record<string, unknown> | undefined) {
  (config as unknown as { bootData: { user?: unknown } }).bootData = { user };
}

describe('currentUserAuthorName', () => {
  it('prefers name over login', () => {
    setUser({ name: 'Sam Rivera', login: 'sam' });
    expect(currentUserAuthorName()).toBe('Sam Rivera');
  });

  it('falls back to login when name is empty or blank', () => {
    setUser({ name: '  ', login: 'sam' });
    expect(currentUserAuthorName()).toBe('sam');
  });

  it('is undefined when there is neither, or no user at all', () => {
    setUser({ name: '', login: '' });
    expect(currentUserAuthorName()).toBeUndefined();
    setUser(undefined);
    expect(currentUserAuthorName()).toBeUndefined();
  });

  it('never reads email', () => {
    setUser({ email: 'sam@example.com' });
    expect(currentUserAuthorName()).toBeUndefined();
  });
});
