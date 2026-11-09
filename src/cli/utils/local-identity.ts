/**
 * The local author identity for surfaces that run on the author's own machine
 * (the CLI and the stdio MCP). Git's `user.name` only; the OS username is not a
 * fallback because in Docker or CI it reads `root` or `runner`.
 */

import { execFileSync } from 'node:child_process';

export function readGitUserName(): string | undefined {
  try {
    const name = execFileSync('git', ['config', 'user.name'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
    return name === '' ? undefined : name;
  } catch {
    return undefined;
  }
}
