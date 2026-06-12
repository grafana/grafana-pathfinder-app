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
import { InMemorySessionStore, SESSION_GENERATION_ABSENT } from '../lib/session-store';
import { generateSessionToken } from '../lib/session-token';
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

const fixtureContent = {
  id: 'session-fixture',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  title: 'Session Fixture',
  type: 'guide' as const,
  blocks: [{ type: 'markdown' as const, id: 'm-1', content: 'hello' }],
};
const fixtureManifest = {
  id: 'session-fixture',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  type: 'guide' as const,
  repository: 'interactive-tutorials',
};

async function callFinalizeWithStore(store: InMemorySessionStore, args: Record<string, unknown>): Promise<ToolPayload> {
  const server = buildServer({ sessionStore: store });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'finalize-session-test', version: '0' }, { capabilities: {} });
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({
      name: 'pathfinder_finalize_for_app_platform',
      arguments: args,
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
            "appliesWhen": "You are a Grafana-aware client (e.g., Grafana Assistant) running inside a Grafana instance that has the Pathfinder backend aggregator enabled (featureToggles["aggregation.pathfinderbackend-ext-grafana-com.enabled"] === true). If you are unsure, try this branch first; on a 404 from the collection POST or from pathfinder_manage_guide_drafts, switch to grafanaOss.",
            "confirmationPrompt": "Publish guide "Snapshot Fixture" to <namespace> as <status>?",
            "errorHandling": [
              "pathfinder_manage_guide_drafts conflict response (concurrent edit): the tool returns the current server-side resourceVersion in its conflict artifact. Re-read it, ask the user to confirm overwrite, then call op=apply again. A second conflict means concurrent edits are racing — tell the user and offer localExport.",
              "pathfinder_publish_guide 404 (named draft does not exist): save the guide first with pathfinder_manage_guide_drafts op=apply, then re-attempt publish.",
              "Either preferred tool returning 403 or a "requires Editor or Admin role" error: the user lacks the role on this Grafana instance. Tell the user, then offer localExport. Do not retry.",
              "Preferred-path refusal to mutate a currently-published guide: call pathfinder_publish_guide op=unpublish first (with user confirmation), then retry pathfinder_manage_guide_drafts op=apply.",
              "Generic-write 404 on collection POST: the InteractiveGuide CRD or the aggregator is not installed in this instance. Switch to the grafanaOss branch (localExport). Do not retry.",
              "Generic-write 403: the user lacks interactiveguides.create permission. Tell the user, then offer localExport. Do not retry.",
              "Generic-write 409 on PUT: stale resourceVersion. Re-GET the resource, copy the new metadata.resourceVersion, ask the user to confirm overwrite, retry once. A second 409 means concurrent edits — tell the user and offer localExport.",
              "5xx, network error, or timeout (any path): retry once with short backoff. If it still fails, surface the error and offer localExport.",
              "Any other 4xx (any path): surface the error verbatim to the user and offer localExport. Do not retry.",
            ],
            "preferredTools": {
              "availability": "These are Grafana Assistant frontend tools (web sidebar / Workspace surfaces). Registered only when the Pathfinder backend aggregator feature toggle is on AND the user holds Editor or Admin role. If absent from your environment, fall through to the "generic-write fallback" step below.",
              "drafts": {
                "name": "pathfinder_manage_guide_drafts",
                "note": "op=apply forces spec.status === "draft" server-side regardless of what you send, strips metadata.resourceVersion on create, and refuses to mutate currently-published guides (use pathfinder_publish_guide op=unpublish first if you need to edit a published guide). Confirmation is prompted on apply/delete; list/get execute without prompting.",
                "operations": [
                  "list",
                  "get",
                  "apply",
                  "delete",
                ],
              },
              "publish": {
                "name": "pathfinder_publish_guide",
                "note": "Always requires explicit user confirmation; this is enforced by the harness and cannot be bypassed by skill-level allowedTools. Operates on an existing saved draft — call pathfinder_manage_guide_drafts op=apply first to create or update the draft.",
                "operations": [
                  "publish",
                  "unpublish",
                ],
              },
            },
            "steps": [
              "Resolve the current Grafana namespace from your runtime config.",
              "Ask the user whether to save the guide as a draft only, or save and then publish (default draft). A draft is private authoring state; a published guide is visible to every user on this Grafana instance.",
              "Preferred path — save the draft. If pathfinder_manage_guide_drafts is available, call it with op=apply, namespace=<resolved namespace>, guide=<resource object from this response>. The harness will prompt the user to confirm before the write executes. On success you have a saved draft regardless of what status field you sent.",
              "Preferred path — publish if requested. If the user chose to publish AND pathfinder_publish_guide is available, call it with op=publish, namespace=<resolved namespace>, name=<resource.metadata.name> after the draft save succeeds. The harness always prompts for explicit user confirmation on this call — do not try to bypass it.",
              "Generic-write fallback — only if the preferred tools above are not registered in your environment. POST resource to appPlatform.collectionPathTemplate (substitute {namespace}) using appPlatform.createMethod (POST). To overwrite an existing resource, GET appPlatform.itemPathTemplate first, copy metadata.resourceVersion into resource.metadata.resourceVersion, then PUT to appPlatform.itemPathTemplate using appPlatform.updateMethod (PUT). Set resource.spec.status to "draft" or "published" as the user chose. Show the user the confirmationPrompt copy before writing and proceed only on explicit yes.",
              "On success (either path), resolve viewer.floatingPath against the user's Grafana instance origin to produce an absolute URL (e.g., https://example.grafana.net + /a/grafana-pathfinder-app?...) and surface that URL to the user. Do NOT surface a relative path.",
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
          "  - clientGuidance.grafanaAppPlatform: you are running inside Grafana with App Platform available. Prefer the named tools in clientGuidance.grafanaAppPlatform.preferredTools (pathfinder_manage_guide_drafts, pathfinder_publish_guide) when they are registered; otherwise follow the generic-write fallback step.",
          "  - clientGuidance.grafanaOss: you are running inside Grafana without App Platform (OSS, or aggregator off).",
          "  - clientGuidance.nonGrafanaClient: you have no Grafana session (Cursor, Claude Desktop, CI).",
          "If unsure, try grafanaAppPlatform first; on a 404 from either the preferred tools or the collection POST, fall through to grafanaOss. The localExport block at the end of this response is the fallback used by both grafanaOss and nonGrafanaClient.",
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

describe('pathfinder_finalize_for_app_platform — session mode', () => {
  it('loads the artifact from the session store and returns the same shape as stateless mode', async () => {
    const store = new InMemorySessionStore();
    const token = generateSessionToken();
    await store.save(token, { content: fixtureContent, manifest: fixtureManifest }, SESSION_GENERATION_ABSENT);

    const payload = await callFinalizeWithStore(store, { sessionToken: token, status: 'draft' });

    expect(payload.status).toBe('ready');
    expect(payload.id).toBe('session-fixture');
    expect(payload.artifact?.content.id).toBe('session-fixture');
  });

  it('deletes the session on a successful finalize so the token becomes unusable', async () => {
    const store = new InMemorySessionStore();
    const token = generateSessionToken();
    await store.save(token, { content: fixtureContent, manifest: fixtureManifest }, SESSION_GENERATION_ABSENT);
    expect(await store.load(token)).not.toBeNull();

    const payload = await callFinalizeWithStore(store, { sessionToken: token, status: 'draft' });
    expect(payload.status).toBe('ready');

    // Load-bearing invariant: the session is gone after a successful
    // finalize. Subsequent calls with the same token will surface
    // SESSION_NOT_FOUND, which is the agent's signal to start over.
    expect(await store.load(token)).toBeNull();
  });

  it('does NOT delete the session when validation fails (token stays usable for retry)', async () => {
    const store = new InMemorySessionStore();
    const token = generateSessionToken();
    // Invalid: a markdown block without `content` fails schema validation.
    await store.save(
      token,
      {
        content: {
          ...fixtureContent,
          blocks: [{ type: 'markdown', id: 'm-bad' } as unknown as (typeof fixtureContent.blocks)[number]],
        },
        manifest: fixtureManifest,
      },
      SESSION_GENERATION_ABSENT
    );

    const payload = await callFinalizeWithStore(store, { sessionToken: token, status: 'draft' });
    expect(payload.status).toBe('invalid');

    // Caller still has a usable session to fix and re-finalize.
    expect(await store.load(token)).not.toBeNull();
  });

  it('rejects ambiguous input (both artifact and sessionToken)', async () => {
    const store = new InMemorySessionStore();
    const token = generateSessionToken();
    await store.save(token, { content: fixtureContent, manifest: fixtureManifest }, SESSION_GENERATION_ABSENT);

    const payload = await callFinalizeWithStore(store, {
      sessionToken: token,
      artifact: { content: fixtureContent, manifest: fixtureManifest },
      status: 'draft',
    });
    expect(payload.code).toBe('INPUT_MODE_AMBIGUOUS');
  });

  it('rejects missing input (neither artifact nor sessionToken)', async () => {
    const store = new InMemorySessionStore();
    const payload = await callFinalizeWithStore(store, { status: 'draft' });
    expect(payload.code).toBe('INPUT_MODE_MISSING');
  });

  it('returns SESSION_NOT_FOUND for an unknown token', async () => {
    const store = new InMemorySessionStore();
    const token = generateSessionToken();
    const payload = await callFinalizeWithStore(store, { sessionToken: token, status: 'draft' });
    expect(payload.code).toBe('SESSION_NOT_FOUND');
  });
});
