jest.mock('@grafana/runtime', () => ({ config: { buildInfo: { version: '0.0.0' } } }));

import { config } from '@grafana/runtime';

import { isModalCoexistenceSupported } from './grafana-version';

const setVersion = (v: string | undefined) => {
  (config.buildInfo as { version?: string }).version = v as string;
};

describe('isModalCoexistenceSupported', () => {
  it('is held off for current Grafana versions (sentinel min until #126261 ships)', () => {
    setVersion('13.1.0');
    expect(isModalCoexistenceSupported()).toBe(false);
    setVersion('13.1.0-27316398859');
    expect(isModalCoexistenceSupported()).toBe(false);
  });

  it('returns false when the version is missing or unparseable', () => {
    setVersion(undefined);
    expect(isModalCoexistenceSupported()).toBe(false);
    setVersion('not-a-version');
    expect(isModalCoexistenceSupported()).toBe(false);
  });

  it('compares correctly against the sentinel (so it flips on when the min is lowered)', () => {
    setVersion('999.0.0');
    expect(isModalCoexistenceSupported()).toBe(true);
    setVersion('999.1.0');
    expect(isModalCoexistenceSupported()).toBe(true);
    setVersion('998.9.9');
    expect(isModalCoexistenceSupported()).toBe(false);
  });
});
