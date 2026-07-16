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
