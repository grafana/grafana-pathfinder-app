/**
 * Contracts layer, exercised against fixtures only (§8.4 Stage 1) — the adapter's
 * behaviour pinned independently of any real command's schema.
 */

import { z } from 'zod';

import { defineCommand, specFields } from '../spec';
import { readParamPolicy, resolveParamPolicy } from '../policy';
import {
  CLI_VIEW,
  collectCommanderInput,
  mountCommander,
  parseCommandInput,
  type CommanderPresentation,
} from '../render-commander';
import { describeFor, publishedNames } from '../render-interface';
import { outcomeFromZodError } from '../outcome';

const io = { role: 'io' } as const;
const content = { role: 'content' } as const;
const addressing = { role: 'addressing' } as const;

function fixture() {
  return defineCommand({
    name: 'fixture',
    summary: 'A fixture command',
    schema: z.object({
      dir: z.string().describe('package directory').meta(io),
      id: z.string().describe('target id').meta(addressing),
      title: z.string().optional().describe('a title').meta(content),
      count: z.number().optional().describe('how many').meta(content),
      cascade: z.boolean().default(false).describe('cascade the thing').meta(content),
      mode: z.enum(['fast', 'slow']).optional().describe('which mode').meta(content),
      tags: z.array(z.string()).optional().describe('repeatable tags').meta(content),
    }),
    run: (input) => ({ status: 'ok', summary: `ran with ${input.id}` }),
  });
}

/** How the fixture reads as a command line. Declared by the adapter, not the spec. */
const AS_COMMAND_LINE: CommanderPresentation = { positionals: ['dir', 'id'] };

describe('policy metadata', () => {
  it('reads policy declared outside the optional wrapper', () => {
    expect(readParamPolicy(z.string().optional().meta({ role: 'io' }))).toEqual({ role: 'io' });
  });

  // The registry is keyed by instance, so `.meta().optional()` leaves the
  // metadata on the inner type. Both spellings must behave identically.
  it('reads policy declared inside the optional wrapper', () => {
    expect(readParamPolicy(z.string().meta({ role: 'io' }).optional())).toEqual({ role: 'io' });
  });

  it('survives .partial(), which rewraps every field', () => {
    const object = z.object({ x: z.string().meta({ role: 'content', missingCode: 'NEEDS_X' }) });
    const field = object.partial().shape.x;
    expect(readParamPolicy(field)).toEqual({ role: 'content', missingCode: 'NEEDS_X' });
  });

  it('survives .extend() and .omit()', () => {
    const base = z.object({ x: z.string().meta({ role: 'addressing' }), y: z.string().meta({ role: 'content' }) });
    expect(readParamPolicy(base.extend({ z: z.string() }).shape.x)).toEqual({ role: 'addressing' });
    expect(readParamPolicy(base.omit({ y: true }).shape.x)).toEqual({ role: 'addressing' });
  });

  it('lets an outer declaration override an inner one', () => {
    const field = z.string().meta({ role: 'content' }).optional().meta({ role: 'placement' });
    expect(readParamPolicy(field).role).toBe('placement');
  });

  // Core resolves what a parameter *is*. Who may set it, what it is spelled as,
  // and whether it appears in help are all statements about a reader, so there is
  // nothing of the kind here to default.
  it('resolves the role and nothing about any reader', () => {
    expect(resolveParamPolicy(z.string().meta({ role: 'content' }))).toEqual({ role: 'content' });
    expect(resolveParamPolicy(z.string().meta({ role: 'io' }))).toEqual({ role: 'io' });
  });
});

describe('defineCommand validation', () => {
  it('accepts a fully-annotated spec', () => {
    expect(() => fixture()).not.toThrow();
  });

  it('rejects a field with no declared role', () => {
    expect(() =>
      defineCommand({
        name: 'broken',
        summary: 's',
        schema: z.object({ ok: z.string().meta(content), oops: z.string(), alsoOops: z.number() }),
        run: () => ({ status: 'ok', summary: '' }),
      })
    ).toThrow(/declare no role: oops, alsoOops/);
  });
});

describe('field ordering', () => {
  it('lists fields in declaration order, for every reader', () => {
    expect(specFields(fixture()).map((entry) => entry.name)).toEqual([
      'dir',
      'id',
      'title',
      'count',
      'cascade',
      'mode',
      'tags',
    ]);
  });
});

