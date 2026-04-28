import { Command, Option } from 'commander';

import { JsonInteractiveBlockSchema } from '../../types/json-guide.schema';
import {
  formatHelpAsJson,
  issueToOutcome,
  printOutcome,
  readOutputOptions,
  type CommandOutcome,
  type HelpJson,
} from '../utils/output';
import { registerSchemaOptions } from '../utils/schema-options';

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

describe('formatHelpAsJson — stability contract', () => {
  it('emits the documented top-level keys for an authoring command', () => {
    const cmd = new Command('interactive')
      .description('Append an interactive block')
      .argument('<dir>')
      .addOption(new Option('--parent <id>'))
      .addOption(new Option('--branch <branch>').choices(['true', 'false']))
      .addOption(new Option('--if-absent'));
    // The bridge contributes `--id` from the schema; addressing flags shared
    // with addressing-set members (parent/branch/if-absent) are already
    // pre-registered above. `skipExisting` keeps the bridge from colliding.
    registerSchemaOptions(cmd, JsonInteractiveBlockSchema, { skipExisting: true });

    const help = formatHelpAsJson(cmd);
    expect(Object.keys(help).sort()).toEqual(
      expect.arrayContaining(['command', 'summary', 'required', 'optional', 'addressing'])
    );
    expect(help.command).toBe('interactive');
    expect(help.summary).toBe('Append an interactive block');
  });

  it('separates required, optional, and addressing flags', () => {
    const cmd = new Command('interactive')
      .description('Append an interactive block')
      .addOption(new Option('--parent <id>'));
    registerSchemaOptions(cmd, JsonInteractiveBlockSchema);

    const help = formatHelpAsJson(cmd);

    // `parent` and `id` always live in addressing.
    const addressingNames = (help.addressing ?? []).map((f) => f.name);
    expect(addressingNames).toContain('parent');
    expect(addressingNames).toContain('id');

    // Interactive's required fields: action and content. Discriminator
    // (`type`) is filtered out.
    const requiredNames = help.required.map((f) => f.name).sort();
    expect(requiredNames).toEqual(['action', 'content']);
  });

  it('declares per-flag valueType, enum, and repeatable as part of the contract', () => {
    const cmd = new Command('interactive');
    registerSchemaOptions(cmd, JsonInteractiveBlockSchema);
    const help = formatHelpAsJson(cmd);
    const all = [...help.required, ...help.optional, ...(help.addressing ?? [])];

    const action = all.find((f) => f.name === 'action');
    expect(action?.valueType).toBe('enum');
    expect(action?.enum).toEqual(['highlight', 'button', 'formfill', 'navigate', 'hover', 'noop', 'popout']);

    const requirements = all.find((f) => f.name === 'requirements');
    expect(requirements?.valueType).toBe('array');
    expect(requirements?.repeatable).toBe(true);

    const showMe = all.find((f) => f.name === 'show-me');
    expect(showMe?.valueType).toBe('boolean');
  });

  it('lists subcommand names when the command has children', () => {
    const parent = new Command('add-block').description('Append a block');
    parent.addCommand(new Command('markdown'));
    parent.addCommand(new Command('interactive'));
    const help = formatHelpAsJson(parent);
    expect(help.subcommands).toEqual(['markdown', 'interactive']);
  });

  it('produces a JSON-serializable shape', () => {
    const cmd = new Command('test').description('demo');
    cmd.addOption(new Option('--name <string>'));
    const help: HelpJson = formatHelpAsJson(cmd);
    expect(() => JSON.stringify(help)).not.toThrow();
    const round = JSON.parse(JSON.stringify(help)) as HelpJson;
    expect(round.command).toBe('test');
  });
});
