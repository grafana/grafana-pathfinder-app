import { Command, Option } from 'commander';
import { z } from 'zod';

import { CLI_VIEW, defineCommand, readOutputOptions, renderInterface } from '../contracts';
import { issueToOutcome, printOutcome, renderMachineJson, type CommandOutcome, type HelpJson } from '../utils/output';

// `printOutcome` writes to process stdout/stderr; we capture both so the
// tests can assert on the rendered bytes for each output mode without
// shelling out.
function captureOutput<T>(fn: () => T): { stdout: string; stderr: string; result: T } {
  const out: string[] = [];
  const err: string[] = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    out.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array): boolean => {
    err.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stderr.write;
  try {
    const result = fn();
    return { stdout: out.join(''), stderr: err.join(''), result };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

describe('renderMachineJson', () => {
  it('emits compact JSON with no pretty-print whitespace', () => {
    const payload = { status: 'ok', data: { id: 'markdown-1', tags: ['a', 'b'] } };
    const rendered = renderMachineJson(payload);
    // Guards the machine-facing contract: a future switch back to
    // JSON.stringify(x, null, 2) would reintroduce indentation and regress
    // token cost. Assert on the exact compact form, not just round-tripping.
    expect(rendered).toBe('{"status":"ok","data":{"id":"markdown-1","tags":["a","b"]}}');
    expect(rendered).not.toContain('\n');
    expect(JSON.parse(rendered)).toEqual(payload);
  });
});

describe('readOutputOptions', () => {
  it('defaults to text format and not quiet when no flags are set', () => {
    const cmd = new Command('test');
    expect(readOutputOptions(cmd)).toEqual({ format: 'text', quiet: false });
  });

  it('reads --format and --quiet from the parent program', () => {
    const program = new Command('root')
      .addOption(new Option('--format <format>').choices(['text', 'json']).default('text'))
      .addOption(new Option('--quiet').default(false));
    const sub = new Command('child');
    program.addCommand(sub);
    program.parse(['--quiet', '--format', 'json', 'child'], { from: 'user' });
    expect(readOutputOptions(sub)).toEqual({ format: 'json', quiet: true });
  });
});

describe('printOutcome', () => {
  const success: CommandOutcome = {
    status: 'ok',
    summary: 'did the thing',
    details: { type: 'markdown', position: 'blocks[0]' },
    hints: ['Add another block with: pathfinder-cli add-block <type> <dir>'],
    data: { id: 'markdown-1' },
  };

  it('prints summary + details + hints in default text mode', () => {
    const { stdout, stderr, result } = captureOutput(() => printOutcome(success, { format: 'text', quiet: false }));
    expect(result).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('did the thing');
    expect(stdout).toContain('  type: markdown');
    expect(stdout).toContain('Add another block with:');
  });

  it('prints a single ok line in --quiet mode without hints', () => {
    const { stdout, result } = captureOutput(() => printOutcome(success, { format: 'text', quiet: true }));
    expect(result).toBe(0);
    expect(stdout.trim()).toBe('ok did the thing');
    expect(stdout).not.toContain('Add another block');
  });

  it('emits the full outcome as JSON in --format json', () => {
    const { stdout, result } = captureOutput(() => printOutcome(success, { format: 'json', quiet: false }));
    expect(result).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.status).toBe('ok');
    expect(parsed.summary).toBe('did the thing');
    expect(parsed.data.id).toBe('markdown-1');
  });

  it('returns exit 1 and writes to stderr on error', () => {
    const error: CommandOutcome = {
      status: 'error',
      code: 'BLOCK_NOT_FOUND',
      message: 'Block "intro" not found',
    };
    const { stdout, stderr, result } = captureOutput(() => printOutcome(error, { format: 'text', quiet: false }));
    expect(result).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('Error: Block "intro" not found');
  });

  it('emits structured error in --format json on stderr', () => {
    const error: CommandOutcome = {
      status: 'error',
      code: 'BLOCK_NOT_FOUND',
      message: 'Block "intro" not found',
    };
    const { stderr, result } = captureOutput(() => printOutcome(error, { format: 'json', quiet: false }));
    expect(result).toBe(1);
    const parsed = JSON.parse(stderr);
    expect(parsed.status).toBe('error');
    expect(parsed.code).toBe('BLOCK_NOT_FOUND');
  });

  describe('warnings (M2 plumbing)', () => {
    const withWarnings: CommandOutcome = {
      status: 'ok',
      summary: 'did the thing',
      warnings: [
        {
          code: 'UNVERIFIED_SELECTOR',
          message: 'reftarget set without verification. Confirm against the live Grafana DOM before publishing.',
          path: 'blocks[0]/reftarget',
        },
        {
          code: 'MULTISTEP_COMPOSITION_HINT',
          message:
            'multistep is for tightly-coupled ordered steps. Prefer separate sibling blocks for loose sequences.',
        },
      ],
      hints: ['Validate with: pathfinder-cli validate <dir>'],
    };

    it('renders a Warnings block in text mode with one bullet per entry', () => {
      const { stdout, result } = captureOutput(() => printOutcome(withWarnings, { format: 'text', quiet: false }));
      expect(result).toBe(0);
      expect(stdout).toContain('Warnings:');
      expect(stdout).toContain('- UNVERIFIED_SELECTOR (blocks[0]/reftarget): reftarget set without verification.');
      expect(stdout).toContain('- MULTISTEP_COMPOSITION_HINT: multistep is for tightly-coupled');
    });

    it('renders warnings before hints in text mode', () => {
      const { stdout } = captureOutput(() => printOutcome(withWarnings, { format: 'text', quiet: false }));
      const warningsIdx = stdout.indexOf('Warnings:');
      const hintsIdx = stdout.indexOf('Validate with:');
      expect(warningsIdx).toBeGreaterThan(-1);
      expect(hintsIdx).toBeGreaterThan(warningsIdx);
    });

    it('suppresses the Warnings block in --quiet mode to preserve the one-line invariant', () => {
      const { stdout, result } = captureOutput(() => printOutcome(withWarnings, { format: 'text', quiet: true }));
      expect(result).toBe(0);
      expect(stdout.trim()).toBe('ok did the thing');
      expect(stdout).not.toContain('Warnings:');
      expect(stdout).not.toContain('UNVERIFIED_SELECTOR');
    });

    it('serializes warnings verbatim in --format json so MCP callers see the structured payload', () => {
      const { stdout, result } = captureOutput(() => printOutcome(withWarnings, { format: 'json', quiet: false }));
      expect(result).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.warnings).toHaveLength(2);
      expect(parsed.warnings[0]).toEqual({
        code: 'UNVERIFIED_SELECTOR',
        message: 'reftarget set without verification. Confirm against the live Grafana DOM before publishing.',
        path: 'blocks[0]/reftarget',
      });
      expect(parsed.warnings[1].code).toBe('MULTISTEP_COMPOSITION_HINT');
      expect(parsed.warnings[1].path).toBeUndefined();
    });

    it('omits the Warnings block when warnings array is empty', () => {
      const noWarnings: CommandOutcome = { status: 'ok', summary: 'did the thing', warnings: [] };
      const { stdout } = captureOutput(() => printOutcome(noWarnings, { format: 'text', quiet: false }));
      expect(stdout).not.toContain('Warnings:');
    });
  });
});

