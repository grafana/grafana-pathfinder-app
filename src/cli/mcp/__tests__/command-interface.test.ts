/**
 * @jest-environment node
 *
 * Unit tests for the command → JSON-body adapter. Binds the same sample
 * CLI commands the MCP tools already register (create, add-block, inspect,
 * schema) and exercises format/validate against those Commander instances
 * without booting an MCP server.
 */

import type { HelpJson } from '../../utils/output';
import {
  formatCommandInterface,
  isCommandInterfaceError,
  registerCommandInterfaceConfig,
  registeredCommandInterfaceNames,
  validateCommandArgs,
} from '../lib/command-interface';
import type { ToolResult } from '../tools/result';

beforeAll(() => {
  registerCommandInterfaceConfig('create', { optBlacklist: ['dir'] });
  registerCommandInterfaceConfig('inspect', { optBlacklist: ['dir'] });
  registerCommandInterfaceConfig('schema', {});
  registerCommandInterfaceConfig('add-block', {
    optBlacklist: ['dir', 'before', 'after', 'position'],
    subcommandOpt: 'type',
    optContext: {
      type: 'Pass this same value as pathfinder_help `subcommand` to discover its block-specific options.',
    },
  });
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

describe('formatCommandInterface', () => {
  it('rejects a command that is not in the CLI registry', () => {
    const result = formatCommandInterface('not-a-command');
    expect(isCommandInterfaceError(result)).toBe(true);
    if (isCommandInterfaceError(result)) {
      expect(result.code).toBe('UNKNOWN_COMMAND');
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
    expect(names).not.toEqual(expect.arrayContaining(['dir', 'before', 'after', 'position', 'auto-collapse']));
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
  it('treats empty string as missing a Commander-mandatory option', () => {
    const result = rejection(validateCommandArgs('create', { title: '' }));
    expect(result).toMatchObject({ status: 'error', code: 'SCHEMA_VALIDATION' });
    expect(String(result.message)).toMatch(/missing required parameter: title/);
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

  it('reports a missing type selector against the root add-block command', () => {
    const result = rejection(validateCommandArgs('add-block', { content: 'hello' }));
    expect(result).toMatchObject({ status: 'error', code: 'SCHEMA_VALIDATION' });
    expect(String(result.message)).toMatch(/missing required parameter: type/);
    expect((result.data as { unsupported?: string[] }).unsupported).toEqual(['content']);
  });

  it('lets add-block content requiredness fall through to the runner (forceOptional)', () => {
    expect(validateCommandArgs('add-block', { type: 'markdown' })).toBeUndefined();
  });

  it('rejects a boolean where the CLI enum is the strings true|false', () => {
    const result = rejection(validateCommandArgs('add-block', { type: 'markdown', content: 'x', branch: true }));
    expect(result).toMatchObject({ status: 'error', code: 'SCHEMA_VALIDATION' });
    expect(String(result.message)).toMatch(/branch expected true\|false/);
  });
});
