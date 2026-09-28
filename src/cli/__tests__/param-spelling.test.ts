import { CLI_SPELLING, fieldNameToFlag, spellOutcome, spellParams } from '../utils/param-spelling';
import type { CommandOutcome } from '../utils/output';

describe('spellParams', () => {
  it('writes a reference the way the reader does', () => {
    const text = 'use at most one of {@before}/{@after}/{@position}';
    expect(spellParams(text, CLI_SPELLING)).toBe('use at most one of --before/--after/--position');
    expect(spellParams(text, (name) => name)).toBe('use at most one of before/after/position');
  });

  it('kebab-cases a camelCase name for the command line', () => {
    expect(spellParams('{@targetPlatform}', CLI_SPELLING)).toBe('--target-platform');
    expect(fieldNameToFlag('targetPlatform')).toBe('target-platform');
  });

  it('is idempotent, so a message may cross two boundaries', () => {
    const once = spellParams('{@id} is required', CLI_SPELLING);
    expect(spellParams(once, CLI_SPELLING)).toBe(once);
  });

  // The reason references carry a sigil: messages echo values a caller supplied, and
  // help text carries JSON fragments. Rewriting either would corrupt the message.
  it('leaves braces that are not references alone', () => {
    expect(spellParams('must be valid JSON: {foo}', CLI_SPELLING)).toBe('must be valid JSON: {foo}');
    expect(spellParams('Append { urlPrefix: <value> }', CLI_SPELLING)).toBe('Append { urlPrefix: <value> }');
    expect(spellParams('{@ id}', CLI_SPELLING)).toBe('{@ id}');
  });
});

describe('spellOutcome', () => {
  it('spells a schema failure in both places it is stated', () => {
    const outcome: CommandOutcome = {
      status: 'error',
      code: 'SCHEMA_VALIDATION',
      message: 'markdown: position: {@position} must be a non-negative integer',
      data: { issues: [{ path: 'position', message: '{@position} must be a non-negative integer' }] },
    };

    const spelled = spellOutcome(outcome, CLI_SPELLING);
    expect(spelled).toMatchObject({
      message: 'markdown: position: --position must be a non-negative integer',
      data: { issues: [{ path: 'position', message: '--position must be a non-negative integer' }] },
    });
  });

  it('passes structured data that is not an issue list through untouched', () => {
    const data = { path: 'guide.json', availableIds: ['{a}', 'b'] };
    const spelled = spellOutcome({ status: 'error', code: 'ID_NOT_FOUND', message: 'no {@id}', data }, CLI_SPELLING);
    expect(spelled.status === 'error' && spelled.data).toEqual(data);
  });

  it('spells every reader-facing string on a success', () => {
    const spelled = spellOutcome(
      {
        status: 'ok',
        summary: 'added under {@parent}',
        text: 'reparented via {@into}',
        hints: ['set {@id} to address it'],
        warnings: [{ code: 'UNVERIFIED_SELECTOR', message: 'check {@reftarget}' }],
      },
      CLI_SPELLING
    );
    expect(spelled).toMatchObject({
      summary: 'added under --parent',
      text: 'reparented via --into',
      hints: ['set --id to address it'],
      warnings: [{ message: 'check --reftarget' }],
    });
  });
});
