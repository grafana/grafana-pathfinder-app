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
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { runValidate } from '../../commands/validate';
import type { ContentJson, ManifestJson } from '../../../types/package.types';
import { textResult } from './result';

const APP_PLATFORM_API_VERSION = 'pathfinderbackend.ext.grafana.com/v1alpha1';
const APP_PLATFORM_KIND = 'InteractiveGuide';
const APP_PLATFORM_RESOURCE = 'interactiveguides';
const NAMESPACE_PLACEHOLDER = '{namespace}';
const PLUGIN_VIEWER_BASE = '/a/grafana-pathfinder-app';

export function registerFinalizeTool(server: McpServer): void {
  server.registerTool(
    'pathfinder_finalize_for_app_platform',
    {
      description:
        'Use this tool when the user wants to publish a finished Pathfinder guide to Grafana. Validates the artifact, then returns the App Platform write payload (resource, path templates, viewer link) and a localExport fallback. The MCP does not perform the write — the controlling agent (e.g. Grafana Assistant) does.',
      inputSchema: {
        artifact: z.object({
          content: z.record(z.string(), z.unknown()),
          manifest: z.record(z.string(), z.unknown()).optional(),
        }),
        status: z
          .enum(['draft', 'published'])
          .default('draft')
          .describe(
            'Resource status. Defaults to draft; clients should only set published after explicit user confirmation.'
          ),
      },
    },
    async ({ artifact, status }) => {
      const content = artifact.content as unknown as ContentJson;
      const manifest = artifact.manifest as unknown as ManifestJson | undefined;

      const validation = runValidate({
        content,
        manifest,
        manifestSchemaVersionAuthored: manifest !== undefined,
      });

      if (validation.status !== 'ok') {
        return textResult(
          JSON.stringify(
            {
              status: 'invalid',
              validation: {
                isValid: false,
                code: validation.code,
                message: validation.message,
                issues: (validation.data?.issues as unknown) ?? [],
              },
            },
            null,
            2
          ),
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
              'You are a Grafana-aware client (e.g., Grafana Assistant) running inside a Grafana instance that has the Pathfinder backend aggregator enabled (featureToggles["aggregation.pathfinderbackend-ext-grafana-com.enabled"] === true). If you are unsure, try this branch first; on a 404 from the collection POST, switch to grafanaOss.',
            confirmationPrompt,
            steps: [
              'Resolve the current Grafana namespace from your runtime config.',
              'Ask the user whether to save as draft or publish (default draft). Set resource.spec.status to the chosen value before writing.',
              'Show the user the confirmationPrompt copy from this branch and only proceed on explicit yes.',
              'POST resource to appPlatform.collectionPathTemplate (substitute {namespace}). Use appPlatform.createMethod (POST).',
              'If you originally created this guide with an explicit --id and intend to overwrite an existing resource: GET appPlatform.itemPathTemplate first, copy metadata.resourceVersion into resource.metadata.resourceVersion, then PUT to appPlatform.itemPathTemplate using appPlatform.updateMethod (PUT).',
              "On 2xx success, resolve viewer.floatingPath against the user's Grafana instance origin to produce an absolute URL (e.g., https://example.grafana.net + /a/grafana-pathfinder-app?...) and surface that URL to the user. Do NOT surface a relative path.",
            ],
            errorHandling: [
              '404 on collection POST: the InteractiveGuide CRD or the aggregator is not installed in this instance. Switch to the grafanaOss branch (localExport). Do not retry.',
              '403: the user lacks interactiveguides.create permission. Tell the user, then offer localExport. Do not retry.',
              '409 on PUT: stale resourceVersion. Re-GET the resource, copy the new metadata.resourceVersion, ask the user to confirm overwrite, retry once. A second 409 means concurrent edits — tell the user and offer localExport.',
              '5xx, network error, or timeout: retry once with short backoff. If it still fails, surface the error and offer localExport.',
              'Any other 4xx: surface the error verbatim to the user and offer localExport. Do not retry.',
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
          '  - clientGuidance.grafanaAppPlatform: you are running inside Grafana with App Platform available.',
          '  - clientGuidance.grafanaOss: you are running inside Grafana without App Platform (OSS, or aggregator off).',
          '  - clientGuidance.nonGrafanaClient: you have no Grafana session (Cursor, Claude Desktop, CI).',
          'If unsure, try grafanaAppPlatform first; on a 404 from the collection POST, fall through to grafanaOss. The localExport block at the end of this response is the fallback used by both grafanaOss and nonGrafanaClient.',
        ],
        artifact: {
          content,
          manifest,
        },
      };

      return textResult(JSON.stringify(handoff, null, 2));
    }
  );
}
