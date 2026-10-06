/**
 * @jest-environment node
 *
 * `pathfinder-cli find-guides` through the Commander adapter. `global.fetch` is
 * mocked so no network I/O happens.
 */

import { Command } from 'commander';

import { __resetFindGuidesForTests, findGuidesSpec, runFindGuides } from '../commands/find-guides';
import { COMMANDER_COMMANDS } from '../cli-commands';
import { mountCommander } from '../contracts';
import { __resetRepositoryClientForTests, REPOSITORY_URL_ENV_VAR } from '../utils/repository-client';

const BASE = 'https://interactive-learning.grafana.net/packages/';

const sampleIndex = {
  'kubernetes-lp': {
    path: 'kubernetes-lp/',
    type: 'path',
    title: 'Monitor Kubernetes clusters',
    category: 'learning-path',
    startingLocation: '/a/grafana-k8s-app',
    milestones: ['kubernetes-lp-alerts'],
  },
  'kubernetes-lp-alerts': {
    path: 'kubernetes-lp-alerts/',
    type: 'guide',
    title: 'Install Kubernetes alerting rules',
    category: 'take-action',
  },
  'alerting-101': {
    path: 'alerting-101/',
    type: 'guide',
    title: 'Alerting 101',
    category: 'general',
  },
};

let fetchMock: jest.Mock;

beforeEach(() => {
  __resetRepositoryClientForTests();
  __resetFindGuidesForTests();
  delete process.env[REPOSITORY_URL_ENV_VAR];
  fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ etag: 'W/"v1"' }),
    json: async () => sampleIndex,
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(argv: string[]): Promise<Run> {
  const program = new Command().option('--format <format>').exitOverride();
  program.addCommand(mountCommander(findGuidesSpec));
  const stdout: string[] = [];
  const stderr: string[] = [];
  const out = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  const err = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  const exit = jest.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
  let code = -1;
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (error) {
    const match = /^exit (\d+)$/.exec((error as Error).message);
    if (!match) {
      throw error;
    }
    code = Number(match[1]);
  } finally {
    out.mockRestore();
    err.mockRestore();
    exit.mockRestore();
  }
  return { code, stdout: stdout.join(''), stderr: stderr.join('') };
}

describe('find-guides command', () => {
  it('is registered on the command line', () => {
    expect(COMMANDER_COMMANDS.has('find-guides')).toBe(true);
  });

  it('prints a readable ranked list by default', async () => {
    const { code, stdout } = await runCli(['find-guides', '--queries', 'kubernetes alerting', '--queries', 'k8s']);
    expect(code).toBe(0);
    expect(stdout).toContain('Found 2 guides');
    expect(stdout).toContain('1. Monitor Kubernetes clusters [path, strong]');
    expect(stdout).toContain('   starts in: /a/grafana-k8s-app');
    expect(stdout).toContain('   step 1: Install Kubernetes alerting rules');
    expect(stdout).toContain(
      `   open: /a/grafana-pathfinder-app?doc=${encodeURIComponent(`${BASE}kubernetes-lp/content.json`)}&type=learning-journey`
    );
  });

  it('prints the same payload the MCP tool returns with --format json', async () => {
    const { code, stdout } = await runCli([
      '--format',
      'json',
      'find-guides',
      '--queries',
      'alerting 101',
      '--limit',
      '1',
      '--instance-url',
      'https://stack1.grafana.net',
    ]);
    expect(code).toBe(0);
    const outcome = JSON.parse(stdout);
    expect(outcome.status).toBe('ok');
    expect(outcome.data).toEqual({
      results: [
        expect.objectContaining({
          id: 'alerting-101',
          relevance: 'strong',
          launchUrl: `https://stack1.grafana.net/a/grafana-pathfinder-app?doc=${encodeURIComponent(`${BASE}alerting-101/content.json`)}`,
        }),
      ],
      totalMatches: 2,
      noStrongMatch: false,
      catalogVersion: 'W/"v1"',
    });
  });

  it('accepts a page with no queries and filters by repeated categories', async () => {
    const { code, stdout } = await runCli(['find-guides', '--page-url', '/a/grafana-k8s-app/home']);
    expect(code).toBe(0);
    expect(stdout).toContain('Monitor Kubernetes clusters');

    const filtered = await runCli([
      '--format',
      'json',
      'find-guides',
      '--queries',
      'alerting',
      '--categories',
      'general',
      '--categories',
      'take-action',
    ]);
    expect(
      JSON.parse(filtered.stdout)
        .data.results.map((r: { id: string }) => r.id)
        .sort()
    ).toEqual(['alerting-101', 'kubernetes-lp']);
  });

  it('fails when neither queries nor a page is given', async () => {
    const { code, stderr } = await runCli(['find-guides']);
    expect(code).toBe(1);
    expect(stderr).toContain('Pass queries, pageUrl, or both.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an unknown category with the valid ones', async () => {
    const { code, stderr } = await runCli(['find-guides', '--queries', 'alerting', '--categories', 'nope']);
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown categories: nope. Valid categories: general, learning-path, take-action.');
  });
});

describe('runFindGuides', () => {
  it('says so when nothing matches and lists the categories', async () => {
    const outcome = await runFindGuides({ queries: ['quantum'], limit: 5 });
    expect(outcome).toMatchObject({
      status: 'ok',
      summary: 'No guides found',
      hints: ['Valid categories: general, learning-path, take-action'],
      data: { results: [], totalMatches: 0, noStrongMatch: true },
    });
  });

  it('reports repository HTTP failures with the status', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Unavailable', json: async () => ({}) });
    expect(await runFindGuides({ queries: ['alerting'], limit: 5 })).toMatchObject({
      status: 'error',
      code: 'HTTP_ERROR',
      data: { httpStatus: 503 },
    });
  });
});
