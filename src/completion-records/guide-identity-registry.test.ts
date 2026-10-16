import {
  lookupGuideIdentity,
  registerGuideIdentity,
  __resetGuideIdentityRegistryForTests,
  type RegisteredGuideIdentity,
} from './guide-identity-registry';

const FIRST: RegisteredGuideIdentity = {
  guideSource: 'bundled',
  guideId: 'first',
  guideTitle: 'First',
  guideCategory: 'interactive',
};
const SECOND: RegisteredGuideIdentity = { ...FIRST, guideId: 'second', guideTitle: 'Second' };

beforeEach(() => {
  __resetGuideIdentityRegistryForTests();
});

describe('guide identity registry', () => {
  it('returns null for a content key nobody registered', () => {
    expect(lookupGuideIdentity('bundled:first')).toBeNull();
  });

  it('returns the registered identity until it is unregistered', () => {
    const unregister = registerGuideIdentity('bundled:first', FIRST);
    expect(lookupGuideIdentity('bundled:first')).toEqual(FIRST);

    unregister();
    expect(lookupGuideIdentity('bundled:first')).toBeNull();
  });

  it('lets the last registration for a content key win', () => {
    registerGuideIdentity('key', FIRST);
    registerGuideIdentity('key', SECOND);

    expect(lookupGuideIdentity('key')).toEqual(SECOND);
  });

  it('restores a still-mounted surface when the newer registration unmounts', () => {
    const removeFirst = registerGuideIdentity('key', FIRST);
    const removeSecond = registerGuideIdentity('key', SECOND);
    removeSecond();
    expect(lookupGuideIdentity('key')).toEqual(FIRST);
    removeSecond();
    expect(lookupGuideIdentity('key')).toEqual(FIRST);
    removeFirst();
    expect(lookupGuideIdentity('key')).toBeNull();
  });

  it('ignores a stale unregister once another surface has taken the key over', () => {
    const unregisterFirst = registerGuideIdentity('key', FIRST);
    registerGuideIdentity('key', SECOND);

    unregisterFirst();

    expect(lookupGuideIdentity('key')).toEqual(SECOND);
  });
});