describe('Commander presentation', () => {
  // The facts moved off the fields, so they can now be stale in a way they could
  // not before. Mounting happens at module load, so this fails at import time.
  it('rejects a presentation naming no field', () => {
    const spec = defineCommand({
      name: 'broken',
      summary: 's',
      schema: z.object({ dir: z.string().meta(io) }),
      run: () => ({ status: 'ok', summary: '' }),
    });
    expect(() => mountCommander(spec, { positionals: ['dir', 'nope'] })).toThrow(/names no such field\(s\): nope/);
    expect(() => mountCommander(spec, { placeholders: { gone: 'x' } })).toThrow(/names no such field\(s\): gone/);
    expect(() => mountCommander(spec, { hidden: ['vanished'] })).toThrow(/names no such field\(s\): vanished/);
  });

  it('rejects duplicate positionals', () => {
    const spec = defineCommand({
      name: 'broken',
      summary: 's',
      schema: z.object({ dir: z.string().meta(io) }),
      run: () => ({ status: 'ok', summary: '' }),
    });
    expect(() => mountCommander(spec, { positionals: ['dir', 'dir'] })).toThrow(/duplicate positional\(s\): dir/);
  });

  it('names a value as the presentation asks, not as the type implies', () => {
    const spec = defineCommand({
      name: 'placeheld',
      summary: 's',
      schema: z.object({ at: z.string().optional().meta(addressing) }),
      run: () => ({ status: 'ok', summary: '' }),
    });
    expect(mountCommander(spec, { placeholders: { at: 'jsonpath' } }).options[0]!.flags).toContain('<jsonpath>');
    expect(mountCommander(spec).options[0]!.flags).toContain('<string>');
  });
});

describe('mountCommander', () => {
  it('renders positionals as arguments and everything else as options', () => {
    const command = mountCommander(fixture(), AS_COMMAND_LINE);
    expect(command.name()).toBe('fixture');
    expect(command.registeredArguments.map((argument) => argument.name())).toEqual(['dir', 'id']);
    expect(command.options.map((option) => option.attributeName())).toEqual([
      'title',
      'count',
      'cascade',
      'mode',
      'tags',
    ]);
  });

  it('maps Zod types onto the same flag shapes the bridge produces', () => {
    const byName = new Map(mountCommander(fixture()).options.map((option) => [option.attributeName(), option]));
    expect(byName.get('cascade')!.isBoolean()).toBe(true);
    expect(byName.get('count')!.flags).toContain('<number>');
    expect(byName.get('mode')!.flags).toContain('<fast|slow>');
    expect((byName.get('mode') as unknown as { argChoices?: string[] }).argChoices).toEqual(['fast', 'slow']);
    // A repeatable flag carries no Commander default: an empty list is what the schema
    // applies on absence, and printing `(default: [])` reads as though `[]` were a
    // value a caller could type.
    expect(byName.get('tags')!.defaultValue).toBeUndefined();
    expect(byName.get('tags')!.parseArg!('a', undefined as unknown as string[])).toEqual(['a']);
  });

  it('renders a required positional as <name> and an optional one as [name]', () => {
    const spec = defineCommand({
      name: 'opt-pos',
      summary: 's',
      schema: z.object({ dir: z.string().meta(io), maybe: z.string().optional().meta(addressing) }),
      run: () => ({ status: 'ok', summary: '' }),
    });
    const args = mountCommander(spec, { positionals: ['dir', 'maybe'] }).registeredArguments;
    expect(args[0]!.required).toBe(true);
    expect(args[1]!.required).toBe(false);
  });

  // `schema guide > guide-schema.json` and `npm run schema:export` redirect
  // stdout to a file, so an exporting command must write the document and
  // nothing around it — no summary line, in either output format.
  it('writes only the artifact for a command that emits one', async () => {
    const spec = defineCommand({
      name: 'export-thing',
      summary: 's',
      schema: z.object({ which: z.string().optional().meta(addressing) }),
      emits: 'artifact',
      run: () => ({ status: 'ok', summary: 'exported', artifact: [{ a: 1 }], data: { envelope: true } }),
    });

    const written: string[] = [];
    const write = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    const exit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });

    try {
      await expect(
        mountCommander(spec, { positionals: ['which'] }).parseAsync(['thing'], { from: 'user' })
      ).rejects.toThrow('exit 0');
      expect(written.join('')).toBe(JSON.stringify([{ a: 1 }], null, 2) + '\n');
    } finally {
      write.mockRestore();
      exit.mockRestore();
    }
  });

  // Hiding is Commander's own presentation choice and reaches no further: the
  // field is still an ordinary published parameter as far as any other reader is
  // concerned (§3.7).
  it('hides a field without changing what it publishes', () => {
    const spec = defineCommand({
      name: 'hidden-demo',
      summary: 's',
      schema: z.object({ shy: z.string().optional().meta({ role: 'content' }) }),
      run: () => ({ status: 'ok', summary: '' }),
    });
    expect(mountCommander(spec, { hidden: ['shy'] }).options[0]!.hidden).toBe(true);
    expect(publishedNames(spec, CLI_VIEW)).toEqual(['shy']);
  });

  // Guidance only one reader can act on is the view's, not the schema's: an operator
  // can run `requirements list`, and the same field reaches an agent with no such tool
  // (see `agentView` in mcp/lib/command-interface.ts for the other rendering).
  it('adds the command line its own pointer at the requirement vocabulary', () => {
    const spec = defineCommand({
      name: 'reqs-demo',
      summary: 's',
      schema: z.object({
        requirements: z.array(z.string()).optional().describe('Prerequisite conditions').meta({ role: 'content' }),
        title: z.string().optional().describe('Title').meta({ role: 'content' }),
      }),
      run: () => ({ status: 'ok', summary: '' }),
    });
    const byName = new Map(mountCommander(spec).options.map((option) => [option.attributeName(), option]));
    expect(byName.get('requirements')!.description).toBe(
      'Prerequisite conditions | run "pathfinder-cli requirements list" for valid tokens (e.g., is-admin, on-page:/dashboards)'
    );
    // Every other field reads exactly as the schema states it.
    expect(byName.get('title')!.description).toBe('Title');
    expect(describeFor(specFields(spec)[0]!, { name: (f) => f.name, publishes: () => true })).toBe(
      'Prerequisite conditions'
    );
  });
});

