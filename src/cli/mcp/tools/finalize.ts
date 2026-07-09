/**
 * `pathfinder_finalize_for_app_platform` — produces the publish handoff
 * payload defined in `docs/design/APP-PLATFORM-PUBLISH-HANDOFF.md`.
 *
 * The shape of this payload is the contract Assistant and other MCP
 * clients read verbatim. Snapshot test in __tests__/finalize.test.ts
 * asserts the shape so any drift is loud.
 *
 * The `clientGuidance` field carries three branches keyed by client
 * capability — `grafanaAppPlatform`, `grafanaOss`, `nonGrafanaClient` —
 * so the agent can route deterministically instead of self-classifying
 * from prose. The top-level `instructions` array is a routing preamble
 * pointing at those branches; it does not duplicate their content.
 *
 * Validation precedes shape construction. A failing validation returns
 * `status: "invalid"` with the structured CLI errors and **omits** the App
 * Platform write payload — clients must not be tempted to publish an
 * invalid artifact.
 *
 * P7 session-mode: accepts `{sessionToken}` in place of `{artifact}` using
 * the shared `resolveReadOnlyInput` helper. On a successful finalize the
 * server deletes the session — the token is single-use through here. A
 * failed delete logs but does not fail the response: the sliding session
 * TTL is the safety net so we cannot strand a session.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { runValidate } from '../../commands/validate';
import { renderMachineJson } from '../../utils/output';
import { PLUGIN_VIEWER_BASE } from '../lib/constants';
import { tokenLogPrefix } from '../lib/session-token';
import type { AuthoringSessionStore } from '../lib/session-store';
import { readOnly } from './annotations';
import { resolveReadOnlyInput } from './read-input';
import { textResult, withToolErrorEnvelope } from './result';
import { ArtifactInputBase, SessionTokenBase } from './two-mode-input';

const APP_PLATFORM_API_VERSION = 'pathfinderbackend.ext.grafana.com/v1alpha1';
const APP_PLATFORM_KIND = 'InteractiveGuide';
const APP_PLATFORM_RESOURCE = 'interactiveguides';
const NAMESPACE_PLACEHOLDER = '{namespace}';

const ArtifactSchema = ArtifactInputBase.describe(
  'STATELESS MODE. Pass an in-flight artifact directly. Pass EITHER `artifact` OR `sessionToken`, not both.'
);

const SessionTokenSchema = SessionTokenBase.describe(
  'SESSION MODE. Token returned by pathfinder_create_package or a previous mutation ack. On a successful finalize the session is deleted server-side and the token becomes unusable.'
);

export function registerFinalizeTool(
  server: McpServer,
  options: { sessionStore: AuthoringSessionStore; mcpSessionId?: string }
): void {
  const { sessionStore, mcpSessionId } = options;
  server.registerTool(
    'pathfinder_finalize_for_app_platform',
    {
      description:
        'Use this tool when the user wants to publish a finished Pathfinder guide to Grafana. Validates the artifact, then returns the App Platform write payload (resource, path templates, viewer link) and a localExport fallback. The MCP does not perform the write — the controlling agent (e.g. Grafana Assistant) does. Pass `artifact` for stateless mode or `sessionToken` for session mode; the session is deleted on a successful finalize.',
      annotations: readOnly('Finalize Pathfinder artifact'),
      inputSchema: {
        artifact: ArtifactSchema,
        sessionToken: SessionTokenSchema,
        status: z
          .enum(['draft', 'published'])
          .default('draft')
          .describe(
            'Resource status. Defaults to draft; clients should only set published after explicit user confirmation.'
          ),
      },
    },
    async ({ artifact, sessionToken, status }) =>
      withToolErrorEnvelope(typeof sessionToken === 'string' ? sessionToken : undefined, 'finalize', () =>
        finalizeImpl({ artifact, sessionToken, status, sessionStore, mcpSessionId })
      )
  );
}

async function finalizeImpl(args: {
  artifact?: { content: Record<string, unknown>; manifest?: Record<string, unknown> };
  sessionToken?: string;
  status: 'draft' | 'published';
  sessionStore: AuthoringSessionStore;
  mcpSessionId: string | undefined;
}): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const { artifact, sessionToken, status, sessionStore, mcpSessionId } = args;
  const resolved = await resolveReadOnlyInput(sessionStore, { artifact, sessionToken }, mcpSessionId);
  if (!resolved.ok) {
    return resolved.response;
  }
  const content = resolved.content;
  const manifest = resolved.manifest;

  const validation = runValidate({
    content,
    manifest,
    manifestSchemaVersionAuthored: resolved.manifestAuthored,
  });

  if (validation.status !== 'ok') {
    return textResult(
      renderMachineJson({
        status: 'invalid',
        validation: {
          isValid: false,
          code: validation.code,
          message: validation.message,
          issues: (validation.data?.issues as unknown) ?? [],
        },
      }),
      true
    );
  }

  const id = String(content.id);
  const title = String(content.title ?? '');
  const collectionPathTemplate = `/apis/${APP_PLATFORM_API_VERSION}/namespaces/${NAMESPACE_PLACEHOLDER}/${APP_PLATFORM_RESOURCE}`;
  const itemPathTemplate = `${collectionPathTemplate}/${id}`;
  const docParam = `api:${id}`;
  const encodedDoc = encodeURIComponent(docParam);
  const viewerPath = `${PLUGIN_VIEWER_BASE}?doc=${encodedDoc}`;
  const floatingPath = `${viewerPath}&panelMode=floating`;

  const confirmationPrompt = `Publish guide "${title}" to <namespace> as <status>?`;

  const handoff = {
    status: 'ready',
    id,
    title,
    validation: {
      isValid: true,
      errors: [],
      warnings: [],
    },
    appPlatform: {
      apiVersion: APP_PLATFORM_API_VERSION,
      kind: APP_PLATFORM_KIND,
      resource: APP_PLATFORM_RESOURCE,
      namespacePlaceholder: NAMESPACE_PLACEHOLDER,
      collectionPathTemplate,
      itemPathTemplate,
      createMethod: 'POST',
      updateMethod: 'PUT',
    },
    resource: {
      apiVersion: APP_PLATFORM_API_VERSION,
      kind: APP_PLATFORM_KIND,
      metadata: {
        name: id,
      },
      spec: {
        ...content,
        status,
      },
    },
    viewer: {
      docParam,
      path: viewerPath,
      floatingPath,
    },
    clientGuidance: {
      grafanaAppPlatform: {
        appliesWhen:
          'You are a Grafana-aware client (e.g., Grafana Assistant) running inside a Grafana instance that has the Pathfinder backend aggregator enabled (featureToggles["aggregation.pathfinderbackend-ext-grafana-com.enabled"] === true). If you are unsure, try this branch first; on a 404 from the collection POST or from pathfinder_manage_guide_drafts, switch to grafanaOss.',
        confirmationPrompt,
        preferredTools: {
          drafts: {
            name: 'pathfinder_manage_guide_drafts',
            operations: ['list', 'get', 'apply', 'delete'],
            note: 'op=apply forces spec.status === "draft" server-side regardless of what you send, strips metadata.resourceVersion on create, and refuses to mutate currently-published guides (use pathfinder_publish_guide op=unpublish first if you need to edit a published guide). Confirmation is prompted on apply/delete; list/get execute without prompting.',
          },
          publish: {
            name: 'pathfinder_publish_guide',
            operations: ['publish', 'unpublish'],
            note: 'Always requires explicit user confirmation; this is enforced by the harness and cannot be bypassed by skill-level allowedTools. Operates on an existing saved draft — call pathfinder_manage_guide_drafts op=apply first to create or update the draft.',
          },
          availability:
            'These are Grafana Assistant frontend tools (web sidebar / Workspace surfaces). Registered only when the Pathfinder backend aggregator feature toggle is on AND the user holds Editor or Admin role. If absent from your environment, fall through to the "generic-write fallback" step below.',
        },
        steps: [
          'Resolve the current Grafana namespace from your runtime config.',
          'Ask the user whether to save the guide as a draft only, or save and then publish (default draft). A draft is private authoring state; a published guide is visible to every user on this Grafana instance.',
          'Preferred path — save the draft. If pathfinder_manage_guide_drafts is available, call it with op=apply, namespace=<resolved namespace>, guide=<resource object from this response>. The harness will prompt the user to confirm before the write executes. On success you have a saved draft regardless of what status field you sent.',
          'Preferred path — publish if requested. If the user chose to publish AND pathfinder_publish_guide is available, call it with op=publish, namespace=<resolved namespace>, name=<resource.metadata.name> after the draft save succeeds. The harness always prompts for explicit user confirmation on this call — do not try to bypass it.',
          'Generic-write fallback — only if the preferred tools above are not registered in your environment. POST resource to appPlatform.collectionPathTemplate (substitute {namespace}) using appPlatform.createMethod (POST). To overwrite an existing resource, GET appPlatform.itemPathTemplate first, copy metadata.resourceVersion into resource.metadata.resourceVersion, then PUT to appPlatform.itemPathTemplate using appPlatform.updateMethod (PUT). Set resource.spec.status to "draft" or "published" as the user chose. Show the user the confirmationPrompt copy before writing and proceed only on explicit yes.',
          "On success (either path), resolve viewer.floatingPath against the user's Grafana instance origin to produce an absolute URL (e.g., https://example.grafana.net + /a/grafana-pathfinder-app?...) and surface that URL to the user. Do NOT surface a relative path.",
        ],
        errorHandling: [
          'pathfinder_manage_guide_drafts conflict response (concurrent edit): the tool returns the current server-side resourceVersion in its conflict artifact. Re-read it, ask the user to confirm overwrite, then call op=apply again. A second conflict means concurrent edits are racing — tell the user and offer localExport.',
          'pathfinder_publish_guide 404 (named draft does not exist): save the guide first with pathfinder_manage_guide_drafts op=apply, then re-attempt publish.',
          'Either preferred tool returning 403 or a "requires Editor or Admin role" error: the user lacks the role on this Grafana instance. Tell the user, then offer localExport. Do not retry.',
          'Preferred-path refusal to mutate a currently-published guide: call pathfinder_publish_guide op=unpublish first (with user confirmation), then retry pathfinder_manage_guide_drafts op=apply.',
          'Generic-write 404 on collection POST: the InteractiveGuide CRD or the aggregator is not installed in this instance. Switch to the grafanaOss branch (localExport). Do not retry.',
          'Generic-write 403: the user lacks interactiveguides.create permission. Tell the user, then offer localExport. Do not retry.',
          'Generic-write 409 on PUT: stale resourceVersion. Re-GET the resource, copy the new metadata.resourceVersion, ask the user to confirm overwrite, retry once. A second 409 means concurrent edits — tell the user and offer localExport.',
          '5xx, network error, or timeout (any path): retry once with short backoff. If it still fails, surface the error and offer localExport.',
          'Any other 4xx (any path): surface the error verbatim to the user and offer localExport. Do not retry.',
        ],
      },
      grafanaOss: {
        appliesWhen:
          'You are a Grafana-aware client running inside a Grafana instance without App Platform (Grafana OSS, or Cloud with the aggregator toggle off), or you previously attempted the grafanaAppPlatform branch and got a 404 on the collection path.',
        steps: [
          'Follow the localExport instructions below to write content.json and manifest.json to a directory the user can locate.',
          'Tell the user where the files were written.',
          'Tell the user how to load these files into a Grafana instance later: open Pathfinder in any Grafana → open the block editor → click Import → paste the contents of content.json or upload the file. The block editor accepts both paste and file upload of the JSON guide format.',
          'Do NOT surface the viewer link from this response — it only resolves after a successful App Platform write, which did not happen on this branch.',
        ],
      },
      nonGrafanaClient: {
        appliesWhen:
          'You are an MCP client that has no Grafana session (e.g., Cursor, Claude Desktop, a CI runner). You cannot reach App Platform from here.',
        steps: [
          'Do NOT attempt the App Platform write — you have no Grafana instance to write to.',
          "Follow the localExport instructions below to write content.json and manifest.json to the user's workspace.",
          'Tell the user where the files were written.',
          'Tell the user how to load these files into a Grafana instance later: open Pathfinder in any Grafana → open the block editor → click Import → paste the contents of content.json or upload the file.',
          'Do NOT surface the viewer link from this response — it only resolves after a successful App Platform write.',
        ],
      },
    },
    localExport: {
      summary:
        'Fallback used by the grafanaOss and nonGrafanaClient branches to preserve the authored guide as files on disk that the user can later import via the block editor.',
      files: [
        { path: '<dir>/content.json', source: 'artifact.content' },
        { path: '<dir>/manifest.json', source: 'artifact.manifest' },
      ],
      instructions: [
        'Choose a directory the user can locate (project workspace, downloads folder, or a path the user names).',
        'Write artifact.content to <dir>/content.json and artifact.manifest to <dir>/manifest.json — both as pretty-printed JSON.',
        'Tell the user the directory you wrote to.',
        'Tell the user how to load these files into a Grafana instance later: open Pathfinder in any Grafana → open the block editor → click Import → paste the contents of content.json or upload the file. The block editor accepts both paste and file upload of the JSON guide format.',
        'Do NOT surface the viewer link from this response — it only resolves after a successful App Platform write, not for local-export.',
      ],
    },
    instructions: [
      'This response contains structured guidance under clientGuidance, keyed by client capability. Pick the branch whose appliesWhen matches your environment:',
      '  - clientGuidance.grafanaAppPlatform: you are running inside Grafana with App Platform available. Prefer the named tools in clientGuidance.grafanaAppPlatform.preferredTools (pathfinder_manage_guide_drafts, pathfinder_publish_guide) when they are registered; otherwise follow the generic-write fallback step.',
      '  - clientGuidance.grafanaOss: you are running inside Grafana without App Platform (OSS, or aggregator off).',
      '  - clientGuidance.nonGrafanaClient: you have no Grafana session (Cursor, Claude Desktop, CI).',
      'If unsure, try grafanaAppPlatform first; on a 404 from either the preferred tools or the collection POST, fall through to grafanaOss. The localExport block at the end of this response is the fallback used by both grafanaOss and nonGrafanaClient.',
    ],
    artifact: {
      content,
      manifest,
    },
  };

  // Session-mode only: evict the session on success. The handoff
  // already shipped to the agent, so a delete failure is not a
  // user-visible failure — the sliding session TTL catches stranded
  // sessions. Log so it's diagnosable, then return.
  if (resolved.sessionToken !== undefined) {
    try {
      await sessionStore.delete(resolved.sessionToken);
    } catch (err) {
      console.warn(
        `pathfinder_finalize_for_app_platform: session delete failed for ${tokenLogPrefix(
          resolved.sessionToken
        )}; the idle session will be evicted by the sliding TTL`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  return textResult(renderMachineJson(handoff));
}
