import { evaluateVersionSupport, parseVersion, resolveMinGrafanaVersion } from './guide-version';

describe('parseVersion', () => {
  it.each([
    ['13.2.0', [13, 2, 0]],
    ['13.2.0-77777', [13, 2, 0]],
    ['13.3.0-pre', [13, 3, 0]],
    ['12.2.0+security-01', [12, 2, 0]],
  ])('parses %s', (input, expected) => {
    expect(parseVersion(input)).toEqual(expected);
  });

  it.each(['v13.2.0', '13.2', '', 'latest', 'not-semver'])('rejects %p', (input) => {
    expect(parseVersion(input)).toBeNull();
  });
});

describe('resolveMinGrafanaVersion', () => {
  it('returns null without a manifest', () => {
    expect(resolveMinGrafanaVersion(undefined)).toBeNull();
  });

  it('returns null when the manifest declares no floor', () => {
    expect(resolveMinGrafanaVersion({ id: 'g', type: 'guide' })).toBeNull();
  });

  it('reads the typed field', () => {
    expect(resolveMinGrafanaVersion({ minGrafanaVersion: '13.2.0' })).toBe('13.2.0');
  });

  it('falls back to additionalFields, where the App Platform CRD parks it', () => {
    expect(resolveMinGrafanaVersion({ additionalFields: { minGrafanaVersion: '13.1.0' } })).toBe('13.1.0');
  });

  it('prefers the typed field over additionalFields', () => {
    expect(
      resolveMinGrafanaVersion({ minGrafanaVersion: '13.2.0', additionalFields: { minGrafanaVersion: '12.0.0' } })
    ).toBe('13.2.0');
  });

  it.each([
    ['an array additionalFields', { additionalFields: ['13.2.0'] }],
    ['a null additionalFields', { additionalFields: null }],
    ['a non-string value', { minGrafanaVersion: 13 }],
    ['an empty string', { minGrafanaVersion: '' }],
  ])('returns null for %s', (_label, manifest) => {
    expect(resolveMinGrafanaVersion(manifest as Record<string, unknown>)).toBeNull();
  });
});

describe('evaluateVersionSupport', () => {
  it('does not warn when no floor is declared', () => {
    expect(evaluateVersionSupport({ minGrafanaVersion: null, currentVersion: '12.3.0' })).toEqual({
      shouldWarn: false,
      reason: 'no-floor',
    });
  });

  it('treats the floor as met at exact equality', () => {
    const result = evaluateVersionSupport({ minGrafanaVersion: '13.2.0', currentVersion: '13.2.0' });
    expect(result).toMatchObject({ shouldWarn: false, reason: 'supported' });
  });

  it('warns on a patch-level miss', () => {
    expect(evaluateVersionSupport({ minGrafanaVersion: '13.2.5', currentVersion: '13.2.4' })).toMatchObject({
      shouldWarn: true,
      reason: 'below-floor',
    });
  });

  it('does not warn on a Cloud build of a supported version, and reports it without the suffix', () => {
    expect(evaluateVersionSupport({ minGrafanaVersion: '13.2.0', currentVersion: '13.2.0-77777' })).toEqual({
      shouldWarn: false,
      reason: 'supported',
      requiredVersion: '13.2.0',
      currentVersion: '13.2.0',
    });
  });

  it('warns on a Cloud build below the floor, reporting normalized versions', () => {
    expect(evaluateVersionSupport({ minGrafanaVersion: '13.2.0', currentVersion: '13.1.0-77777' })).toEqual({
      shouldWarn: true,
      reason: 'below-floor',
      requiredVersion: '13.2.0',
      currentVersion: '13.1.0',
    });
  });

  it.each(['v13.2.0', ''])('fails open when the running version is unreadable (%p)', (currentVersion) => {
    expect(evaluateVersionSupport({ minGrafanaVersion: '13.2.0', currentVersion })).toMatchObject({
      shouldWarn: false,
      reason: 'current-unknown',
    });
  });

  it('fails open when the running version is absent', () => {
    expect(evaluateVersionSupport({ minGrafanaVersion: '13.2.0', currentVersion: undefined })).toMatchObject({
      shouldWarn: false,
      reason: 'current-unknown',
    });
  });

  it.each(['garbage', '13.2'])('fails open on an unparseable floor (%p)', (minGrafanaVersion) => {
    // `13.2` is deliberately unparseable rather than read as 13.2.0 the way
    // `min-version:`'s check does — a floor nobody can read must not warn.
    expect(evaluateVersionSupport({ minGrafanaVersion, currentVersion: '12.0.0' })).toEqual({
      shouldWarn: false,
      reason: 'floor-unparseable',
    });
  });
});
