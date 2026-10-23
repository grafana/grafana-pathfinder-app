/**
 * @jest-environment node
 *
 * The author on guides the authoring MCP produces: supplied at create, carried by
 * the session, defaulted at finalize, and never read from the server host unless the
 * transport opts in (`identityFromEnvironment`, stdio only).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { CURRENT_SCHEMA_VERSION } from '../../../types/json-guide.schema';
import { readGitUserName } from '../../utils/local-identity';
import { InMemorySessionStore } from '../lib/session-store';
import { buildServer, type BuildServerOptions } from '../server';

jest.mock('../../utils/local-identity', () => ({ readGitUserName: jest.fn() }));

const gitName = readGitUserName as jest.MockedFunction<typeof readGitUserName>;

interface ToolPayload {
  status?: string;
  sessionToken?: string;
  artifact?: { content: Record<string, unknown>; manifest?: Record<string, unknown> };
  resource?: { spec: { manifest?: Record<string, unknown> } };
  validation?: unknown;
  [key: string]: unknown;
}

async function withServer<T>(
  options: BuildServerOptions,
  fn: (call: (name: string, args: Record<string, unknown>) => Promise<ToolPayload>) => Promise<T>
): Promise<T> {
  const server = buildServer({ sessionStore: new InMemorySessionStore(), ...options });
  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'manifest-author-test', version: '0' }, { capabilities: {} });
  await client.connect(clientT);
  try {
    return await fn(async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      const blocks = result.content as Array<{ type: string; text: string }>;
      return JSON.parse(blocks.find((b) => b.type === 'text')!.text) as ToolPayload;
    });
  } finally {
    await client.close();
    await server.close();
  }
}

const content = {
  id: 'stateless-guide',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  title: 'Stateless guide',
  blocks: [{ type: 'markdown', id: 'm-1', content: 'hello' }],
};

beforeEach(() => {
  gitName.mockReset();
  gitName.mockReturnValue('Git User');
});

describe('pathfinder_create_package author', () => {
  it('writes the supplied author and carries it through the session to finalize', async () => {
    await withServer({}, async (call) => {
      const created = await call('pathfinder_create_package', {
        opts: { title: 'Authored', authorName: 'Ada', authorTeam: 'Docs' },
      });
      expect(created.artifact?.manifest?.author).toEqual({ name: 'Ada', team: 'Docs' });

      const finalized = await call('pathfinder_finalize_for_app_platform', { sessionToken: created.sessionToken });
      expect(finalized.status).toBe('ready');
      expect(finalized.artifact?.manifest?.author).toEqual({ name: 'Ada', team: 'Docs' });
      expect(finalized.resource?.spec.manifest?.author).toEqual({ name: 'Ada', team: 'Docs' });
    });
  });

  it('defaults to pathfinder-mcp when no author is supplied', async () => {
    await withServer({}, async (call) => {
      const created = await call('pathfinder_create_package', { opts: { title: 'Anonymous' } });
      expect(created.artifact?.manifest?.author).toEqual({ name: 'pathfinder-mcp' });
    });
  });

  it('never reads host identity on a hosted server, even though git is configured', async () => {
    await withServer({}, async (call) => {
      const created = await call('pathfinder_create_package', { opts: { title: 'Hosted' } });
      expect(created.artifact?.manifest?.author).toEqual({ name: 'pathfinder-mcp' });
    });
    expect(gitName).not.toHaveBeenCalled();
  });

  it('uses git identity on a stdio-style server when no author is supplied', async () => {
    await withServer({ identityFromEnvironment: true }, async (call) => {
      const created = await call('pathfinder_create_package', { opts: { title: 'Local' } });
      expect(created.artifact?.manifest?.author).toEqual({ name: 'Git User' });
    });
  });

  it('lets a supplied author beat git identity on a stdio-style server', async () => {
    await withServer({ identityFromEnvironment: true }, async (call) => {
      const created = await call('pathfinder_create_package', { opts: { title: 'Local', authorName: 'Ada' } });
      expect(created.artifact?.manifest?.author).toEqual({ name: 'Ada' });
    });
  });

  it('falls back to pathfinder-mcp on a stdio-style server with no git identity', async () => {
    gitName.mockReturnValue(undefined);
    await withServer({ identityFromEnvironment: true }, async (call) => {
      const created = await call('pathfinder_create_package', { opts: { title: 'Local' } });
      expect(created.artifact?.manifest?.author).toEqual({ name: 'pathfinder-mcp' });
    });
  });
});

describe('pathfinder_finalize_for_app_platform author', () => {
  const finalize = (options: BuildServerOptions, manifest: Record<string, unknown> | undefined) =>
    withServer(options, (call) =>
      call('pathfinder_finalize_for_app_platform', {
        artifact: { content, ...(manifest ? { manifest } : {}) },
      })
    );
  const bareManifest = { id: 'stateless-guide', schemaVersion: CURRENT_SCHEMA_VERSION, type: 'guide' };

  it('fills pathfinder-mcp on a manifest that never went through create, in both outputs', async () => {
    const payload = await finalize({}, bareManifest);
    expect(payload.status).toBe('ready');
    expect(payload.artifact?.manifest?.author).toEqual({ name: 'pathfinder-mcp' });
    expect(payload.resource?.spec.manifest?.author).toEqual({ name: 'pathfinder-mcp' });
  });

  it('writes a manifest carrying the author when the artifact had none', async () => {
    const payload = await finalize({}, undefined);
    expect(payload.status).toBe('ready');
    expect(payload.artifact?.manifest).toMatchObject({ id: 'stateless-guide', author: { name: 'pathfinder-mcp' } });
    expect(payload.resource?.spec.manifest?.author).toEqual({ name: 'pathfinder-mcp' });
  });

  it('never overwrites an author the caller supplied, even with git identity available', async () => {
    const payload = await finalize({ identityFromEnvironment: true }, { ...bareManifest, author: { name: 'Grace' } });
    expect(payload.artifact?.manifest?.author).toEqual({ name: 'Grace' });
    expect(payload.resource?.spec.manifest?.author).toEqual({ name: 'Grace' });
  });

  it('replaces a fallback author only with a real local identity', async () => {
    const editor = { ...bareManifest, author: { name: 'pathfinder-block-editor' } };
    const local = await finalize({ identityFromEnvironment: true }, editor);
    expect(local.artifact?.manifest?.author).toEqual({ name: 'Git User' });

    const hosted = await finalize({}, editor);
    expect(hosted.artifact?.manifest?.author).toEqual({ name: 'pathfinder-block-editor' });
  });

  it('is never invalid for missing metadata: no category, description, startingLocation or targeting', async () => {
    const payload = await finalize({}, bareManifest);
    expect(payload.status).toBe('ready');
    const manifest = payload.artifact?.manifest ?? {};
    for (const key of ['category', 'description', 'startingLocation', 'targeting', 'minGrafanaVersion']) {
      expect(manifest).not.toHaveProperty(key);
    }
  });

  it('does not read host identity on a hosted server', async () => {
    await finalize({}, bareManifest);
    expect(gitName).not.toHaveBeenCalled();
  });
});
