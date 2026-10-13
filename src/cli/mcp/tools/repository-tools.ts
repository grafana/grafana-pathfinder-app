/**
 * Contract: mcp-native
 *
 * Read-only tools against the public Pathfinder package CDN. No CLI twins;
 * explicit top-level Zod is authoritative.
 *
 * `pathfinder_read_repository` collapses the former list_packages / get_package / get_manifest tools
 * into one tool with an operation flag (`list-packages` | `get-package` | `get-manifest`).
 * `pathfinder_launch_package` stays separate — different output contract. Its links come from
 * `utils/launch-link.ts`, shared with the `find-guides` command.
 *
 * Stateless — no artifact in/out, no session token. The repository base
 * URL is read from `PATHFINDER_REPOSITORY_URL` (falls back to the public
 * CDN). See P6 in `docs/design/AI-AUTHORING-IMPLEMENTATION.md`.
 *
 * Session-scoped manifest reads live under `pathfinder_read_session`
 * (operation "get-manifest") — different data source.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  fetchPackageContent,
  fetchPackageManifest,
  fetchRepositoryIndex,
  findRepositoryEntry,
  type RepositoryClientError,
  type RepositoryPackage,
} from '../../utils/repository-client';
import { buildLaunchLink } from '../../utils/launch-link';
import { renderMachineJson } from '../../utils/output';
import { readOnly } from './annotations';
import { textResult } from './result';

const REPOSITORY_OPERATIONS = ['list-packages', 'get-package', 'get-manifest'] as const;

const RepositoryInputSchema = z
  .object({
    operation: z
      .enum(REPOSITORY_OPERATIONS)
      .describe(
        'Repository read: "list-packages" browses/filters the index, "get-package" fetches content.json + manifest.json by id, "get-manifest" fetches metadata only (cheaper when blocks are not needed).'
      ),
    type: z.enum(['guide', 'path', 'journey']).optional().describe('[list-packages] Filter by package type.'),
    category: z.string().optional().describe('[list-packages] Filter by category (exact match).'),
    q: z.string().optional().describe('[list-packages] Case-insensitive substring on title and description.'),
    id: z.string().min(1).optional().describe('[get-package|get-manifest] Required package id (kebab-case).'),
  })
  .superRefine((args, ctx) => {
    if (args.operation === 'get-package' || args.operation === 'get-manifest') {
      if (typeof args.id !== 'string' || args.id.trim() === '') {
        ctx.addIssue({
          code: 'custom',
          path: ['id'],
          message: `operation "${args.operation}" requires \`id\` (package id).`,
        });
      }
    }
  });

type RepositoryInput = z.infer<typeof RepositoryInputSchema>;

export function registerRepositoryTools(server: McpServer): void {
  registerRepository(server);
  registerLaunchPackage(server);
}

function registerRepository(server: McpServer): void {
  server.registerTool(
    'pathfinder_read_repository',
    {
      description:
        'Use this tool to discover or inspect published Pathfinder packages from the public Grafana package repository (or a custom one via PATHFINDER_REPOSITORY_URL). MCP-native contract: no CLI command or pathfinder_help step. Pass `operation: "list-packages" | "get-package" | "get-manifest"`; list filters (`type`, `category`, `q`) and package `id` are top-level parameters. For shareable deep links use pathfinder_launch_package. For session-stored authoring reads use pathfinder_read_session.',
      annotations: readOnly('Read Pathfinder repository', /* openWorld */ true),
      // Explicit MCP-native schema; conditional requireds stay at its boundary.
      inputSchema: RepositoryInputSchema,
    },
    async (args) => handleRepository(args)
  );
}

async function handleRepository(args: RepositoryInput): Promise<ReturnType<typeof textResult>> {
  switch (args.operation) {
    case 'list-packages': {
      const index = await fetchRepositoryIndex();
      if (!index.ok) {
        return repositoryErrorResult(index);
      }
      const needle = typeof args.q === 'string' ? args.q.trim().toLowerCase() : '';
      const packages = index.packages
        .filter((p) => (args.type ? p.type === args.type : true))
        .filter((p) => (args.category ? p.category === args.category : true))
        .filter((p) => (needle ? matchesQuery(p, needle) : true))
        .map(summarizeEntry);

      return jsonResult({
        baseUrl: index.baseUrl,
        packages,
        validation: index.validation,
      });
    }
    case 'get-package': {
      const id = args.id!;
      const [content, manifest] = await Promise.all([fetchPackageContent(id), fetchPackageManifest(id)]);
      if (!content.ok) {
        return repositoryErrorResult(content);
      }
      if (!manifest.ok) {
        return repositoryErrorResult(manifest);
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
    case 'get-manifest': {
      const id = args.id!;
      const manifest = await fetchPackageManifest(id);
      if (!manifest.ok) {
        return repositoryErrorResult(manifest);
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
  }
}

function registerLaunchPackage(server: McpServer): void {
  // URL construction has no CLI command interface.
  server.registerTool(
    'pathfinder_launch_package',
    {
      description:
        "Use this tool when the user wants a shareable deep-link URL to a published Pathfinder guide or learning path whose id you know. To find guides by topic or by the user's current page, use pathfinder_find_guides. Always returns a relative launchPath that the user appends to their own Grafana instance origin. If you already know the user's instance origin (e.g. you are an agent running inside Grafana), pass it as instanceUrl to also receive an absolute launchUrl. If you do not know the instance, omit instanceUrl — do not invent or guess a hostname.",
      annotations: readOnly('Launch Pathfinder package', /* openWorld */ true),
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
        return repositoryErrorResult(found);
      }
      const link = buildLaunchLink({
        baseUrl: found.baseUrl,
        entryPath: found.entry.path,
        type: found.entry.type,
        instanceUrl,
        panelMode,
      });
      if (!link) {
        return repositoryErrorResult({
          ok: false,
          code: 'PARSE_ERROR',
          message: `Cannot construct CDN content URL for "${id}" — baseUrl or entry.path is empty after trimming`,
        });
      }

      const payload: Record<string, unknown> = {
        id,
        title: found.entry.title,
        type: found.entry.type,
        cdnContentUrl: link.cdnContentUrl,
        launchPath: link.launchPath,
      };
      if (link.launchUrl) {
        payload.launchUrl = link.launchUrl;
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
  return textResult(renderMachineJson(payload));
}

export function repositoryErrorResult(err: RepositoryClientError): ReturnType<typeof textResult> {
  const payload: Record<string, unknown> = {
    status: 'error',
    code: err.code,
    message: err.message,
  };
  if (err.code === 'HTTP_ERROR') {
    payload.httpStatus = err.status;
  }
  return textResult(renderMachineJson(payload), true);
}
