/**
 * Bridge between the MCP's stateless artifact model and the CLI's
 * directory-oriented runners.
 *
 * Each MCP mutation tool receives `{content, manifest}` from the client
 * and must return the updated artifact. The existing CLI `runX` functions
 * read and write a directory on disk. Rather than fork an in-memory
 * pathway across all 8 runners (substantial refactor with drift risk
 * because the runners contain CLI-strict guards we want the MCP to
 * inherit verbatim), we marshal the artifact through an ephemeral
 * tmpdir per call.
 *
 * **This is a documented deviation from the design's "no temporary
 * directory" property** (see HOSTED-AUTHORING-MCP.md). The deviation is
 * acceptable because:
 *
 *   1. The tmpdir is per-call and torn down before the tool returns —
 *      no cross-call state, the stateless artifact model still holds.
 *   2. We keep "the CLI is the sole validator" exactly: the MCP calls
 *      the actual `runX` function, so any CLI-strict guard the runner
 *      adds is automatically picked up by the MCP without code changes.
 *   3. Per-call cost is bounded — two small JSON file writes and reads
 *      against a tmpfs/ramdisk-backed `os.tmpdir()` on Linux.
 *
 * Follow-up: refactor `mutateAndValidate` and each `runX` to accept an
 * in-memory state mode so this bridge can collapse to a function call.
 * Tracked in P3 deviations.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ContentJson, ManifestJson } from '../../../types/package.types';
import { readPackage, writePackage, type PackageState } from '../../utils/package-io';
import type { CommandOutcome } from '../../utils/output';

export interface ArtifactInput {
  content: ContentJson;
  manifest?: ManifestJson;
}

export interface ArtifactOutcome {
  outcome: CommandOutcome;
  /** The updated artifact, present whether the runner succeeded or not (the runner only writes on success, so this reflects post-success state or the unchanged input on failure). */
  artifact: ArtifactInput;
}

/**
 * Run a directory-based runner against an in-memory artifact. Writes the
 * artifact to a per-call tmpdir, invokes the runner, reads the updated
 * artifact back, and cleans up.
 */
export async function withArtifact(
  artifact: ArtifactInput,
  runner: (dir: string) => Promise<CommandOutcome> | CommandOutcome
): Promise<ArtifactOutcome> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-mcp-'));
  try {
    const state: PackageState = {
      content: artifact.content,
      manifest: artifact.manifest,
      manifestSchemaVersionAuthored: artifact.manifest !== undefined,
    };
    writePackage(dir, state);

    const outcome = await runner(dir);

    if (outcome.status !== 'ok') {
      return { outcome, artifact };
    }

    const updated = readPackage(dir);
    return {
      outcome,
      artifact: { content: updated.content, manifest: updated.manifest },
    };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Tmpdir cleanup is best-effort. The OS will reclaim it on reboot.
    }
  }
}
