/**
 * Snapshot test for the `pathfinder_finalize_for_app_platform` payload.
 *
 * The shape of this payload is the contract P4 (Assistant handoff) reads
 * verbatim. Any change here is a contract change — failing this snapshot
 * means update P4's parser too. Keep the artifact deterministic (fixed id,
 * single markdown block) so the snapshot stays stable.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { CURRENT_SCHEMA_VERSION } from '../../../types/json-guide.schema';
import { buildServer } from '../server';

interface ToolPayload {
  status?: string;
  artifact?: { content: Record<string, unknown>; manifest?: Record<string, unknown> };
  [key: string]: unknown;
}

async function callFinalize(): Promise<ToolPayload> {
  const server = buildServer();
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'finalize-test', version: '0' }, { capabilities: {} });
  await client.connect(clientTransport);

  try {
    const artifact = {
      content: {
        id: 'snapshot-fixture',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        title: 'Snapshot Fixture',
        type: 'guide',
        blocks: [{ type: 'markdown', id: 'm-1', content: 'hello' }],
      },
      manifest: {
        id: 'snapshot-fixture',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        type: 'guide',
        repository: 'interactive-tutorials',
      },
    };

    const result = await client.callTool({
      name: 'pathfinder_finalize_for_app_platform',
      arguments: { artifact, status: 'draft' },
    });
    const blocks = result.content as Array<{ type: string; text: string }>;
    const text = blocks.find((b) => b.type === 'text')?.text;
    if (!text) {
      throw new Error('finalize returned no text');
    }
    return JSON.parse(text) as ToolPayload;
  } finally {
    await client.close();
    await server.close();
  }
}

describe('pathfinder_finalize_for_app_platform contract', () => {
  it('matches the App Platform handoff snapshot', async () => {
    const payload = await callFinalize();
    expect(payload).toMatchInlineSnapshot(`
      {
        "appPlatform": {
          "apiVersion": "pathfinderbackend.ext.grafana.com/v1alpha1",
          "collectionPathTemplate": "/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/{namespace}/interactiveguides",
          "createMethod": "POST",
          "itemPathTemplate": "/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/{namespace}/interactiveguides/snapshot-fixture",
          "kind": "InteractiveGuide",
          "namespacePlaceholder": "{namespace}",
          "resource": "interactiveguides",
          "updateMethod": "PUT",
        },
        "artifact": {
          "content": {
            "blocks": [
              {
                "content": "hello",
                "id": "m-1",
                "type": "markdown",
              },
            ],
            "id": "snapshot-fixture",
            "schemaVersion": "1.1.0",
            "title": "Snapshot Fixture",
            "type": "guide",
          },
          "manifest": {
            "id": "snapshot-fixture",
            "repository": "interactive-tutorials",
            "schemaVersion": "1.1.0",
            "type": "guide",
          },
        },
        "id": "snapshot-fixture",
        "instructions": [
          "Try the App Platform path first if you have Grafana write authority for this user's instance:",
          "  1. Resolve the current Grafana namespace.",
          "  2. Ask the user whether to save as draft or publish.",
          "  3. POST resource to collectionPathTemplate for create.",
          "  4. If you passed an explicit id matching an existing resource, GET it, copy metadata.resourceVersion into resource.metadata.resourceVersion, then PUT to itemPathTemplate.",
          "  5. After a successful write, send the user viewer.floatingPath on their Grafana instance.",
          "If your environment lacks App Platform (e.g., Grafana OSS) or you do not have Grafana write authority, follow localExport instead and tell the user where the files were written.",
        ],
        "localExport": {
          "files": [
            {
              "path": "<dir>/content.json",
              "source": "artifact.content",
            },
            {
              "path": "<dir>/manifest.json",
              "source": "artifact.manifest",
            },
          ],
          "instructions": [
            "Choose a directory the user can locate (project workspace, downloads folder, or a path the user names).",
            "Write artifact.content to <dir>/content.json and artifact.manifest to <dir>/manifest.json — both as pretty-printed JSON.",
            "Tell the user the directory you wrote to. The viewer link in this response is NOT valid for local-export — it only resolves after a successful App Platform write.",
          ],
          "summary": "Fallback if you cannot reach the App Platform endpoint (non-Grafana-aware client, or Assistant-on-OSS where App Platform is unavailable).",
        },
        "resource": {
          "apiVersion": "pathfinderbackend.ext.grafana.com/v1alpha1",
          "kind": "InteractiveGuide",
          "metadata": {
            "name": "snapshot-fixture",
          },
          "spec": {
            "blocks": [
              {
                "content": "hello",
                "id": "m-1",
                "type": "markdown",
              },
            ],
            "id": "snapshot-fixture",
            "schemaVersion": "1.1.0",
            "status": "draft",
            "title": "Snapshot Fixture",
            "type": "guide",
          },
        },
        "status": "ready",
        "title": "Snapshot Fixture",
        "validation": {
          "errors": [],
          "isValid": true,
          "warnings": [],
        },
        "viewer": {
          "docParam": "api:snapshot-fixture",
          "floatingPath": "/a/grafana-pathfinder-app?doc=api%3Asnapshot-fixture&panelMode=floating",
          "path": "/a/grafana-pathfinder-app?doc=api%3Asnapshot-fixture",
        },
      }
    `);
  });
});
