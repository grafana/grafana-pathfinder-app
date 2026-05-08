/**
 * Read-only tools that read the public Pathfinder package CDN repository.
 *
 * Group registered alongside the authoring tool groups in `./index.ts`.
 * Stateless — no artifact in/out, no session token. The repository base
 * URL is read from `PATHFINDER_REPOSITORY_URL` (falls back to the public
 * CDN). See P6 in `docs/design/AI-AUTHORING-IMPLEMENTATION.md`.
 *
 * Naming note: the deferred P5 GCS-sessions design also proposes a
 * `pathfinder_get_manifest` tool, but against a session-scoped artifact.
 * P6 ships first and uses public-CDN semantics. If/when P5 lands it must
 * either rename the session-scoped tool or take an `id?` vs `sessionToken?`
 * discriminator — flagged here so the constraint is inherited.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  buildPackageFileUrl,
  fetchPackageContent,
  fetchPackageManifest,
  fetchRepositoryIndex,
  findRepositoryEntry,
  type RepositoryClientError,
  type RepositoryPackage,
} from '../lib/repository-client';
import { textResult } from './result';

const PLUGIN_VIEWER_BASE = '/a/grafana-pathfinder-app';

export function registerRepositoryTools(server: McpServer): void {
  registerListPackages(server);
  registerGetPackage(server);
  registerGetManifest(server);
  registerLaunchPackage(server);
}

function registerListPackages(server: McpServer): void {
  server.registerTool(
    'pathfinder_list_packages',
    {
      description:
        'List packages from the configured Pathfinder package repository (default: the public Grafana CDN). Optional filters by type, category, and a substring query against title and description.',
      inputSchema: {
        type: z.enum(['guide', 'path', 'journey']).optional().describe('Filter by package type.'),
        category: z.string().optional().describe('Filter by category (exact match).'),
        q: z.string().optional().describe('Case-insensitive substring on title and description.'),
      },
    },
    async ({ type, category, q }) => {
      const index = await fetchRepositoryIndex();
      if (!index.ok) {
        return errorResult(index);
      }
      const needle = typeof q === 'string' ? q.trim().toLowerCase() : '';
      const packages = index.packages
        .filter((p) => (type ? p.type === type : true))
        .filter((p) => (category ? p.category === category : true))
        .filter((p) => (needle ? matchesQuery(p, needle) : true))
        .map(summarizeEntry);

      return jsonResult({
        baseUrl: index.baseUrl,
        packages,
        validation: index.validation,
      });
    }
  );
}

function registerGetPackage(server: McpServer): void {
  server.registerTool(
    'pathfinder_get_package',
    {
      description:
        'Fetch the full content.json and manifest.json for a single package by id from the repository CDN. Schema drift surfaces in validation.* but does not hard-fail.',
      inputSchema: {
        id: z.string().min(1).describe('Package id (kebab-case).'),
      },
    },
    async ({ id }) => {
      const [content, manifest] = await Promise.all([fetchPackageContent(id), fetchPackageManifest(id)]);
      if (!content.ok) {
        return errorResult(content);
      }
      if (!manifest.ok) {
        return errorResult(manifest);
      }
      return jsonResult({
        id,
        content: {
          url: content.url,
          raw: content.raw,
          validation: content.validation,
        },
        manifest: {
          url: manifest.url,
          raw: manifest.raw,
          validation: manifest.validation,
        },
      });
    }
  );
}

function registerGetManifest(server: McpServer): void {
  server.registerTool(
    'pathfinder_get_manifest',
    {
      description:
        "Fetch only manifest.json for a package by id (cheaper than pathfinder_get_package when you don't need block content). Reads from the repository CDN.",
      inputSchema: {
        id: z.string().min(1).describe('Package id (kebab-case).'),
      },
    },
    async ({ id }) => {
      const manifest = await fetchPackageManifest(id);
      if (!manifest.ok) {
        return errorResult(manifest);
      }
      return jsonResult({
        id,
        manifest: {
          url: manifest.url,
          raw: manifest.raw,
          validation: manifest.validation,
        },
      });
    }
  );
}

// URL of the open issue tracking the partial-tool status. Surfaced to the
// agent on every launch response so the limitation cannot be missed.
const LAUNCH_PACKAGE_BUG_URL = 'https://github.com/grafana/grafana-pathfinder-app/issues/855';

function registerLaunchPackage(server: McpServer): void {
  server.registerTool(
    'pathfinder_launch_package',
    {
      description:
        'PARTIAL — see ' +
        LAUNCH_PACKAGE_BUG_URL +
        ". Constructs a Pathfinder deep-link URL for a CDN-hosted package. The URL shape is correct and resolves to the Pathfinder plugin, but the targeted CDN guide does NOT currently load as an interactive tutorial — it opens to a generic docs view. The bug is in the app-side auto-launch handler, not in this tool. Until that fix lands, prefer pathfinder_get_package or pathfinder_get_manifest for inspecting CDN content; only call this tool when you specifically need the URL shape (e.g., to share a link in a chat) and warn the user about the limitation. Always returns a relative launchPath that the user appends to their own Grafana instance origin. If you already know the user's instance origin (e.g. you are an agent running inside Grafana), pass it as instanceUrl to also receive an absolute launchUrl. If you do not know the instance, omit instanceUrl — do not invent or guess a hostname.",
      inputSchema: {
        id: z.string().min(1).describe('Package id (kebab-case).'),
        instanceUrl: z
          .string()
          .optional()
          .describe(
            "The user's Grafana instance origin (e.g. https://stack1.grafana.net). Only pass this if you actually know it — for example, you are Grafana Assistant running inside the instance, or the user told you. Do not fabricate or guess. If unknown, omit it; the response includes a usage hint explaining how to use the relative launchPath."
          ),
        panelMode: z
          .enum(['floating'])
          .optional()
          .describe('When set to "floating", append &panelMode=floating so the viewer opens in floating mode.'),
      },
    },
    async ({ id, instanceUrl, panelMode }) => {
      const found = await findRepositoryEntry(id);
      if (!found.ok) {
        return errorResult(found);
      }
      const cdnContentUrl = buildPackageFileUrl(found.baseUrl, found.entry.path, 'content.json');
      if (!cdnContentUrl) {
        return errorResult({
          ok: false,
          code: 'PARSE_ERROR',
          message: `Cannot construct CDN content URL for "${id}" — baseUrl or entry.path is empty after trimming`,
        });
      }
      const encodedDoc = encodeURIComponent(cdnContentUrl);
      let launchPath = `${PLUGIN_VIEWER_BASE}?doc=${encodedDoc}`;
      if (panelMode === 'floating') {
        launchPath += '&panelMode=floating';
      }

      const payload: Record<string, unknown> = {
        id,
        title: found.entry.title,
        type: found.entry.type,
        cdnContentUrl,
        launchPath,
        warning: {
          status: 'partial',
          message:
            'The launchPath/launchUrl resolves to the Pathfinder plugin but does NOT currently load the targeted CDN guide as an interactive tutorial — it opens to a generic docs view. This is an app-side bug being tracked separately. When surfacing this URL to a user, include a heads-up that the interactive launch is not yet wired up for CDN packages. For inspecting content, prefer pathfinder_get_package or pathfinder_get_manifest.',
          tracking: LAUNCH_PACKAGE_BUG_URL,
        },
      };
      if (typeof instanceUrl === 'string' && instanceUrl.trim() !== '') {
        const trimmed = instanceUrl.trim().replace(/\/+$/, '');
        payload.launchUrl = `${trimmed}${launchPath}`;
      } else {
        // No instance origin known. Tell the agent — explicitly — to surface
        // launchPath as a *relative* path the user appends to their own
        // instance, rather than fabricating a hostname.
        payload.usage = {
          launchPathIsRelative: true,
          message:
            'launchPath is relative to the user\'s Grafana instance origin. To open this guide, the user (or you, if you know their instance) must combine their Grafana origin with this launchPath, e.g. "<grafana-origin>" + launchPath. Do NOT fabricate a hostname — if you do not know the user\'s instance, present launchPath to the user and ask them to open it on their Grafana, or call this tool again with instanceUrl set.',
        };
      }
      return jsonResult(payload);
    }
  );
}

// ----------------- helpers -----------------

function matchesQuery(p: RepositoryPackage, needle: string): boolean {
  const title = (p.title ?? '').toLowerCase();
  const description = (p.description ?? '').toLowerCase();
  return title.includes(needle) || description.includes(needle);
}

function summarizeEntry(p: RepositoryPackage): Record<string, unknown> {
  return {
    id: p.id,
    type: p.type,
    title: p.title,
    description: p.description,
    category: p.category,
    path: p.path,
  };
}

function jsonResult(payload: unknown): ReturnType<typeof textResult> {
  return textResult(JSON.stringify(payload, null, 2));
}

function errorResult(err: RepositoryClientError): ReturnType<typeof textResult> {
  const payload: Record<string, unknown> = {
    status: 'error',
    code: err.code,
    message: err.message,
  };
  if (err.code === 'HTTP_ERROR') {
    payload.httpStatus = err.status;
  }
  return textResult(JSON.stringify(payload, null, 2), true);
}
