/**
 * @jest-environment node
 *
 * Unit tests for the command → JSON-body adapter. Binds the same sample
 * CLI commands the MCP tools already register (create, add-block, inspect,
 * schema) and exercises format/validate against those Commander instances
 * without booting an MCP server.
 */

import { addBlockGroup } from '../../commands/add-block';
import { describeFor, publishedNames, specFields } from '../../contracts';
import type { HelpJson } from '../../utils/output';
import { COMMAND_GROUPS, COMMAND_SPECS, commandNames } from '../../commands/manifest';
import {
  agentView,
  bindCommandInterface,
  formatCommandInterface,
  isCommandInterfaceError,
  registeredCommandInterfaceNames,
  validateCommandArgs,
} from '../lib/command-interface';
import type { ToolResult } from '../tools/result';

beforeAll(() => {
  for (const command of ['create', 'inspect', 'schema']) {
    bindCommandInterface(command);
  }
  // Bound the way `pathfinder_manage_block` binds it. The placement parameters
  // belong to the command; withholding them is a decision of the surface that
  // offers it, so a test about withholding has to make that decision too.
  bindCommandInterface('add-block', { withhold: ['before', 'after', 'position'] });
});

function flagNames(help: HelpJson): string[] {
  return [...help.required, ...help.optional, ...(help.addressing ?? [])].map((flag) => flag.name);
}

