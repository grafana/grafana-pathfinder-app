/**
 * `pathfinder_finalize_for_app_platform` — produces the publish handoff
 * payload defined in `docs/design/APP-PLATFORM-PUBLISH-HANDOFF.md`.
 *
 * The shape of this payload is the contract P4 (Assistant handoff) reads
 * verbatim. Snapshot test in __tests__/finalize.test.ts asserts the shape
 * so any drift is loud.
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
        'Finalize an artifact for publishing. Validates, then returns the App Platform write payload (resource, path templates, viewer link) and a localExport fallback. The MCP does not perform the write — the controlling agent (e.g. Grafana Assistant) does.',
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
        localExport: {
          summary:
            'Fallback if you cannot reach the App Platform endpoint (non-Grafana-aware client, or Assistant-on-OSS where App Platform is unavailable).',
          files: [
            { path: '<dir>/content.json', source: 'artifact.content' },
            { path: '<dir>/manifest.json', source: 'artifact.manifest' },
          ],
          instructions: [
            'Choose a directory the user can locate (project workspace, downloads folder, or a path the user names).',
            'Write artifact.content to <dir>/content.json and artifact.manifest to <dir>/manifest.json — both as pretty-printed JSON.',
            'Tell the user the directory you wrote to. The viewer link in this response is NOT valid for local-export — it only resolves after a successful App Platform write.',
          ],
        },
        instructions: [
          "Try the App Platform path first if you have Grafana write authority for this user's instance:",
          '  1. Resolve the current Grafana namespace.',
          '  2. Ask the user whether to save as draft or publish.',
          '  3. POST resource to collectionPathTemplate for create.',
          '  4. If you passed an explicit id matching an existing resource, GET it, copy metadata.resourceVersion into resource.metadata.resourceVersion, then PUT to itemPathTemplate.',
          '  5. After a successful write, send the user viewer.floatingPath on their Grafana instance.',
          'If your environment lacks App Platform (e.g., Grafana OSS) or you do not have Grafana write authority, follow localExport instead and tell the user where the files were written.',
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
