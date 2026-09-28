/**
 * @jest-environment node
 *
 * Unit tests for the command → JSON-body adapter. Binds the same sample
 * CLI commands the MCP tools already register (create, add-block, inspect,
 * schema) and exercises format/validate against those Commander instances
 * without booting an MCP server.
 */

import { REQUIREMENT_DESCRIPTIONS, REQUIREMENT_TOKEN_CATALOGUE } from '../../../types/requirements.types';
import { addBlockGroup } from '../../commands/add-block';
import { describeFor, publishedNames, specFields, variantNames } from '../../contracts';
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
  it('points at the published vocabulary instead of naming a command', () => {
    const spec = addBlockGroup.variants.get('interactive')!;
    const field = specFields(spec).find((entry) => entry.name === 'requirements')!;
    const described = describeFor(field, agentView('add-block'));
    expect(described).toContain('requirementTokens');
    expect(described).not.toContain('pathfinder-cli');
  });

  // The examples used to be the only tokens an agent ever saw, so they read as the
  // enumeration. They may stay as examples; what must not come back is a
  // description that offers them *as* the list.
  it('does not present its examples as the whole vocabulary', () => {
    const spec = addBlockGroup.variants.get('interactive')!;
    const field = specFields(spec).find((entry) => entry.name === 'requirements')!;
    expect(describeFor(field, agentView('add-block'))).not.toMatch(/valid tokens (include|are)\b/);
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

/**
 * `requiredByType` on the group root and the per-type parameter lists are two
 * renderings of one schema, and an agent authors from whichever it reads. When they
 * appear to disagree the agent omits a field: `add-block --type section` requires
 * `id`, `requiredByType.section` says so, and `id` is published in the `addressing`
 * bucket — so a reader that takes `required` + `optional` for the whole interface
 * builds a section field list with no `id` in it, and every section it authors is
 * missing one. These pin the three ways that reading can go wrong.
 */
describe('the per-type interface and requiredByType', () => {
  const groupHelp = () => {
    const help = formatCommandInterface('add-block');
    if (isCommandInterfaceError(help)) {
      throw new Error(`expected add-block help, got ${help.code}`);
    }
    return help;
  };

  const variantHelp = (type: string) => {
    const help = formatCommandInterface('add-block', type);
    if (isCommandInterfaceError(help)) {
      throw new Error(`expected add-block ${type} help, got ${help.code}`);
    }
    return help;
  };

  it.each(variantNames(addBlockGroup))('names every requiredByType parameter in the %s interface', (type) => {
    const demanded = groupHelp().requiredByType?.[type] ?? [];
    expect(flagNames(variantHelp(type))).toEqual(expect.arrayContaining(demanded));
  });

  it.each(variantNames(addBlockGroup))('marks every requiredByType parameter required on %s', (type) => {
    const help = variantHelp(type);
    const flags = [...help.required, ...help.optional, ...(help.addressing ?? [])];
    for (const name of groupHelp().requiredByType?.[type] ?? []) {
      expect(flags.find((flag) => flag.name === name)).toMatchObject({ name, required: true });
    }
  });

  // The flat list is the one a reader can trust without knowing that `addressing`
  // overlaps both requiredness buckets. It has to agree with the root's table, or it
  // is a third thing to disagree with rather than the answer to the disagreement.
  it.each(variantNames(addBlockGroup))('publishes requiredParams for %s matching requiredByType', (type) => {
    const help = variantHelp(type);
    // The discriminator is the agent's obligation too — `type` selects the variant —
    // so it leads `requiredParams` and is absent from the per-type table.
    expect(help.requiredParams).toEqual(['type', ...(groupHelp().requiredByType?.[type] ?? [])]);
  });

  // The concrete case that produced this suite.
  it('publishes the container id as a required section parameter', () => {
    const help = variantHelp('section');
    expect(groupHelp().requiredByType?.section).toContain('id');
    expect(help.requiredParams).toContain('id');
    expect(flagNames(help)).toContain('id');
    expect([...help.required, ...help.optional, ...(help.addressing ?? [])]).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'id', required: true })])
    );
  });

  // Whatever `requiredParams` names, preflight must actually demand — otherwise the
  // published obligation and the enforced one are two lists again.
  it.each(variantNames(addBlockGroup))('rejects a %s call that omits its requiredParams', (type) => {
    const required = variantHelp(type).requiredParams ?? [];
    const optional = required.filter((name) => name !== 'type');
    if (optional.length === 0) {
      expect(validateCommandArgs('add-block', { type })).toBeUndefined();
      return;
    }
    const missing = (rejection(validateCommandArgs('add-block', { type })).data as { missing?: string[] }).missing;
    expect([...(missing ?? [])].sort()).toEqual([...optional].sort());
  });
});

/**
 * A step carrying a `reftarget` needs `exists-reftarget` in its `requirements`, and
 * `has-datasource:` / `min-version:` / `plugin-enabled:` are just as load-bearing —
 * yet the agent surface used to name two tokens and nothing else, with no tool to
 * print the rest. An agent cannot author a valid guide against a vocabulary it
 * cannot see, so the whole vocabulary has to reach it from the MCP.
 */
describe('the requirement vocabulary', () => {
  const requirementsHelp = () => {
    const help = formatCommandInterface('add-block', 'interactive');
    if (isCommandInterfaceError(help)) {
      throw new Error(`expected add-block interactive help, got ${help.code}`);
    }
    return help;
  };

  it('publishes every token the validator recognises', () => {
    const published = new Set((requirementsHelp().requirementTokens ?? []).map((entry) => entry.token));
    for (const token of Object.keys(REQUIREMENT_DESCRIPTIONS)) {
      expect([...published]).toContain(token);
    }
    expect(published.size).toBe(REQUIREMENT_TOKEN_CATALOGUE.length);
  });

  // The tokens the reporting case needed, named outright: a regression that drops
  // one of these is the defect coming back, not a count changing.
  it.each(['exists-reftarget', 'has-datasource:', 'min-version:', 'plugin-enabled:', 'section-completed:'])(
    'publishes %s',
    (token) => {
      expect((requirementsHelp().requirementTokens ?? []).map((entry) => entry.token)).toContain(token);
    }
  );

  it('describes and exemplifies every published token', () => {
    for (const entry of requirementsHelp().requirementTokens ?? []) {
      expect(entry.description).not.toBe('');
      expect(entry.example).not.toBe('');
      expect(entry.kind === 'fixed' ? entry.example : entry.example.startsWith(entry.token)).toBeTruthy();
    }
  });

  // Attached where it is actionable, not on every command: a `create` call has no
  // parameter that takes a token, and 24 entries of vocabulary on it is noise.
  it('omits the vocabulary from a command with no requirement parameter', () => {
    const help = formatCommandInterface('create');
    expect(isCommandInterfaceError(help)).toBe(false);
    if (isCommandInterfaceError(help)) {
      return;
    }
    expect(help.requirementTokens).toBeUndefined();
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
