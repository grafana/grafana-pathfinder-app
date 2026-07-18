/**
 * Escape a raw attribute value for interpolation into a quoted CSS attribute
 * selector: `[data-testid='${escapeCssAttributeValue(value)}']`.
 * Inside a CSS string only the backslash and the delimiting quote need escaping.
 */
export function escapeCssAttributeValue(value: string, quote: "'" | '"' = "'"): string {
  const escaped = value.replace(/\\/g, '\\\\');
  if (quote === '"') {
    return escaped.replace(/"/g, '\\"');
  }
  return escaped.replace(/'/g, "\\'");
}

/**
 * Render a value as a complete quoted CSS string (quotes included) for
 * attribute selectors, picking the quote style that avoids escaped quotes:
 * nwsapi (jsdom's selector engine) drops matches for backslash-escaped quotes
 * inside functional pseudos like :is(), and this codebase's selector-parsing
 * regexes ([^'"]+) mis-capture them everywhere. An escape is emitted only
 * when the value contains both quote styles.
 */
export function toCssAttributeString(value: string): string {
  const backslashEscaped = value.replace(/\\/g, '\\\\');
  if (!value.includes("'")) {
    return `'${backslashEscaped}'`;
  }
  if (!value.includes('"')) {
    return `"${backslashEscaped}"`;
  }
  return `'${backslashEscaped.replace(/'/g, "\\'")}'`;
}
