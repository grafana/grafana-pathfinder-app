/** @jest-environment node */

import { E2EChainInputSchema, parseE2EChainInput } from './e2e-runner-contract';

function chainInput() {
  return {
    targetUrl: 'http://localhost:3000/',
    options: {
      artifactsDir: '/tmp/artifacts',
      alwaysScreenshot: false,
      verbose: false,
    },
    guides: [
      {
        id: 'first-guide',
        path: '/tmp/first/content.json',
        content: '{"id":"first-guide","blocks":[]}',
        dependencies: [],
        authoredStartingLocation: '/dashboards',
        packageMetadata: {
          packageId: 'first-guide',
          tier: 'local',
          targetUrl: 'http://localhost:3000/',
        },
      },
      {
        id: 'second-guide',
        path: '/tmp/second/content.json',
        content: '{"id":"second-guide","blocks":[]}',
        dependencies: ['first-guide'],
      },
    ],
  };
}

describe('E2E shared-chain input', () => {
  it('accepts the narrow internal transport shape', () => {
    expect(parseE2EChainInput(chainInput())).toEqual(chainInput());
  });

  it.each([
    ['an unsupported target protocol', { targetUrl: 'file:///tmp/grafana' }],
    ['an invalid guide ID', { guides: [{ ...chainInput().guides[0], id: '../first-guide' }] }],
    ['an unknown root field', { bearerToken: 'must-not-enter-the-input-file' }],
  ])('rejects %s', (_name, change) => {
    expect(E2EChainInputSchema.safeParse({ ...chainInput(), ...change }).success).toBe(false);
  });

  it('rejects duplicate guide IDs', () => {
    const input = chainInput();
    input.guides[1]!.id = input.guides[0]!.id;

    expect(E2EChainInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejects a self dependency', () => {
    const input = chainInput();
    input.guides[0]!.dependencies = [input.guides[0]!.id];

    expect(E2EChainInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejects an unresolved dependency', () => {
    const input = chainInput();
    input.guides[1]!.dependencies = ['missing-guide'];

    expect(E2EChainInputSchema.safeParse(input).success).toBe(false);
  });
});
