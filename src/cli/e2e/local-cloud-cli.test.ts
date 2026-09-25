import fs, {
  cpSync,
  existsSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { assertLocalCloudCheckoutSources } from './e2e-local-package';
import { E2eCommand, runE2e } from '../commands/e2e';
import { ExitCode } from './exit-codes';
import { contentDigest, type TestResultsData } from './e2e-reporter';
import { runPlaywrightChain, runPlaywrightTests } from './playwright-runner';

jest.mock('./playwright-runner', () => ({
  runPlaywrightChain: jest.fn(),
  runPlaywrightTests: jest.fn(),
}));

const callerToken = 'synthetic-pool-caller-token';
const runnerToken = 'synthetic-lease-runner-token';
const targetOrigin = 'https://leased-stack.example';
const managerOrigin = 'https://pool-manager.example';
const tokenVariable = 'PATHFINDER_TEST_POOL_CALLER_TOKEN';

type Report = {
  outcome: string;
  errorMessage: string;
  target: { url: string };
  guide: { id: string; path: string; targetUrl?: string; contentDigest?: string };
  cleanupWarnings?: string[];
  steps: unknown[];
};

type SkipReport = {
  outcome: string;
  selection?: { id: string; type: string };
  summary: { totalGuides: number; passedGuides: number; failedGuides: number; skippedGuides: number };
  preRunSkipped: Array<{ id: string; reason: string; message: string; failed: boolean; tier?: string }>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function fakeGuideData(id: string, executed: boolean): TestResultsData {
  return {
    guide: { id, title: id, path: `${id}/content.json`, targetUrl: `${targetOrigin}/` },
    timestamp: '2026-01-01T00:00:00.000Z',
    outcome: 'passed',
    results: executed
      ? [
          {
            stepId: 'browser-step',
            status: 'passed',
            durationMs: 1,
            currentUrl: `${targetOrigin}/`,
            consoleErrors: [],
            skippable: false,
          },
        ]
      : [],
    coverage: {
      contractSource: 'current',
      rendered: 1,
      supported: 1,
      executed: executed ? 1 : 0,
      unsupported: 0,
      unsupportedSteps: [],
    },
    aborted: false,
  };
}

describe('local cloud package CLI preflight', () => {
  let root: string;
  let originalFetch: typeof fetch | undefined;
  let originalToken: string | undefined;
  let fetchSpy: jest.Mock;
  let exitSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let existingHandlers: Map<NodeJS.Signals | 'exit', Function[]>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'pathfinder-local-cloud-cli-'));
    const packageDir = join(root, 'cloud-guide');
    mkdirSync(packageDir);
    writeFileSync(
      join(packageDir, 'manifest.json'),
      JSON.stringify({
        id: 'cloud-guide',
        type: 'guide',
        testEnvironment: { tier: 'cloud', plugins: ['required-plugin'] },
      })
    );
    writeFileSync(
      join(packageDir, 'content.json'),
      JSON.stringify({
        id: 'cloud-guide',
        title: 'Cloud guide',
        blocks: [
          { type: 'interactive', action: 'highlight', reftarget: '[data-testid="step"]', content: 'Inspect a step' },
        ],
      })
    );
    writeFileSync(
      join(root, 'repository.json'),
      JSON.stringify({
        'cloud-guide': {
          path: 'cloud-guide/',
          type: 'guide',
          testEnvironment: { tier: 'cloud', plugins: ['required-plugin'] },
        },
      })
    );
    originalToken = process.env[tokenVariable];
    process.env[tokenVariable] = callerToken;
    originalFetch = global.fetch;
    fetchSpy = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.origin === managerOrigin && url.pathname === '/v1/leases') {
        return jsonResponse(
          {
            leaseId: 'lease-for-cloud-guide',
            grafanaUrl: `${targetOrigin}/`,
            runnerToken,
            stackSlug: 'stack-for-cloud-guide',
            poolId: 'ci',
          },
          201
        );
      }
      if (url.origin === managerOrigin && url.pathname === '/v1/leases/lease-for-cloud-guide/retire') {
        return jsonResponse({ leaseId: 'lease-for-cloud-guide', status: 'retired' });
      }
      if (url.origin === targetOrigin && url.pathname === '/api/health') {
        return jsonResponse({ database: 'ok', version: '12.0.0' });
      }
      if (url.origin === targetOrigin && url.pathname === '/api/plugins') {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected request to ${url.origin}${url.pathname}`);
    });
    Object.defineProperty(global, 'fetch', { configurable: true, value: fetchSpy });
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`CLI exited with ${code}`);
    });
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    existingHandlers = new Map(
      (['exit', 'SIGINT', 'SIGTERM'] as const).map((signal) => [signal, process.listeners(signal)])
    );
  });

  afterEach(() => {
    for (const [signal, handlers] of existingHandlers) {
      for (const handler of process.listeners(signal)) {
        if (!handlers.includes(handler)) {
          process.removeListener(signal, handler);
        }
      }
    }
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    jest.clearAllMocks();
    if (originalFetch) {
      Object.defineProperty(global, 'fetch', { configurable: true, value: originalFetch });
    } else {
      delete (global as Partial<typeof global>).fetch;
    }
    if (originalToken === undefined) {
      delete process.env[tokenVariable];
    } else {
      process.env[tokenVariable] = originalToken;
    }
    rmSync(root, { recursive: true, force: true });
  });

  function allowRequiredPlugin(): void {
    const defaultFetch = fetchSpy.getMockImplementation()!;
    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
      new URL(input.toString()).pathname === '/api/plugins'
        ? Promise.resolve(jsonResponse([{ id: 'required-plugin' }]))
        : defaultFetch(input, init)
    );
  }

  function cloudOptions(packageDir: string, reportPath: string) {
    return E2eCommand.parse({
      package: packageDir,
      repository: root,
      tier: 'cloud',
      cloudStackPoolManagerUrl: `${managerOrigin}/`,
      cloudStackPoolManagerToken: tokenVariable,
      cloudStackPoolId: 'ci',
      output: reportPath,
      artifacts: join(root, 'artifacts'),
    });
  }

  it.each(['selected root', 'required dependency'] as const)(
    'refuses a duplicated %s before network or browser execution',
    async (duplicated) => {
      const id = duplicated === 'selected root' ? 'cloud-guide' : 'required-guide';
      if (duplicated === 'required dependency') {
        const packageDir = join(root, 'cloud-guide');
        writeFileSync(
          join(packageDir, 'manifest.json'),
          JSON.stringify({
            id: 'cloud-guide',
            type: 'guide',
            depends: ['required-guide'],
            testEnvironment: { tier: 'cloud' },
          })
        );
      }
      for (const suffix of ['one', 'two']) {
        const duplicateDir = join(root, `renamed-${suffix}`);
        mkdirSync(duplicateDir);
        writeFileSync(
          join(duplicateDir, 'manifest.json'),
          JSON.stringify({ id, type: 'guide', testEnvironment: { tier: 'cloud' } })
        );
        writeFileSync(join(duplicateDir, 'content.json'), JSON.stringify({ id, title: 'Duplicate guide', blocks: [] }));
      }
      const reportPath = join(root, 'duplicate-package-report.json');
      const options = E2eCommand.parse({
        package: join(root, 'cloud-guide'),
        repository: root,
        tier: 'cloud',
        cloudStackPoolManagerUrl: `${managerOrigin}/`,
        cloudStackPoolManagerToken: tokenVariable,
        cloudStackPoolId: 'ci',
        output: reportPath,
        artifacts: join(root, 'artifacts'),
      });

      await expect(runE2e(options)).rejects.toThrow(`CLI exited with ${ExitCode.CONFIGURATION_ERROR}`);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(runPlaywrightTests).not.toHaveBeenCalled();
      expect(runPlaywrightChain).not.toHaveBeenCalled();
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
      expect(report.outcome).not.toBe('passed');
      expect(report.errorMessage).toContain(`Selected local cloud graph contains duplicate package ID "${id}"`);
    }
  );

  it.each(['content.json', 'manifest.json'] as const)(
    'rejects externally linked selected %s before reading any linked bytes',
    async (name) => {
      const outside = mkdtempSync(join(tmpdir(), 'pathfinder-outside-guide-'));
      const linkedPath = join(root, 'cloud-guide', name);
      const marker = 'External linked content marker';
      try {
        const externalPath = join(outside, name);
        writeFileSync(externalPath, JSON.stringify({ id: 'cloud-guide', type: 'guide', title: marker }));
        rmSync(linkedPath);
        symlinkSync(externalPath, linkedPath);
        const readSpy = jest.spyOn(fs, 'readFileSync');
        try {
          const reportPath = join(root, `linked-${name}-report.json`);
          await expect(runE2e(cloudOptions(join(root, 'cloud-guide'), reportPath))).rejects.toThrow(
            `CLI exited with ${ExitCode.CONFIGURATION_ERROR}`
          );
          expect(readSpy.mock.calls.some(([path]) => path === linkedPath || path === externalPath)).toBe(false);
          expect(fetchSpy).not.toHaveBeenCalled();
          expect(runPlaywrightTests).not.toHaveBeenCalled();
          expect(runPlaywrightChain).not.toHaveBeenCalled();
          const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
          expect(report.outcome).not.toBe('passed');
          expect(report.errorMessage).toContain('symbolic link');
          expect(
            [readFileSync(reportPath, 'utf8'), ...logSpy.mock.calls.flat(), ...errorSpy.mock.calls.flat()].join(' ')
          ).not.toContain(marker);
        } finally {
          readSpy.mockRestore();
        }
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    }
  );

  it('rejects a missing explicit repository before reading a linked selected manifest', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'pathfinder-outside-manifest-'));
    const manifestPath = join(root, 'cloud-guide', 'manifest.json');
    const externalPath = join(outside, 'manifest.json');
    const marker = 'External linked manifest marker';
    try {
      writeFileSync(externalPath, JSON.stringify({ id: 'cloud-guide', type: 'guide', description: marker }));
      rmSync(manifestPath);
      symlinkSync(externalPath, manifestPath);
      const reportPath = join(root, 'missing-repository-report.json');
      const options = {
        ...cloudOptions(join(root, 'cloud-guide'), reportPath),
        repository: join(root, 'missing-repository.json'),
      };
      const readSpy = jest.spyOn(fs, 'readFileSync');
      try {
        await expect(runE2e(options)).rejects.toThrow(`CLI exited with ${ExitCode.CONFIGURATION_ERROR}`);
        expect(readSpy.mock.calls.some(([path]) => path === manifestPath || path === externalPath)).toBe(false);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(runPlaywrightTests).not.toHaveBeenCalled();
        expect(runPlaywrightChain).not.toHaveBeenCalled();
        const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
        expect(report.outcome).toBe('configuration_error');
        expect(report.errorMessage).toContain('Local repository not found');
        expect(
          [readFileSync(reportPath, 'utf8'), ...logSpy.mock.calls.flat(), ...errorSpy.mock.calls.flat()].join(' ')
        ).not.toContain(marker);
      } finally {
        readSpy.mockRestore();
      }
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it.each(['directory', 'content.json'] as const)(
    'rejects a linked discovered package %s before reading its manifests or content',
    async (linkedPart) => {
      const outside = mkdtempSync(join(tmpdir(), 'pathfinder-linked-package-'));
      try {
        writeFileSync(join(outside, 'manifest.json'), JSON.stringify({ id: 'outside', type: 'guide' }));
        writeFileSync(join(outside, 'content.json'), JSON.stringify({ id: 'outside', title: 'Outside', blocks: [] }));
        if (linkedPart === 'directory') {
          symlinkSync(outside, join(root, 'linked-package'));
        } else {
          const discovered = join(root, 'discovered-package');
          mkdirSync(discovered);
          writeFileSync(join(discovered, 'manifest.json'), JSON.stringify({ id: 'outside', type: 'guide' }));
          symlinkSync(join(outside, 'content.json'), join(discovered, 'content.json'));
        }
        const readSpy = jest.spyOn(fs, 'readFileSync');
        try {
          const reportPath = join(root, 'linked-package-report.json');
          await expect(runE2e(cloudOptions(join(root, 'cloud-guide'), reportPath))).rejects.toThrow(
            `CLI exited with ${ExitCode.CONFIGURATION_ERROR}`
          );
          expect(readSpy.mock.calls.some(([path]) => typeof path === 'string' && path.startsWith(outside))).toBe(false);
          expect(readSpy.mock.calls.some(([path]) => path === join(root, 'cloud-guide', 'manifest.json'))).toBe(false);
          expect(readSpy.mock.calls.some(([path]) => path === join(root, 'discovered-package', 'content.json'))).toBe(
            false
          );
          expect(fetchSpy).not.toHaveBeenCalled();
          expect(runPlaywrightTests).not.toHaveBeenCalled();
          expect((JSON.parse(readFileSync(reportPath, 'utf8')) as Report).errorMessage).toContain('symbolic link');
        } finally {
          readSpy.mockRestore();
        }
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    }
  );

  it.each(['selected content', 'selected asset', 'discovered asset'] as const)(
    'rejects a hard-linked %s before reading selected source or leasing',
    async (location) => {
      const outside = mkdtempSync(join(tmpdir(), 'pathfinder-hard-linked-source-'));
      const externalFile = join(outside, 'data.json');
      try {
        writeFileSync(externalFile, readFileSync(join(root, 'cloud-guide', 'content.json'), 'utf8'));
        let destination: string;
        if (location === 'selected content') {
          destination = join(root, 'cloud-guide', 'content.json');
          rmSync(destination);
        } else {
          const assetDir = join(root, location === 'selected asset' ? 'cloud-guide' : 'discovered-package', 'assets');
          mkdirSync(assetDir, { recursive: true });
          destination = join(assetDir, 'data.json');
        }
        linkSync(externalFile, destination);
        const readSpy = jest.spyOn(fs, 'readFileSync');
        try {
          const reportPath = join(root, 'hard-linked-report.json');
          await expect(runE2e(cloudOptions(join(root, 'cloud-guide'), reportPath))).rejects.toThrow(
            `CLI exited with ${ExitCode.CONFIGURATION_ERROR}`
          );
          expect(readSpy.mock.calls.some(([path]) => path === externalFile || path === destination)).toBe(false);
          expect(readSpy.mock.calls.some(([path]) => path === join(root, 'cloud-guide', 'manifest.json'))).toBe(false);
          expect(fetchSpy).not.toHaveBeenCalled();
          expect(runPlaywrightTests).not.toHaveBeenCalled();
          expect(runPlaywrightChain).not.toHaveBeenCalled();
          expect((JSON.parse(readFileSync(reportPath, 'utf8')) as Report).errorMessage).toContain('hard link');
        } finally {
          readSpy.mockRestore();
        }
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    }
  );

  it('rejects a link inside assets before reading the selected manifest or leasing', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'pathfinder-linked-asset-'));
    try {
      const assetDir = join(root, 'cloud-guide', 'assets');
      mkdirSync(assetDir);
      const externalFile = join(outside, 'data.json');
      writeFileSync(externalFile, '{}');
      symlinkSync(externalFile, join(assetDir, 'data.json'));
      const readSpy = jest.spyOn(fs, 'readFileSync');
      try {
        const reportPath = join(root, 'linked-asset-report.json');
        await expect(runE2e(cloudOptions(join(root, 'cloud-guide'), reportPath))).rejects.toThrow(
          `CLI exited with ${ExitCode.CONFIGURATION_ERROR}`
        );
        expect(readSpy.mock.calls.some(([path]) => path === externalFile)).toBe(false);
        expect(readSpy.mock.calls.some(([path]) => path === join(root, 'cloud-guide', 'manifest.json'))).toBe(false);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(runPlaywrightTests).not.toHaveBeenCalled();
        expect((JSON.parse(readFileSync(reportPath, 'utf8')) as Report).errorMessage).toContain('symbolic link');
      } finally {
        readSpy.mockRestore();
      }
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects an in-root content link and ignores excluded dependency trees', () => {
    writeFileSync(join(root, 'other-content.json'), readFileSync(join(root, 'cloud-guide', 'content.json')));
    rmSync(join(root, 'cloud-guide', 'content.json'));
    symlinkSync(join(root, 'other-content.json'), join(root, 'cloud-guide', 'content.json'));
    expect(() => assertLocalCloudCheckoutSources(root, join(root, 'cloud-guide'))).toThrow('symbolic link');
    rmSync(join(root, 'cloud-guide', 'content.json'));
    mkdirSync(join(root, 'node_modules'));
    symlinkSync(join(root, 'other-content.json'), join(root, 'node_modules', 'linked-content.json'));
    expect(() => assertLocalCloudCheckoutSources(root, join(root, 'cloud-guide'))).not.toThrow();
  });

  it.each(['index file', 'checkout directory'] as const)(
    'retires the exact fake lease with an %s after target preflight fails',
    async (repositoryInput) => {
      const reportPath = join(root, 'report.json');
      if (repositoryInput === 'checkout directory') {
        rmSync(join(root, 'repository.json'));
      }
      const options = E2eCommand.parse({
        package: join(root, 'cloud-guide'),
        repository: repositoryInput === 'checkout directory' ? root : join(root, 'repository.json'),
        tier: 'cloud',
        cloudStackPoolManagerUrl: `${managerOrigin}/`,
        cloudStackPoolManagerToken: tokenVariable,
        cloudStackPoolId: 'ci',
        output: reportPath,
        artifacts: join(root, 'artifacts'),
      });

      await expect(runE2e(options)).rejects.toThrow(`CLI exited with ${ExitCode.CONFIGURATION_ERROR}`);

      const requests = fetchSpy.mock.calls.map(([input, init]) => ({
        url: new URL(input.toString()),
        init: init as RequestInit,
      }));
      expect(requests.map(({ url }) => `${url.origin}${url.pathname}`)).toEqual([
        `${managerOrigin}/v1/leases`,
        `${targetOrigin}/api/health`,
        `${targetOrigin}/api/plugins`,
        `${managerOrigin}/v1/leases/lease-for-cloud-guide/retire`,
      ]);
      expect(requests[0]!.init.headers).toMatchObject({ Authorization: `Bearer ${callerToken}` });
      expect(requests[3]!.init.headers).toMatchObject({ Authorization: `Bearer ${callerToken}` });
      expect(requests[1]!.init.headers).not.toHaveProperty('Authorization');
      expect(requests[2]!.init.headers).toMatchObject({ Authorization: `Bearer ${runnerToken}` });
      expect(requests[2]!.init.redirect).toBe('error');
      expect(JSON.parse(requests[3]!.init.body as string)).toMatchObject({ outcome: 'failed', used: true });
      expect(runPlaywrightTests).not.toHaveBeenCalled();
      expect(runPlaywrightChain).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(ExitCode.CONFIGURATION_ERROR);
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
      expect(report.outcome).not.toBe('passed');
      expect(report.errorMessage).toContain('Required plugin "required-plugin" is not installed');
      expect(report.target.url).toBe(`${targetOrigin}/`);
      expect(report.guide).toMatchObject({
        id: 'cloud-guide',
        path: join(root, 'cloud-guide', 'content.json'),
        targetUrl: `${targetOrigin}/`,
        contentDigest: contentDigest(readFileSync(join(root, 'cloud-guide', 'content.json'), 'utf8')),
      });
      expect(report.steps).toEqual([]);
      const reportAndLogs = [
        readFileSync(reportPath, 'utf8'),
        ...logSpy.mock.calls.flat(),
        ...errorSpy.mock.calls.flat(),
      ].join(' ');
      expect(reportAndLogs).not.toContain(callerToken);
      expect(reportAndLogs).not.toContain(runnerToken);
      if (repositoryInput === 'checkout directory') {
        expect(existsSync(join(root, 'repository.json'))).toBe(false);
      }
    }
  );

  it('reports the unexecuted selected root and retirement warning when a prerequisite fails post-lease preflight', async () => {
    const packageDir = join(root, 'cloud-guide');
    writeFileSync(
      join(packageDir, 'manifest.json'),
      JSON.stringify({
        id: 'cloud-guide',
        type: 'guide',
        depends: ['required-guide'],
        testEnvironment: { tier: 'cloud' },
      })
    );
    const prerequisiteDir = join(root, 'required-guide');
    mkdirSync(prerequisiteDir);
    writeFileSync(
      join(prerequisiteDir, 'manifest.json'),
      JSON.stringify({
        id: 'required-guide',
        type: 'guide',
        testEnvironment: { tier: 'cloud', minVersion: '12.2.0' },
      })
    );
    writeFileSync(
      join(prerequisiteDir, 'content.json'),
      JSON.stringify({
        id: 'required-guide',
        title: 'Required guide',
        blocks: [{ type: 'interactive', action: 'highlight', reftarget: 'body', content: 'Inspect' }],
      })
    );
    const originalFetch = fetchSpy.getMockImplementation()!;
    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const pathname = new URL(input.toString()).pathname;
      if (pathname === '/api/health') {
        return Promise.resolve(jsonResponse({ database: 'ok' }));
      }
      if (pathname === '/api/frontend/settings') {
        return Promise.resolve(jsonResponse({ buildInfo: {} }));
      }
      if (pathname === '/v1/leases/lease-for-cloud-guide/retire') {
        return Promise.resolve(
          jsonResponse({ error: { code: 'unavailable', message: 'Retirement unavailable' } }, 503)
        );
      }
      return originalFetch(input, init);
    });
    const reportPath = join(root, 'prerequisite-preflight-report.json');

    await expect(runE2e(cloudOptions(packageDir, reportPath))).rejects.toThrow(
      `CLI exited with ${ExitCode.CONFIGURATION_ERROR}`
    );

    expect(fetchSpy.mock.calls.map(([input]) => new URL(input.toString()).pathname)).toEqual([
      '/v1/leases',
      '/api/health',
      '/api/frontend/settings',
      '/v1/leases/lease-for-cloud-guide/retire',
    ]);
    expect(runPlaywrightTests).not.toHaveBeenCalled();
    expect(runPlaywrightChain).not.toHaveBeenCalled();
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
    expect(report.outcome).toBe('configuration_error');
    expect(report.errorMessage).toContain('Manifest pre-flight failed for required-guide: minVersion');
    expect(report.target.url).toBe(`${targetOrigin}/`);
    expect(report.guide).toMatchObject({
      id: 'cloud-guide',
      path: join(packageDir, 'content.json'),
      targetUrl: `${targetOrigin}/`,
      contentDigest: contentDigest(readFileSync(join(packageDir, 'content.json'), 'utf8')),
    });
    expect(report.steps).toEqual([]);
    expect(report.cleanupWarnings).toEqual([expect.stringContaining('Failed to retire Cloud stack lease')]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to retire Cloud stack lease'));
    const reportAndLogs = [
      readFileSync(reportPath, 'utf8'),
      ...logSpy.mock.calls.flat(),
      ...errorSpy.mock.calls.flat(),
      ...warnSpy.mock.calls.flat(),
    ].join(' ');
    expect(reportAndLogs).not.toContain(callerToken);
    expect(reportAndLogs).not.toContain(runnerToken);
  });

  it.each([
    { name: 'health without version', health: { database: 'ok' } },
    { name: 'conflicting health version', health: { database: 'ok', version: '10.0.0' } },
  ])('executes a local cloud guide after $name when frontend settings meet minVersion', async ({ health }) => {
    const packageDir = join(root, 'cloud-guide');
    writeFileSync(
      join(packageDir, 'manifest.json'),
      JSON.stringify({
        id: 'cloud-guide',
        type: 'guide',
        testEnvironment: { tier: 'cloud', minVersion: '12.2.0', plugins: ['required-plugin'] },
      })
    );
    allowRequiredPlugin();
    const originalFetch = fetchSpy.getMockImplementation()!;
    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const pathname = new URL(input.toString()).pathname;
      if (pathname === '/api/health') {
        return Promise.resolve(jsonResponse(health));
      }
      if (pathname === '/api/frontend/settings') {
        return Promise.resolve(jsonResponse({ buildInfo: { version: '13.3.0-35886682902' } }));
      }
      return originalFetch(input, init);
    });
    jest.mocked(runPlaywrightTests).mockResolvedValue({
      success: true,
      exitCode: ExitCode.SUCCESS,
      resultsData: fakeGuideData('cloud-guide', true),
    });
    const reportPath = join(root, 'version-pass-report.json');
    await expect(runE2e(cloudOptions(packageDir, reportPath))).resolves.toMatchObject({ status: 'ok' });
    expect(runPlaywrightTests).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls.map(([input]) => new URL(input.toString()).pathname)).toEqual([
      '/v1/leases',
      '/api/health',
      '/api/frontend/settings',
      '/api/plugins',
      '/v1/leases/lease-for-cloud-guide/retire',
    ]);
    const settingsRequest = fetchSpy.mock.calls[2]![1] as RequestInit;
    expect(settingsRequest.headers).toMatchObject({ Authorization: `Bearer ${runnerToken}` });
    expect(settingsRequest.redirect).toBe('error');
    expect((fetchSpy.mock.calls[1]![1] as RequestInit).headers).not.toHaveProperty('Authorization');
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toMatchObject({ outcome: 'passed' });
  });

  it('fails on an explicitly empty minVersion and retires the fake lease before browser execution', async () => {
    const packageDir = join(root, 'cloud-guide');
    writeFileSync(
      join(packageDir, 'manifest.json'),
      JSON.stringify({ id: 'cloud-guide', type: 'guide', testEnvironment: { tier: 'cloud', minVersion: '' } })
    );
    const reportPath = join(root, 'empty-min-version-report.json');
    await expect(runE2e(cloudOptions(packageDir, reportPath))).rejects.toThrow(
      `CLI exited with ${ExitCode.CONFIGURATION_ERROR}`
    );
    expect(fetchSpy.mock.calls.map(([input]) => new URL(input.toString()).pathname)).toEqual([
      '/v1/leases',
      '/api/health',
      '/v1/leases/lease-for-cloud-guide/retire',
    ]);
    expect(runPlaywrightTests).not.toHaveBeenCalled();
    expect(runPlaywrightChain).not.toHaveBeenCalled();
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
    expect(report.outcome).not.toBe('passed');
    expect(report.errorMessage).toContain('minVersion must not be empty');
    expect(report.guide.id).toBe('cloud-guide');
  });

  it('runs without minVersion and retires the fake lease once', async () => {
    allowRequiredPlugin();
    jest.mocked(runPlaywrightTests).mockResolvedValue({
      success: true,
      exitCode: ExitCode.SUCCESS,
      resultsData: fakeGuideData('cloud-guide', true),
    });
    const reportPath = join(root, 'no-min-version-report.json');
    await expect(runE2e(cloudOptions(join(root, 'cloud-guide'), reportPath))).resolves.toMatchObject({ status: 'ok' });
    expect(fetchSpy.mock.calls.map(([input]) => new URL(input.toString()).pathname)).toEqual([
      '/v1/leases',
      '/api/health',
      '/api/plugins',
      '/v1/leases/lease-for-cloud-guide/retire',
    ]);
    expect(runPlaywrightTests).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toMatchObject({ outcome: 'passed' });
  });

  it.each([
    { name: 'missing version', settings: { buildInfo: {} }, status: 200, expected: 'valid buildInfo.version' },
    {
      name: 'invalid version',
      settings: { buildInfo: { version: 'invalid' } },
      status: 200,
      expected: 'valid buildInfo.version',
    },
    { name: 'unauthorized settings', settings: { error: 'unauthorized' }, status: 401, expected: 'HTTP 401' },
    { name: 'redirected settings', settings: {}, status: 302, expected: 'HTTP 302' },
  ])('fails closed on $name and retires the fake lease once', async ({ settings, status, expected }) => {
    const packageDir = join(root, 'cloud-guide');
    writeFileSync(
      join(packageDir, 'manifest.json'),
      JSON.stringify({ id: 'cloud-guide', type: 'guide', testEnvironment: { tier: 'cloud', minVersion: '12.2.0' } })
    );
    const originalFetch = fetchSpy.getMockImplementation()!;
    fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const pathname = new URL(input.toString()).pathname;
      if (pathname === '/api/health') {
        return Promise.resolve(jsonResponse({ database: 'ok', version: '14.0.0' }));
      }
      if (pathname === '/api/frontend/settings') {
        return Promise.resolve(jsonResponse(settings, status));
      }
      return originalFetch(input, init);
    });
    const reportPath = join(root, 'version-failure-report.json');
    await expect(runE2e(cloudOptions(packageDir, reportPath))).rejects.toThrow(
      `CLI exited with ${ExitCode.CONFIGURATION_ERROR}`
    );
    expect(fetchSpy.mock.calls.map(([input]) => new URL(input.toString()).pathname)).toEqual([
      '/v1/leases',
      '/api/health',
      '/api/frontend/settings',
      '/v1/leases/lease-for-cloud-guide/retire',
    ]);
    expect((fetchSpy.mock.calls[2]![1] as RequestInit).redirect).toBe('error');
    expect(runPlaywrightTests).not.toHaveBeenCalled();
    expect(runPlaywrightChain).not.toHaveBeenCalled();
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
    expect(report.outcome).not.toBe('passed');
    expect(report.errorMessage).toContain(expected);
    expect(report.target.url).toBe(`${targetOrigin}/`);
    expect(report.guide.id).toBe('cloud-guide');
    const retireRequests = fetchSpy.mock.calls.filter(
      ([input]) => new URL(input.toString()).pathname === '/v1/leases/lease-for-cloud-guide/retire'
    );
    expect(retireRequests).toHaveLength(1);
    const reportAndLogs = [readFileSync(reportPath, 'utf8'), ...errorSpy.mock.calls.flat()].join(' ');
    expect(reportAndLogs).not.toContain(callerToken);
    expect(reportAndLogs).not.toContain(runnerToken);
  });

  it.each([
    { name: 'empty guide', blocks: [] },
    {
      name: 'nested read-only blocks',
      blocks: [{ type: 'section', title: 'Overview', blocks: [{ type: 'markdown', content: 'Read this first' }] }],
    },
  ])('does not lease or pass a $name with no interactive blocks', async ({ blocks }) => {
    const packageDir = join(root, 'cloud-guide');
    writeFileSync(
      join(packageDir, 'content.json'),
      JSON.stringify({ id: 'cloud-guide', title: 'Cloud guide', blocks })
    );
    const reportPath = join(root, 'zero-step-report.json');
    const options = E2eCommand.parse({
      package: packageDir,
      repository: root,
      tier: 'cloud',
      cloudStackPoolManagerUrl: `${managerOrigin}/`,
      cloudStackPoolManagerToken: tokenVariable,
      cloudStackPoolId: 'ci',
      output: reportPath,
      artifacts: join(root, 'artifacts'),
    });

    await expect(runE2e(options)).resolves.toMatchObject({ status: 'ok', summary: 'Nothing to run' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(runPlaywrightTests).not.toHaveBeenCalled();
    expect(runPlaywrightChain).not.toHaveBeenCalled();
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as SkipReport;
    expect(report.outcome).toBe('skipped');
    expect(report.summary).toMatchObject({ totalGuides: 1, passedGuides: 0, failedGuides: 0, skippedGuides: 1 });
    expect(report.preRunSkipped).toEqual([
      expect.objectContaining({ id: 'cloud-guide', reason: 'resolution_failed', failed: false }),
    ]);
    expect(report.preRunSkipped[0]!.message).toContain('no interactive blocks to test');
  });

  it('keeps a guide with an interactive block nested in a section eligible for cloud routing', async () => {
    const packageDir = join(root, 'cloud-guide');
    writeFileSync(
      join(packageDir, 'content.json'),
      JSON.stringify({
        id: 'cloud-guide',
        title: 'Cloud guide',
        blocks: [
          {
            type: 'section',
            title: 'Setup',
            blocks: [
              {
                type: 'interactive',
                action: 'highlight',
                reftarget: '[data-testid="step"]',
                content: 'Inspect a step',
              },
            ],
          },
        ],
      })
    );
    const options = E2eCommand.parse({
      package: packageDir,
      repository: root,
      tier: 'cloud',
      cloudStackPoolManagerUrl: `${managerOrigin}/`,
      cloudStackPoolManagerToken: tokenVariable,
      cloudStackPoolId: 'ci',
      output: join(root, 'nested-interactive-report.json'),
      artifacts: join(root, 'artifacts'),
    });

    await expect(runE2e(options)).rejects.toThrow(`CLI exited with ${ExitCode.CONFIGURATION_ERROR}`);
    expect(fetchSpy.mock.calls.map(([input]) => new URL(input.toString()).pathname)).toEqual([
      '/v1/leases',
      '/api/health',
      '/api/plugins',
      '/v1/leases/lease-for-cloud-guide/retire',
    ]);
  });

  it.each([
    {
      name: 'nested snippet reference',
      block: {
        type: 'section',
        title: 'Setup',
        blocks: [{ type: 'snippet-ref', snippetId: 'published-snippet' }],
      },
      expected: 'snippet-ref',
    },
    {
      name: 'navigate openGuide',
      block: {
        type: 'interactive',
        action: 'navigate',
        content: 'Open the next guide',
        reftarget: '/explore',
        openGuide: 'bundled:published-guide',
      },
      expected: 'navigate openGuide',
    },
    {
      name: 'nested step legacy doc link',
      block: {
        type: 'multistep',
        content: 'Follow the setup',
        steps: [
          {
            action: 'navigate',
            content: 'Open the next guide',
            reftarget: '/explore?doc=published:guide',
          },
        ],
      },
      expected: 'navigate ?doc= link',
    },
  ])('does not lease or execute for $name', async ({ block, expected }) => {
    const packageDir = join(root, 'cloud-guide');
    const contentPath = join(packageDir, 'content.json');
    const original = JSON.parse(readFileSync(contentPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(contentPath, JSON.stringify({ ...original, blocks: [block] }));
    const reportPath = join(root, 'unsupported-reference-report.json');
    const options = E2eCommand.parse({
      package: packageDir,
      repository: join(root, 'repository.json'),
      tier: 'cloud',
      cloudStackPoolManagerUrl: `${managerOrigin}/`,
      cloudStackPoolManagerToken: tokenVariable,
      cloudStackPoolId: 'ci',
      output: reportPath,
      artifacts: join(root, 'artifacts'),
    });

    await expect(runE2e(options)).resolves.toMatchObject({ status: 'ok', summary: 'Nothing to run' });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(runPlaywrightTests).not.toHaveBeenCalled();
    expect(runPlaywrightChain).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as SkipReport;
    expect(report.outcome).toBe('skipped');
    expect(report.summary).toMatchObject({ totalGuides: 1, passedGuides: 0, failedGuides: 0, skippedGuides: 1 });
    expect(report.preRunSkipped).toEqual([
      expect.objectContaining({ id: 'cloud-guide', reason: 'resolution_failed', failed: false, tier: 'cloud' }),
    ]);
    expect(report.preRunSkipped[0]!.message).toContain('Local cloud guide "cloud-guide"');
    expect(report.preRunSkipped[0]!.message).toContain(expected);
  });

  it.each(['guide', 'path'] as const)(
    'skips a local-tier %s without a repository or cloud credentials',
    async (type) => {
      const packageDir = join(root, 'cloud-guide');
      writeFileSync(
        join(packageDir, 'manifest.json'),
        JSON.stringify({
          id: 'local-only',
          type,
          ...(type === 'path' ? { milestones: ['cloud-guide'] } : {}),
          testEnvironment: { tier: 'local' },
        })
      );
      const reportPath = join(root, 'tier-skip.json');
      const options = E2eCommand.parse({
        package: packageDir,
        tier: 'cloud',
        output: reportPath,
        artifacts: join(root, 'artifacts'),
      });

      await expect(runE2e(options)).resolves.toMatchObject({ status: 'ok', summary: 'Nothing to run' });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(runPlaywrightTests).not.toHaveBeenCalled();
      expect(runPlaywrightChain).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as SkipReport;
      expect(report.outcome).toBe('skipped');
      expect(report.selection).toEqual(type === 'path' ? { id: 'local-only', type: 'path' } : undefined);
      expect(report.summary).toMatchObject({ totalGuides: 1, passedGuides: 0, failedGuides: 0, skippedGuides: 1 });
      expect(report.preRunSkipped).toEqual([
        expect.objectContaining({ id: 'local-only', reason: 'skipped_tier_mismatch', failed: false, tier: 'local' }),
      ]);
      expect(report.preRunSkipped[0]!.message).toContain('requires tier "local" rather than cloud');
    }
  );

  it.each(['guide', 'path'] as const)(
    'records an unsupported required leaf and selected %s root without leasing',
    async (type) => {
      const packageDir = join(root, 'cloud-guide');
      const leafDir = join(root, 'required-leaf');
      mkdirSync(leafDir);
      writeFileSync(
        join(leafDir, 'manifest.json'),
        JSON.stringify({ id: 'required-leaf', type: 'guide', testEnvironment: { tier: 'cloud' } })
      );
      writeFileSync(
        join(leafDir, 'content.json'),
        JSON.stringify({
          id: 'required-leaf',
          title: 'Required leaf',
          blocks: [{ type: 'snippet-ref', snippetId: 'published-ref' }],
        })
      );
      const manifest =
        type === 'path'
          ? { id: 'cloud-path', type: 'path', milestones: ['required-leaf'], testEnvironment: { tier: 'cloud' } }
          : { id: 'cloud-guide', type: 'guide', depends: ['required-leaf'], testEnvironment: { tier: 'cloud' } };
      writeFileSync(join(packageDir, 'manifest.json'), JSON.stringify(manifest));
      if (type === 'path') {
        writeFileSync(
          join(packageDir, 'content.json'),
          JSON.stringify({ id: manifest.id, title: 'Cloud path', blocks: [] })
        );
      }
      writeFileSync(
        join(root, 'repository.json'),
        JSON.stringify({
          [manifest.id]: { path: 'cloud-guide/', ...manifest },
          'required-leaf': { path: 'required-leaf/', type: 'guide', testEnvironment: { tier: 'cloud' } },
        })
      );
      const reportPath = join(root, 'leaf-skip.json');
      const options = E2eCommand.parse({
        package: packageDir,
        repository: join(root, 'repository.json'),
        tier: 'cloud',
        cloudStackPoolManagerUrl: `${managerOrigin}/`,
        cloudStackPoolManagerToken: tokenVariable,
        cloudStackPoolId: 'ci',
        output: reportPath,
        artifacts: join(root, 'artifacts'),
      });

      await expect(runE2e(options)).resolves.toMatchObject({ status: 'ok', summary: 'Nothing to run' });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(runPlaywrightTests).not.toHaveBeenCalled();
      expect(runPlaywrightChain).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as SkipReport;
      expect(report.outcome).toBe('skipped');
      expect(report.selection).toEqual(type === 'path' ? { id: 'cloud-path', type: 'path' } : undefined);
      expect(report.summary).toMatchObject({ totalGuides: 2, passedGuides: 0, failedGuides: 0, skippedGuides: 2 });
      expect(report.preRunSkipped).toEqual([
        expect.objectContaining({ id: 'required-leaf', reason: 'resolution_failed', failed: false }),
        expect.objectContaining({ id: manifest.id, reason: 'prerequisite_failed', failed: false }),
      ]);
      expect(report.preRunSkipped[0]!.message).toContain('snippet-ref');
      expect(report.preRunSkipped[1]!.message).toContain('required-leaf');
    }
  );

  it.each(['guide', 'path'] as const)(
    'reports zero-step %s leaf and every other unexecuted leaf before leasing',
    async (type) => {
      const packageDir = join(root, 'cloud-guide');
      const zeroDir = join(root, 'zero-leaf');
      const healthyDir = join(root, 'healthy-leaf');
      mkdirSync(zeroDir);
      mkdirSync(healthyDir);
      writeFileSync(
        join(zeroDir, 'manifest.json'),
        JSON.stringify({ id: 'zero-leaf', type: 'guide', testEnvironment: { tier: 'cloud' } })
      );
      writeFileSync(
        join(zeroDir, 'content.json'),
        JSON.stringify({ id: 'zero-leaf', title: 'No steps', blocks: [{ type: 'markdown', content: 'Read this' }] })
      );
      writeFileSync(
        join(healthyDir, 'manifest.json'),
        JSON.stringify({ id: 'healthy-leaf', type: 'guide', testEnvironment: { tier: 'cloud' } })
      );
      writeFileSync(
        join(healthyDir, 'content.json'),
        JSON.stringify({
          id: 'healthy-leaf',
          title: 'Interactive',
          blocks: [{ type: 'interactive', action: 'highlight', reftarget: '[data-testid="step"]', content: 'Inspect' }],
        })
      );
      const selectedId = type === 'path' ? 'cloud-path' : 'cloud-guide';
      writeFileSync(
        join(packageDir, 'manifest.json'),
        JSON.stringify({
          id: selectedId,
          type,
          ...(type === 'path'
            ? { milestones: ['healthy-leaf', 'zero-leaf'] }
            : { depends: ['zero-leaf', 'healthy-leaf'] }),
          testEnvironment: { tier: 'cloud' },
        })
      );
      if (type === 'path') {
        writeFileSync(
          join(packageDir, 'content.json'),
          JSON.stringify({ id: selectedId, title: 'Cloud path', blocks: [] })
        );
      }
      const reportPath = join(root, 'zero-leaf-report.json');
      const options = E2eCommand.parse({
        package: packageDir,
        repository: root,
        tier: 'cloud',
        cloudStackPoolManagerUrl: `${managerOrigin}/`,
        cloudStackPoolManagerToken: tokenVariable,
        cloudStackPoolId: 'ci',
        output: reportPath,
        artifacts: join(root, 'artifacts'),
      });

      await expect(runE2e(options)).resolves.toMatchObject({ status: 'ok', summary: 'Nothing to run' });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(runPlaywrightTests).not.toHaveBeenCalled();
      expect(runPlaywrightChain).not.toHaveBeenCalled();
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as SkipReport;
      expect(report.outcome).toBe('skipped');
      expect(report.summary).toMatchObject({ totalGuides: 3, passedGuides: 0, failedGuides: 0, skippedGuides: 3 });
      expect(report.selection).toEqual(type === 'path' ? { id: selectedId, type: 'path' } : undefined);
      expect(report.preRunSkipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'zero-leaf', reason: 'resolution_failed', failed: false }),
          expect.objectContaining({ id: 'healthy-leaf', reason: 'resolution_failed', failed: false }),
          expect.objectContaining({ id: selectedId, failed: false }),
        ])
      );
      expect(report.preRunSkipped.find((entry) => entry.id === 'zero-leaf')?.message).toContain(
        'no interactive blocks to test'
      );
      expect(report.preRunSkipped.find((entry) => entry.id === 'healthy-leaf')?.message).toContain(
        'did not execute because guide "zero-leaf"'
      );
    }
  );

  it('accepts a checkout directory with no repository.json and skips before leasing when a source is unsupported', async () => {
    const packageDir = join(root, 'cloud-guide');
    const contentPath = join(packageDir, 'content.json');
    writeFileSync(
      contentPath,
      JSON.stringify({
        id: 'cloud-guide',
        title: 'Cloud guide',
        blocks: [{ type: 'snippet-ref', snippetId: 'unpublished-snippet' }],
      })
    );
    rmSync(join(root, 'repository.json'));
    const reportPath = join(root, 'directory-source-skip.json');
    const options = E2eCommand.parse({
      package: packageDir,
      repository: root,
      tier: 'cloud',
      cloudStackPoolManagerUrl: `${managerOrigin}/`,
      cloudStackPoolManagerToken: tokenVariable,
      cloudStackPoolId: 'ci',
      output: reportPath,
      artifacts: join(root, 'artifacts'),
    });

    await expect(runE2e(options)).resolves.toMatchObject({ status: 'ok', summary: 'Nothing to run' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(runPlaywrightTests).not.toHaveBeenCalled();
    expect(runPlaywrightChain).not.toHaveBeenCalled();
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as SkipReport;
    expect(report.outcome).toBe('skipped');
    expect(report.preRunSkipped[0]?.message).toContain('snippet-ref');
    expect(existsSync(join(root, 'repository.json'))).toBe(false);
  });

  it('does not lease or start browser steps when the checkout dependency graph is incomplete', async () => {
    const packageDir = join(root, 'cloud-guide');
    const manifest = JSON.parse(readFileSync(join(packageDir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    writeFileSync(
      join(packageDir, 'manifest.json'),
      JSON.stringify({ ...manifest, depends: ['uncommitted-missing-prerequisite'] })
    );
    const reportPath = join(root, 'missing-prerequisite.json');
    const options = E2eCommand.parse({
      package: packageDir,
      repository: join(root, 'repository.json'),
      tier: 'cloud',
      cloudStackPoolManagerUrl: `${managerOrigin}/`,
      cloudStackPoolManagerToken: tokenVariable,
      cloudStackPoolId: 'ci',
      output: reportPath,
      artifacts: join(root, 'artifacts'),
    });

    await expect(runE2e(options)).rejects.toThrow(`CLI exited with ${ExitCode.CONFIGURATION_ERROR}`);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(runPlaywrightTests).not.toHaveBeenCalled();
    expect(runPlaywrightChain).not.toHaveBeenCalled();
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
    expect(report.errorMessage).toContain('uncommitted-missing-prerequisite');
  });

  it.each([
    { name: 'empty results', data: fakeGuideData('cloud-guide', false) },
    {
      name: 'only skipped results counted by coverage as executed',
      data: {
        ...fakeGuideData('cloud-guide', true),
        results: [
          {
            stepId: 'browser-step',
            status: 'skipped' as const,
            durationMs: 0,
            currentUrl: `${targetOrigin}/`,
            consoleErrors: [],
            skippable: true,
          },
        ],
      },
    },
    {
      name: 'only not-reached results',
      data: {
        ...fakeGuideData('cloud-guide', false),
        results: [
          {
            stepId: 'browser-step',
            status: 'not_reached' as const,
            durationMs: 0,
            currentUrl: `${targetOrigin}/`,
            consoleErrors: [],
            skippable: false,
          },
        ],
      },
    },
    {
      name: 'inconsistent zero coverage',
      data: {
        ...fakeGuideData('cloud-guide', true),
        coverage: fakeGuideData('cloud-guide', false).coverage,
      },
    },
  ])('does not pass a browser result with $name and retires its lease once', async ({ data }) => {
    allowRequiredPlugin();
    jest.mocked(runPlaywrightTests).mockResolvedValue({
      success: true,
      exitCode: ExitCode.SUCCESS,
      resultsData: data,
    });
    const reportPath = join(root, 'browser-zero-steps.json');

    await expect(runE2e(cloudOptions(join(root, 'cloud-guide'), reportPath))).resolves.toMatchObject({ status: 'ok' });

    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      outcome: string;
      guide: { id: string; targetUrl: string };
      errorMessage: string;
      steps: Array<{ status: string }>;
    };
    expect(report.outcome).toBe('skipped');
    expect(report.guide).toMatchObject({ id: 'cloud-guide', targetUrl: `${targetOrigin}/` });
    expect(report.errorMessage).toContain('No guide steps executed');
    expect(report.steps).toHaveLength(data.results.length);
    expect(runPlaywrightTests).toHaveBeenCalledTimes(1);
    expect(runPlaywrightChain).not.toHaveBeenCalled();
    const retireRequests = fetchSpy.mock.calls.filter(
      ([input]) => new URL(input.toString()).pathname === '/v1/leases/lease-for-cloud-guide/retire'
    );
    expect(retireRequests).toHaveLength(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('retires a provisioned fake lease once when SIGTERM interrupts pending browser execution', async () => {
    allowRequiredPlugin();
    let completeBrowser!: (value: Awaited<ReturnType<typeof runPlaywrightTests>>) => void;
    jest.mocked(runPlaywrightTests).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeBrowser = resolve;
        })
    );
    const reportPath = join(root, 'interrupted-browser-report.json');
    exitSpy.mockImplementation(() => undefined as never);
    const running = runE2e(cloudOptions(join(root, 'cloud-guide'), reportPath));

    for (let attempt = 0; attempt < 30 && !jest.mocked(runPlaywrightTests).mock.calls.length; attempt++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    expect(runPlaywrightTests).toHaveBeenCalledTimes(1);
    const signalHandlers = process
      .listeners('SIGTERM')
      .filter((handler) => !existingHandlers.get('SIGTERM')?.includes(handler));
    expect(signalHandlers).toHaveLength(1);
    await (signalHandlers[0] as (signal: NodeJS.Signals) => Promise<void>)('SIGTERM');

    const retireRequests = fetchSpy.mock.calls.filter(
      ([input]) => new URL(input.toString()).pathname === '/v1/leases/lease-for-cloud-guide/retire'
    );
    expect(retireRequests).toHaveLength(1);
    expect(JSON.parse((retireRequests[0]![1] as RequestInit).body as string)).toMatchObject({
      outcome: 'cancelled',
      used: true,
      summary: 'Interrupted by SIGTERM',
    });
    expect(exitSpy).toHaveBeenCalledWith(143);

    completeBrowser({
      success: false,
      exitCode: ExitCode.TEST_FAILURE,
      resultsData: { ...fakeGuideData('cloud-guide', true), outcome: 'failed', errorMessage: 'Synthetic failure' },
    });
    await running;
    expect(
      fetchSpy.mock.calls.filter(
        ([input]) => new URL(input.toString()).pathname === '/v1/leases/lease-for-cloud-guide/retire'
      )
    ).toHaveLength(1);
    expect(JSON.parse(readFileSync(reportPath, 'utf8')).outcome).not.toBe('passed');
  });

  it('runs staged guide and prerequisite bytes after the original checkout changes', async () => {
    const packageDir = join(root, 'cloud-guide');
    const prerequisiteDir = join(root, 'prerequisite');
    mkdirSync(prerequisiteDir);
    writeFileSync(
      join(prerequisiteDir, 'manifest.json'),
      JSON.stringify({ id: 'prerequisite', type: 'guide', testEnvironment: { tier: 'cloud' } })
    );
    writeFileSync(
      join(prerequisiteDir, 'content.json'),
      JSON.stringify({
        id: 'prerequisite',
        title: 'Pinned prerequisite',
        blocks: [{ type: 'interactive', action: 'highlight', reftarget: '[data-testid="pinned"]', content: 'Inspect' }],
      })
    );
    writeFileSync(
      join(packageDir, 'manifest.json'),
      JSON.stringify({
        id: 'cloud-guide',
        type: 'guide',
        depends: ['prerequisite'],
        testEnvironment: { tier: 'cloud', plugins: ['required-plugin'] },
      })
    );
    const stagedParent = mkdtempSync(join(tmpdir(), 'pathfinder-pinned-source-'));
    const stagedRoot = join(stagedParent, 'source');
    try {
      cpSync(root, stagedRoot, { recursive: true });
      const pinnedGuide = readFileSync(join(stagedRoot, 'cloud-guide', 'content.json'), 'utf8');
      const pinnedPrerequisite = readFileSync(join(stagedRoot, 'prerequisite', 'content.json'), 'utf8');
      const pinnedDigests = [contentDigest(pinnedPrerequisite), contentDigest(pinnedGuide)];

      writeFileSync(join(packageDir, 'content.json'), '{"invalid":');
      rmSync(prerequisiteDir, { recursive: true });
      allowRequiredPlugin();
      jest.mocked(runPlaywrightTests).mockImplementation(async (guide) => {
        const id = (JSON.parse(guide.content) as { id: string }).id;
        const data = fakeGuideData(id, true);
        return {
          success: true,
          exitCode: ExitCode.SUCCESS,
          resultsData: { ...data, guide: { ...data.guide, contentDigest: contentDigest(guide.content) } },
        };
      });
      const reportPath = join(root, 'pinned-source-report.json');
      const options = E2eCommand.parse({
        package: join(stagedRoot, 'cloud-guide'),
        repository: stagedRoot,
        tier: 'cloud',
        cloudStackPoolManagerUrl: `${managerOrigin}/`,
        cloudStackPoolManagerToken: tokenVariable,
        cloudStackPoolId: 'ci',
        output: reportPath,
        artifacts: join(root, 'artifacts'),
      });

      await expect(runE2e(options)).resolves.toMatchObject({ status: 'ok' });
      const submittedGuides = jest.mocked(runPlaywrightTests).mock.calls.map(([guide]) => guide);
      expect(submittedGuides.map((guide) => guide.content)).toEqual([pinnedPrerequisite, pinnedGuide]);
      const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
        reports: Array<{ guide: { id: string; contentDigest: string } }>;
      };
      expect(report.reports.map((item) => item.guide.contentDigest)).toEqual(pinnedDigests);
      expect(runPlaywrightChain).not.toHaveBeenCalled();
      expect(
        fetchSpy.mock.calls.filter(([input]) => new URL(input.toString()).pathname.endsWith('/retire'))
      ).toHaveLength(1);
    } finally {
      rmSync(stagedParent, { recursive: true, force: true });
    }
  });

  it('keeps a local cloud guide passed after a step actually executed', async () => {
    allowRequiredPlugin();
    jest.mocked(runPlaywrightTests).mockResolvedValue({
      success: true,
      exitCode: ExitCode.SUCCESS,
      resultsData: fakeGuideData('cloud-guide', true),
    });
    const reportPath = join(root, 'browser-step-passed.json');

    await expect(runE2e(cloudOptions(join(root, 'cloud-guide'), reportPath))).resolves.toMatchObject({ status: 'ok' });

    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      outcome: string;
      guide: { id: string };
      summary: { passed: number };
    };
    expect(report.outcome).toBe('passed');
    expect(report.guide.id).toBe('cloud-guide');
    expect(report.summary.passed).toBe(1);
    expect(runPlaywrightTests).toHaveBeenCalledTimes(1);
    expect(
      fetchSpy.mock.calls.filter(([input]) => new URL(input.toString()).pathname.endsWith('/retire'))
    ).toHaveLength(1);
  });

  it('retains passed sibling evidence when a path milestone has only skipped browser steps', async () => {
    allowRequiredPlugin();
    const secondDir = join(root, 'second-guide');
    mkdirSync(secondDir);
    writeFileSync(
      join(secondDir, 'manifest.json'),
      JSON.stringify({ id: 'second-guide', type: 'guide', testEnvironment: { tier: 'cloud' } })
    );
    writeFileSync(
      join(secondDir, 'content.json'),
      JSON.stringify({
        id: 'second-guide',
        title: 'Second guide',
        blocks: [{ type: 'interactive', action: 'highlight', reftarget: '[data-testid="second"]', content: 'Inspect' }],
      })
    );
    writeFileSync(
      join(root, 'cloud-guide', 'manifest.json'),
      JSON.stringify({
        id: 'cloud-path',
        type: 'path',
        milestones: ['cloud-guide', 'second-guide'],
        testEnvironment: { tier: 'cloud', plugins: ['required-plugin'] },
      })
    );
    writeFileSync(
      join(root, 'cloud-guide', 'content.json'),
      JSON.stringify({ id: 'cloud-path', title: 'Cloud path', blocks: [] })
    );
    const leafDir = join(root, 'first-guide');
    mkdirSync(leafDir);
    writeFileSync(
      join(leafDir, 'manifest.json'),
      JSON.stringify({ id: 'cloud-guide', type: 'guide', testEnvironment: { tier: 'cloud' } })
    );
    writeFileSync(
      join(leafDir, 'content.json'),
      JSON.stringify({
        id: 'cloud-guide',
        title: 'First guide',
        blocks: [{ type: 'interactive', action: 'highlight', reftarget: '[data-testid="first"]', content: 'Inspect' }],
      })
    );
    jest.mocked(runPlaywrightChain).mockImplementation(async (guides) => ({
      success: true,
      exitCode: ExitCode.SUCCESS,
      resultsData: guides.map((guide) =>
        guide.id === 'second-guide'
          ? fakeGuideData(guide.id, true)
          : {
              ...fakeGuideData(guide.id, true),
              results: [
                {
                  stepId: 'browser-step',
                  status: 'skipped' as const,
                  durationMs: 0,
                  currentUrl: `${targetOrigin}/`,
                  consoleErrors: [],
                  skippable: true,
                },
              ],
            }
      ),
    }));
    const reportPath = join(root, 'browser-path-zero-steps.json');

    await expect(runE2e(cloudOptions(join(root, 'cloud-guide'), reportPath))).resolves.toMatchObject({ status: 'ok' });

    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      outcome: string;
      selection: { id: string; type: string };
      summary: { passedGuides: number; skippedGuides: number };
      reports: Array<{ outcome: string; guide: { id: string }; errorMessage?: string }>;
    };
    expect(report.selection).toEqual({ id: 'cloud-path', type: 'path' });
    expect(report.outcome).toBe('skipped');
    expect(report.summary).toMatchObject({ passedGuides: 1, skippedGuides: 1 });
    expect(report.reports.find((item) => item.guide.id === 'second-guide')?.outcome).toBe('passed');
    expect(report.reports.find((item) => item.guide.id === 'cloud-guide')).toMatchObject({
      outcome: 'skipped',
      errorMessage: expect.stringContaining('No guide steps executed'),
    });
    expect(runPlaywrightChain).toHaveBeenCalledTimes(1);
    expect(runPlaywrightTests).not.toHaveBeenCalled();
    expect(
      fetchSpy.mock.calls.filter(([input]) => new URL(input.toString()).pathname.endsWith('/retire'))
    ).toHaveLength(1);
  });

  it('does not claim a leased target when source resolution fails before a lease', async () => {
    const reportPath = join(root, 'report.json');
    const options = E2eCommand.parse({
      package: join(root, 'cloud-guide'),
      repository: join(root, 'missing-repository.json'),
      tier: 'cloud',
      cloudStackPoolManagerUrl: `${managerOrigin}/`,
      cloudStackPoolManagerToken: tokenVariable,
      cloudStackPoolId: 'ci',
      output: reportPath,
      artifacts: join(root, 'artifacts'),
    });

    await expect(runE2e(options)).rejects.toThrow(`CLI exited with ${ExitCode.CONFIGURATION_ERROR}`);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(runPlaywrightTests).not.toHaveBeenCalled();
    expect(runPlaywrightChain).not.toHaveBeenCalled();
    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
    expect(report.outcome).not.toBe('passed');
    expect(report.guide).not.toHaveProperty('targetUrl');
    expect(report.target.url).toBe('unknown://target');
    const reportAndLogs = [
      readFileSync(reportPath, 'utf8'),
      ...logSpy.mock.calls.flat(),
      ...errorSpy.mock.calls.flat(),
    ].join(' ');
    expect(reportAndLogs).not.toContain(targetOrigin);
    expect(reportAndLogs).not.toContain(callerToken);
    expect(reportAndLogs).not.toContain(runnerToken);
  });
});
