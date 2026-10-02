/**
 * Regex evaluation for catalog `urlRegex` targeting, bounded so a hostile
 * pattern cannot hang the MCP server.
 *
 * Patterns come from `repository.json`, which a deployment may point at any
 * host through `PATHFINDER_REPOSITORY_URL`, and run against a caller-supplied
 * page URL. JavaScript regexes backtrack, so a pattern such as `^(a+)+$` can
 * run for minutes on one short input. Each test therefore runs inside a `vm`
 * context with an execution timeout, which V8 enforces even mid-backtrack. A
 * pattern that times out repeatedly is disabled for the life of the compiled index;
 * one timeout alone may be a GC pause or a busy host rather than a hostile pattern.
 */

import vm from 'node:vm';

export const MAX_URL_REGEX_LENGTH = 200;
export const URL_REGEX_TIMEOUT_MS = 25;
export const MAX_REGEX_INPUT_LENGTH = 2048;
export const MAX_URL_REGEX_TIMEOUTS = 3;

export interface BoundedRegex {
  readonly source: string;
  disabled: boolean;
}

interface CompiledRegex extends BoundedRegex {
  readonly regex: RegExp;
  timeouts: number;
}

const sandbox = vm.createContext(Object.create(null));
const testScript = new vm.Script('pattern.test(input)');

/** Returns `null` for a pattern that is too long or fails to compile. */
export function compileBoundedRegex(source: unknown): BoundedRegex | null {
  if (typeof source !== 'string' || source.length === 0 || source.length > MAX_URL_REGEX_LENGTH) {
    return null;
  }
  try {
    const compiled: CompiledRegex = { source, regex: new RegExp(source), disabled: false, timeouts: 0 };
    return compiled;
  } catch {
    return null;
  }
}

/** `false` when the pattern is disabled, times out, or does not match. */
export function testBoundedRegex(pattern: BoundedRegex, input: string, timeoutMs = URL_REGEX_TIMEOUT_MS): boolean {
  if (pattern.disabled) {
    return false;
  }
  const compiled = pattern as CompiledRegex;
  const { regex } = compiled;
  regex.lastIndex = 0;
  sandbox.pattern = regex;
  sandbox.input = input.slice(0, MAX_REGEX_INPUT_LENGTH);
  try {
    return testScript.runInContext(sandbox, { timeout: timeoutMs }) === true;
  } catch {
    compiled.timeouts++;
    pattern.disabled = compiled.timeouts >= MAX_URL_REGEX_TIMEOUTS;
    return false;
  } finally {
    sandbox.pattern = undefined;
    sandbox.input = undefined;
  }
}
