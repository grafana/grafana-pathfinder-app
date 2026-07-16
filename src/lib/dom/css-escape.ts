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