function rejection(result: ToolResult | undefined): Record<string, unknown> {
  if (!result) {
    throw new Error('expected a command-interface rejection');
  }
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe('registeredCommandInterfaceNames', () => {
  it('reports the commands this suite bound', () => {
    expect([...registeredCommandInterfaceNames()]).toEqual(
      expect.arrayContaining(['create', 'add-block', 'inspect', 'schema'])
    );
  });
});

describe('bindCommandInterface', () => {
  it('throws on a name the CLI does not ship', () => {
    // Fails at tool-registration time rather than leaving the tool reachable
    // but unhelpable, which the agent would see as UNKNOWN_COMMAND from the
    // command its own tool description told it to ask about.
    expect(() => bindCommandInterface('add-blcok')).toThrow(/no such command/);
    expect(registeredCommandInterfaceNames().has('add-blcok')).toBe(false);
  });

  // Binding reads the manifest, so every entry it can name is a spec or a group by
  // construction. Asserted anyway: this is the property that lets `agentView` and
  // `resolveCommandInterface` treat a manifest hit as a declared shape.
  it('sees a declared shape behind every command it can bind', () => {
    const shapeless = commandNames().filter((name) => !COMMAND_SPECS.has(name) && !COMMAND_GROUPS.has(name));
    expect(shapeless).toEqual([]);
  });

  // Withholding is stated in field names, so it can be checked against the schema —
  // the whole difference between this and the `optBlacklist` it replaces.
  it('throws when the withhold list names a parameter the command does not declare', () => {
    expect(() => bindCommandInterface('inspect', { withhold: ['notAParameter'] })).toThrow(
      /withholds parameter\(s\) it does not declare: notAParameter/
    );
  });

  // A group's parameters live on its variants, so the check has to look there.
  // Rebound with the same list `beforeAll` used, to leave the registry as found.
  it('accepts withhold names declared by a group variant', () => {
    expect(() => bindCommandInterface('add-block', { withhold: ['before', 'after', 'position'] })).not.toThrow();
  });
});

describe('agentView', () => {
  // Defaulting to an empty withhold list would publish everything but `io` for a
  // command that should not be described at all. The public entrypoints report
  // UNKNOWN_COMMAND before reaching here, as the suites below cover.
  it('refuses a command with no binding', () => {
    expect(() => agentView('e2e')).toThrow(/No MCP binding for "e2e"/);
  });

  it('offers a bound command everything but its io plumbing and withheld names', () => {
    const view = agentView('add-block');
    const spec = addBlockGroup.variants.get('markdown')!;
    const published = publishedNames(spec, view);
    expect(published).toContain('parent');
    expect(published).not.toContain('dir');
    expect(published).not.toContain('before');
  });

  // An agent has no shell and no `requirements` tool, so it is shown the vocabulary
  // rather than told to print it. The command line gets its own pointer from
  // `CLI_VIEW`; the schema states neither.
  it('illustrates the requirement vocabulary instead of naming a command', () => {
    const spec = addBlockGroup.variants.get('interactive')!;
    const field = specFields(spec).find((entry) => entry.name === 'requirements')!;
    const described = describeFor(field, agentView('add-block'));
    expect(described).toContain('valid tokens include is-admin, on-page:/dashboards');
    expect(described).not.toContain('pathfinder-cli');
  });
});

describe('formatCommandInterface', () => {
  it('rejects a command that is not in the CLI registry', () => {
    const result = formatCommandInterface('not-a-command');
    expect(isCommandInterfaceError(result)).toBe(true);
    if (isCommandInterfaceError(result)) {
      expect(result.code).toBe('UNKNOWN_COMMAND');
    }
  });

  // `edit-block` is a real CLI command this suite deliberately leaves unbound.
  // Unbound is indistinguishable from nonexistent on purpose: there is no tool
  // to reach it either way, and naming it would advertise withheld capability.
  it('rejects a real CLI command that has no MCP binding', () => {
    const result = formatCommandInterface('edit-block');
    expect(isCommandInterfaceError(result)).toBe(true);
    if (isCommandInterfaceError(result)) {
      expect(result.code).toBe('UNKNOWN_COMMAND');
      expect(result.message).not.toMatch(/Available:.*\bedit-block\b/);
    }
  });

  it('lists only bound commands, in CLI-registry order, when rejecting', () => {
    const result = formatCommandInterface('e2e');
    expect(isCommandInterfaceError(result)).toBe(true);
    if (isCommandInterfaceError(result)) {
      expect(result.message).toContain('Available: create, add-block, inspect, schema');
    }
  });

  it('rejects an unknown add-block subcommand', () => {
    const result = formatCommandInterface('add-block', 'not-a-type');
    expect(isCommandInterfaceError(result)).toBe(true);
    if (isCommandInterfaceError(result)) {
      expect(result.code).toBe('UNKNOWN_SUBCOMMAND');
    }
  });

  it('republishes create --type and withholds dir', () => {
    const help = formatCommandInterface('create');
    expect(isCommandInterfaceError(help)).toBe(false);
    if (isCommandInterfaceError(help)) {
      return;
    }
    expect(flagNames(help)).toEqual(expect.arrayContaining(['title', 'id', 'type', 'description']));
    expect(flagNames(help)).not.toContain('dir');
    expect([...help.required, ...help.optional].find((flag) => flag.name === 'type')).toMatchObject({
      valueType: 'enum',
      enum: ['guide', 'path', 'journey'],
    });
  });

  it('rekeys add-block section flags to camelCase and withholds placement', () => {
    const help = formatCommandInterface('add-block', 'section');
    expect(isCommandInterfaceError(help)).toBe(false);
    if (isCommandInterfaceError(help)) {
      return;
    }
    const names = flagNames(help);
    expect(names).toEqual(expect.arrayContaining(['type', 'parent', 'autoCollapse', 'ifAbsent']));
    // Per-key: a negated `arrayContaining` passes when any single member is
    // absent, so it would not catch a placement flag leaking on its own.
    for (const withheld of ['dir', 'before', 'after', 'position', 'auto-collapse']) {
      expect(names).not.toContain(withheld);
    }
    expect(help.required.find((flag) => flag.name === 'type')?.description).toMatch(/subcommand/);
  });

  it('rekeys requiredByType on the add-block parent to camelCase', () => {
    const help = formatCommandInterface('add-block');
    expect(isCommandInterfaceError(help)).toBe(false);
    if (isCommandInterfaceError(help)) {
      return;
    }
    expect(help.requiredByType?.input).toEqual(expect.arrayContaining(['prompt', 'inputType', 'variableName']));
    expect(help.requiredByType?.input).not.toContain('input-type');
  });
});

describe('validateCommandArgs', () => {
  it('rejects an unbound CLI command rather than validating against it', () => {
    const result = rejection(validateCommandArgs('edit-block', { id: 'block-1', content: 'hi' }));
    expect(result).toMatchObject({ status: 'error', code: 'UNKNOWN_COMMAND' });
  });

  it('does not treat an empty string as missing — the schema decides, same as the CLI', () => {
    // `''` is a valid `z.string()`; a command that cares about blank content
    // rejects it downstream (e.g. `create`'s `INVALID_TITLE`), so preflight has
    // nothing to flag here.
    expect(validateCommandArgs('create', { title: '' })).toBeUndefined();
  });

  it('rejects a blacklisted key as UNSUPPORTED_PARAMETER', () => {
    const result = rejection(validateCommandArgs('create', { title: 'Guide', dir: '/tmp/pkg' }));
    expect(result).toMatchObject({ status: 'error', code: 'UNSUPPORTED_PARAMETER' });
    expect((result.data as { unsupported?: string[] }).unsupported).toEqual(['dir']);
  });

  it('rejects a withheld placement flag on add-block', () => {
    const result = rejection(
      validateCommandArgs('add-block', { type: 'section', id: 's1', title: 'S', before: 'other' })
    );
    expect(result).toMatchObject({ status: 'error', code: 'UNSUPPORTED_PARAMETER' });
    expect((result.data as { unsupported?: string[] }).unsupported).toEqual(['before']);
  });

  it('reports only the missing type selector when no type was given', () => {
    const result = rejection(validateCommandArgs('add-block', { content: 'hello' }));
    expect(result).toMatchObject({ status: 'error', code: 'SCHEMA_VALIDATION' });
    expect(String(result.message)).toMatch(/missing required parameter: type/);
    // `content` is not reported as unsupported: without a type there is no
    // interface to judge it against, and it is in fact valid for markdown.
    // Calling it unsupported sent the agent to fix the wrong parameter.
    expect((result.data as { unsupported?: string[] }).unsupported).toBeUndefined();
  });

  it('reports missing content requiredness for the selected block type', () => {
    const result = rejection(validateCommandArgs('add-block', { type: 'markdown' }));
    expect(result).toMatchObject({ status: 'error', code: 'SCHEMA_VALIDATION' });
    expect(String(result.message)).toMatch(/missing required parameter: content/);
  });

  it('reports every missing parameter at once rather than one per round-trip', () => {
    const result = rejection(validateCommandArgs('add-block', { type: 'input' }));
    const missing = (result.data as { missing?: string[] }).missing ?? [];
    expect(missing).toEqual(expect.arrayContaining(['prompt', 'inputType', 'variableName']));
  });

  it('reports the declared code when a container is added without an id', () => {
    const result = rejection(validateCommandArgs('add-block', { type: 'section', title: 'S' }));
    expect(result).toMatchObject({ status: 'error', code: 'CONTAINER_REQUIRES_ID' });
  });

  it('rejects a boolean where the CLI enum is the strings true|false', () => {
    const result = rejection(validateCommandArgs('add-block', { type: 'markdown', content: 'x', branch: true }));
    expect(result).toMatchObject({ status: 'error', code: 'SCHEMA_VALIDATION' });
    expect(String(result.message)).toMatch(/branch expected true\|false/);
  });
});
