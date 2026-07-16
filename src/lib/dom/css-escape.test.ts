import { describe, it, expect } from '@jest/globals';
import { escapeCssAttributeValue } from './css-escape';

describe('escapeCssAttributeValue', () => {
  it('returns plain values unchanged', () => {
    expect(escapeCssAttributeValue('data-testid RefreshPicker run button')).toBe(
      'data-testid RefreshPicker run button'
    );
  });

  it('escapes single quotes for the default single-quote delimiter', () => {
    expect(escapeCssAttributeValue("Mark's dashboard")).toBe("Mark\\'s dashboard");
    expect(escapeCssAttributeValue("Mark's dashboard")).not.toContain('\\"');
  });

  it('escapes double quotes for the double-quote delimiter and leaves single quotes alone', () => {
    expect(escapeCssAttributeValue('He said "hi"', '"')).toBe('He said \\"hi\\"');
    expect(escapeCssAttributeValue("Mark's dashboard", '"')).toBe("Mark's dashboard");
  });

  it('escapes backslashes before quotes so existing backslashes are not double-processed', () => {
    expect(escapeCssAttributeValue("a\\'b")).toBe("a\\\\\\'b");
  });

  it('handles mixed and consecutive quotes', () => {
    expect(escapeCssAttributeValue(`He said 'hello' and "goodbye"`)).toBe(`He said \\'hello\\' and "goodbye"`);
    expect(escapeCssAttributeValue(`''`)).toBe(`\\'\\'`);
  });

  it('handles quotes at value boundaries', () => {
    expect(escapeCssAttributeValue("'start")).toBe("\\'start");
    expect(escapeCssAttributeValue("end'")).toBe("end\\'");
  });

  it('passes through empty strings and unicode unchanged', () => {
    expect(escapeCssAttributeValue('')).toBe('');
    expect(escapeCssAttributeValue('François™ Dashboard')).toBe('François™ Dashboard');
  });

  it('round-trips through querySelectorAll', () => {
    const value = `quote ' double " and backslash \\ value`;
    const el = document.createElement('div');
    el.setAttribute('data-testid', value);
    document.body.appendChild(el);

    const singleQuoted = `[data-testid='${escapeCssAttributeValue(value)}']`;
    const doubleQuoted = `[data-testid="${escapeCssAttributeValue(value, '"')}"]`;
    expect(Array.from(document.querySelectorAll(singleQuoted))).toContain(el);
    expect(Array.from(document.querySelectorAll(doubleQuoted))).toContain(el);

    el.remove();
  });
});