describe('issueToOutcome', () => {
  it('forwards the issue path into data when no override is provided', () => {
    const outcome = issueToOutcome({
      code: 'CONTAINER_NOT_FOUND',
      message: 'Parent "intro" not found',
      path: ['blocks', '0'],
    });
    expect(outcome).toEqual({
      status: 'error',
      code: 'CONTAINER_NOT_FOUND',
      message: 'Parent "intro" not found',
      data: { path: ['blocks', '0'] },
    });
  });

  it('preserves a caller-supplied data override', () => {
    const outcome = issueToOutcome({ code: 'IF_ABSENT_CONFLICT', message: 'mismatch' }, { conflictField: 'title' });
    expect(outcome.data).toEqual({ conflictField: 'title' });
  });
});

describe('--help --format json — stability contract', () => {
  // The published shape is now rendered from a schema. These pin the claims
  // `docs/design/AGENT-AUTHORING.md` makes about it, at the level where value types are
  // now decided; the per-command surfaces are snapshotted in surface-parity.
  const spec = defineCommand({
    name: 'interactive',
    summary: 'Append an interactive block',
    schema: z.object({
      dir: z.string().describe('package directory').meta({ role: 'io' }),
      action: z.enum(['highlight', 'navigate']).describe('Action').meta({ role: 'content' }),
      tooltip: z.string().optional().describe('Tooltip').meta({ role: 'content' }),
      start: z.number().optional().describe('Start time in seconds').meta({ role: 'content' }),
      showMe: z.boolean().default(false).describe('Show me').meta({ role: 'control' }),
      targetPlatform: z
        .array(z.enum(['oss', 'cloud', 'enterprise']))
        .default([])
        .describe('Platforms')
        .meta({ role: 'content' }),
    }),
    run: async () => ({ status: 'ok', summary: 'ok' }),
  });
  const help = renderInterface(spec, CLI_VIEW);
  const all = [...help.required, ...help.optional, ...(help.addressing ?? [])];
  const flag = (name: string) => all.find((entry) => entry.name === name);

  it('emits the documented top-level keys', () => {
    expect(Object.keys(help).sort()).toEqual(['command', 'optional', 'required', 'summary']);
    expect(help.command).toBe('interactive');
    expect(help.summary).toBe('Append an interactive block');
  });

  it('splits required from optional on schema optionality', () => {
    expect(help.required.map((entry) => entry.name)).toEqual(['dir', 'action']);
    expect(help.optional.map((entry) => entry.name)).toContain('tooltip');
  });

  it('declares per-flag valueType, enum, and repeatable', () => {
    expect(flag('action')).toMatchObject({ valueType: 'enum', enum: ['highlight', 'navigate'] });
    expect(flag('start')?.valueType).toBe('number');
    expect(flag('show-me')?.valueType).toBe('boolean');
  });

  // A repeatable enum publishes as an enum-constrained array. Pinned since 1.1.0, when
  // reporting `--target-platform` as a plain enum made consumers reject list values.
  it('publishes repeatable enums as enum-constrained arrays', () => {
    expect(flag('target-platform')).toMatchObject({
      valueType: 'array',
      enum: ['oss', 'cloud', 'enterprise'],
      repeatable: true,
    });
  });

  it('produces a JSON-serializable shape', () => {
    const round = JSON.parse(JSON.stringify(help)) as HelpJson;
    expect(round.command).toBe('interactive');
  });
});
