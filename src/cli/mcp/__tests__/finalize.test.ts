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
        "clientGuidance": {
          "grafanaAppPlatform": {
            "appliesWhen": "You are a Grafana-aware client (e.g., Grafana Assistant) running inside a Grafana instance that has the Pathfinder backend aggregator enabled (featureToggles["aggregation.pathfinderbackend-ext-grafana-com.enabled"] === true). If you are unsure, try this branch first; on a 404 from the collection POST, switch to grafanaOss.",
            "confirmationPrompt": "Publish guide "Snapshot Fixture" to <namespace> as <status>?",
            "errorHandling": [
              "404 on collection POST: the InteractiveGuide CRD or the aggregator is not installed in this instance. Switch to the grafanaOss branch (localExport). Do not retry.",
              "403: the user lacks interactiveguides.create permission. Tell the user, then offer localExport. Do not retry.",
              "409 on PUT: stale resourceVersion. Re-GET the resource, copy the new metadata.resourceVersion, ask the user to confirm overwrite, retry once. A second 409 means concurrent edits — tell the user and offer localExport.",
              "5xx, network error, or timeout: retry once with short backoff. If it still fails, surface the error and offer localExport.",
              "Any other 4xx: surface the error verbatim to the user and offer localExport. Do not retry.",
            ],
            "steps": [
              "Resolve the current Grafana namespace from your runtime config.",
              "Ask the user whether to save as draft or publish (default draft). Set resource.spec.status to the chosen value before writing.",
              "Show the user the confirmationPrompt copy from this branch and only proceed on explicit yes.",
              "POST resource to appPlatform.collectionPathTemplate (substitute {namespace}). Use appPlatform.createMethod (POST).",
              "If you originally created this guide with an explicit --id and intend to overwrite an existing resource: GET appPlatform.itemPathTemplate first, copy metadata.resourceVersion into resource.metadata.resourceVersion, then PUT to appPlatform.itemPathTemplate using appPlatform.updateMethod (PUT).",
              "On 2xx success, resolve viewer.floatingPath against the user's Grafana instance origin to produce an absolute URL (e.g., https://example.grafana.net + /a/grafana-pathfinder-app?...) and surface that URL to the user. Do NOT surface a relative path.",
            ],
          },
          "grafanaOss": {
            "appliesWhen": "You are a Grafana-aware client running inside a Grafana instance without App Platform (Grafana OSS, or Cloud with the aggregator toggle off), or you previously attempted the grafanaAppPlatform branch and got a 404 on the collection path.",
            "steps": [
              "Follow the localExport instructions below to write content.json and manifest.json to a directory the user can locate.",
              "Tell the user where the files were written.",
              "Tell the user how to load these files into a Grafana instance later: open Pathfinder in any Grafana → open the block editor → click Import → paste the contents of content.json or upload the file. The block editor accepts both paste and file upload of the JSON guide format.",
              "Do NOT surface the viewer link from this response — it only resolves after a successful App Platform write, which did not happen on this branch.",
            ],
          },
          "nonGrafanaClient": {
            "appliesWhen": "You are an MCP client that has no Grafana session (e.g., Cursor, Claude Desktop, a CI runner). You cannot reach App Platform from here.",
            "steps": [
              "Do NOT attempt the App Platform write — you have no Grafana instance to write to.",
              "Follow the localExport instructions below to write content.json and manifest.json to the user's workspace.",
              "Tell the user where the files were written.",
              "Tell the user how to load these files into a Grafana instance later: open Pathfinder in any Grafana → open the block editor → click Import → paste the contents of content.json or upload the file.",
              "Do NOT surface the viewer link from this response — it only resolves after a successful App Platform write.",
            ],
          },
        },
        "id": "snapshot-fixture",
        "instructions": [
          "This response contains structured guidance under clientGuidance, keyed by client capability. Pick the branch whose appliesWhen matches your environment:",
          "  - clientGuidance.grafanaAppPlatform: you are running inside Grafana with App Platform available.",
          "  - clientGuidance.grafanaOss: you are running inside Grafana without App Platform (OSS, or aggregator off).",
          "  - clientGuidance.nonGrafanaClient: you have no Grafana session (Cursor, Claude Desktop, CI).",
          "If unsure, try grafanaAppPlatform first; on a 404 from the collection POST, fall through to grafanaOss. The localExport block at the end of this response is the fallback used by both grafanaOss and nonGrafanaClient.",
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
            "Tell the user the directory you wrote to.",
            "Tell the user how to load these files into a Grafana instance later: open Pathfinder in any Grafana → open the block editor → click Import → paste the contents of content.json or upload the file. The block editor accepts both paste and file upload of the JSON guide format.",
            "Do NOT surface the viewer link from this response — it only resolves after a successful App Platform write, not for local-export.",
          ],
          "summary": "Fallback used by the grafanaOss and nonGrafanaClient branches to preserve the authored guide as files on disk that the user can later import via the block editor.",
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