describe('input collection and parsing', () => {
  it('keys positionals back onto their field names', () => {
    expect(collectCommanderInput(['dir', 'id'], ['/tmp/pkg', 'block-1'], { title: 'T' })).toEqual({
      dir: '/tmp/pkg',
      id: 'block-1',
      title: 'T',
    });
  });

  it('applies schema defaults so the runner sees a complete object', () => {
    const parsed = parseCommandInput(fixture(), { dir: '/tmp/pkg', id: 'b1' });
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value.cascade).toBe(false);
  });

  it('accepts the same object from either adapter', () => {
    const payload = { dir: '/tmp/pkg', id: 'b1', cascade: true, tags: ['x'] };
    expect(parseCommandInput(fixture(), payload)).toEqual(
      parseCommandInput(
        fixture(),
        collectCommanderInput(['dir', 'id'], ['/tmp/pkg', 'b1'], { cascade: true, tags: ['x'] })
      )
    );
  });

  it('reports every problem at once, keyed by parameter name', () => {
    const parsed = parseCommandInput(fixture(), { id: 42, count: 'lots' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error('expected failure');
    }
    expect(parsed.outcome.status).toBe('error');
    expect(parsed.outcome.code).toBe('SCHEMA_VALIDATION');
    // Parameter names, not `--flags` — this is the §8.1 vocabulary claim.
    expect(parsed.outcome.message).toContain('dir:');
    expect(parsed.outcome.message).toContain('id:');
    expect(parsed.outcome.message).toContain('count:');
    expect(parsed.outcome.message).not.toContain('--');
  });
});

describe('outcomeFromZodError', () => {
  it('renders a nested path as a dotted parameter reference', () => {
    const schema = z.object({ author: z.object({ name: z.string() }) });
    const result = schema.safeParse({ author: {} });
    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('expected failure');
    }
    const spec = defineCommand({
      name: 'set-manifest',
      summary: 'demo',
      schema: z.object({ author: z.object({ name: z.string() }).meta({ role: 'content' }) }),
      run: () => ({ status: 'ok', summary: 'ran' }),
    });
    const outcome = outcomeFromZodError(spec, result.error);
    expect(outcome.message).toContain('author.name:');
    expect(outcome.code).toBe('SCHEMA_VALIDATION');
  });

  it('reports a declared code for a missing parameter that names one', () => {
    const spec = defineCommand({
      name: 'add-block',
      summary: 'demo',
      schema: z.object({
        id: z.string().meta({ role: 'addressing', missingCode: 'CONTAINER_REQUIRES_ID' }),
        title: z.string().meta({ role: 'content' }),
      }),
      run: () => ({ status: 'ok', summary: 'ran' }),
    });
    const parsed = parseCommandInput(spec, {});
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error('expected failure');
    }
    // Both parameters are missing; the declared code still wins, and the
    // message still names them both.
    expect(parsed.outcome.code).toBe('CONTAINER_REQUIRES_ID');
    expect(parsed.outcome.message).toContain('title');
  });
});
