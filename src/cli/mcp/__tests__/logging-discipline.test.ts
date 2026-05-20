/**
 * P7 task 17 — logging discipline.
 *
 * Session tokens are bearer credentials over the wire. Anything that
 * lands in logs lands in Cloud Logging, lands in support tickets, lands
 * in pasted error reports. A raw 22-char Crockford-base32 token in a
 * log line is a leaked credential — for the remainder of the 7-day
 * lifecycle, anyone with read access to that log can resume the
 * session.
 *
 * Rules enforced here (against the non-test surface under
 * `src/cli/mcp/`):
 *
 *   1. Every `console.*` / `process.stderr.write` / `process.stdout.write`
 *      call that references `sessionToken` or a token-shaped identifier
 *      MUST also reference `tokenLogPrefix(` or `tokenLogHash(` on the
 *      same logical statement.
 *   2. No log call may pass a raw `sessionToken`/`token` argument by
 *      itself (e.g. `console.log(sessionToken)`,
 *      `` console.log(`x ${sessionToken}`) `` without a prefix/hash
 *      wrapper).
 *   3. The two existing call sites we know about are allowlisted by
 *      construction — they use `tokenLogPrefix`.
 *
 * If you add a new logger or a new emission path, you have two
 * choices: route the token through `tokenLogPrefix` /
 * `tokenLogHash`, or do not log it at all. There is no third
 * option — extending the allowlist is a code smell.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const MCP_ROOT = path.resolve(__dirname, '..');

function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip test directories; they are allowed to inspect raw tokens.
      if (entry.name === '__tests__') {
        continue;
      }
      listSourceFiles(full, acc);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

interface LogFinding {
  file: string;
  line: number;
  text: string;
}

/**
 * Find every line containing a log-emission call. Returns the file, the
 * 1-based line number, and the trimmed text of the line so a failing
 * assertion can render exactly what's wrong.
 */
function findLogLines(files: string[]): LogFinding[] {
  const out: LogFinding[] = [];
  const logPattern = /\b(?:console\.(?:log|info|warn|error|debug)|process\.(?:stderr|stdout)\.write)\b/;
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, idx) => {
      if (logPattern.test(text)) {
        out.push({ file, line: idx + 1, text: text.trim() });
      }
    });
  }
  return out;
}

/**
 * Return the multi-line text of the log statement starting at this line,
 * by walking forward until the open `(` is balanced. Lets us cover
 * `console.warn(...)` calls that span multiple physical lines.
 */
function readLogStatement(file: string, startLine: number): string {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let depth = 0;
  let started = false;
  const collected: string[] = [];
  for (let i = startLine - 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    collected.push(line);
    for (const ch of line) {
      if (ch === '(') {
        depth += 1;
        started = true;
      } else if (ch === ')') {
        depth -= 1;
      }
    }
    if (started && depth === 0) {
      return collected.join('\n');
    }
  }
  return collected.join('\n');
}

describe('P7 task 17 — logging discipline in src/cli/mcp/', () => {
  const sourceFiles = listSourceFiles(MCP_ROOT);
  const logLines = findLogLines(sourceFiles);

  it('finds the expected log emission surface (sanity check)', () => {
    // If this drops to zero it does not mean we are safe — it means the
    // scanner regex is broken. Fail loud.
    expect(logLines.length).toBeGreaterThan(0);
  });

  it('every log call that references a session token wraps it in tokenLogPrefix or tokenLogHash', () => {
    const offenders: LogFinding[] = [];
    for (const finding of logLines) {
      const statement = readLogStatement(finding.file, finding.line);
      // Token-shaped identifiers: sessionToken (canonical), or .pin
      // (the bound MCP transport id — also bearer-shaped). The token
      // variable `token` is the same value as `sessionToken` post-
      // normalize; flag it too.
      const referencesToken = /\b(?:sessionToken|\.pin|\btoken\b)\b/.test(statement);
      if (!referencesToken) {
        continue;
      }
      const usesPrefixOrHash = /\btokenLog(?:Prefix|Hash)\s*\(/.test(statement);
      if (!usesPrefixOrHash) {
        offenders.push(finding);
      }
    }
    if (offenders.length > 0) {
      const rendered = offenders.map((o) => `  ${path.relative(MCP_ROOT, o.file)}:${o.line} — ${o.text}`).join('\n');
      throw new Error(
        `Found ${offenders.length} log emission(s) that reference a session token without ` +
          `tokenLogPrefix() or tokenLogHash() wrapping:\n${rendered}\n\n` +
          'Wrap the token in lib/session-token.ts#tokenLogPrefix (12 chars, human-readable) ' +
          'or tokenLogHash (telemetry-friendly), or omit it from the log entirely.'
      );
    }
  });

  it('no log call passes a bare sessionToken / token as a top-level argument', () => {
    // Catches `console.log(sessionToken)`, `console.warn("x", sessionToken)`,
    // and `console.log(`${sessionToken}`)` patterns that the previous test
    // would also catch — this is the cheaper / more direct guard.
    const badArgPattern =
      /(?:console\.(?:log|info|warn|error|debug)|process\.(?:stderr|stdout)\.write)\s*\([^)]*\$\{(?:sessionToken|token)\}/;
    const bareArgPattern =
      /(?:console\.(?:log|info|warn|error|debug)|process\.(?:stderr|stdout)\.write)\s*\(\s*(?:sessionToken|token)\s*[,)]/;
    const offenders: LogFinding[] = [];
    for (const finding of logLines) {
      const statement = readLogStatement(finding.file, finding.line);
      if (badArgPattern.test(statement) || bareArgPattern.test(statement)) {
        offenders.push(finding);
      }
    }
    expect(offenders).toEqual([]);
  });
});
