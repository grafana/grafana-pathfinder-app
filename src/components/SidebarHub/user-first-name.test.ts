import { getFirstName } from './user-first-name';

describe('getFirstName', () => {
  it('takes the first word of the display name', () => {
    expect(getFirstName({ name: '  Ada  Lovelace ', login: 'ada' })).toBe('Ada');
  });

  it('skips a display name that is an email address', () => {
    expect(getFirstName({ name: 'ada@example.com', login: 'ada' })).toBe('ada');
    expect(getFirstName({ name: 'ada@example.com', login: 'ada@example.com' })).toBeUndefined();
  });

  it('falls back to a login that is not an email address', () => {
    expect(getFirstName({ name: '', login: 'admin' })).toBe('admin');
    expect(getFirstName({ name: '', login: 'ada@example.com' })).toBeUndefined();
  });

  it('returns undefined without a user', () => {
    expect(getFirstName(undefined)).toBeUndefined();
    expect(getFirstName({})).toBeUndefined();
  });
});
