export function splitTableRow(row) {
  return row
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

export function unquote(value) {
  return String(value ?? '').replace(/^`|`$/g, '');
}

export function findTable(markdown, requiredHeaders, { notFoundMessage } = {}) {
  const lines = markdown.split('\n');
  const headerIndex = lines.findIndex((line) => {
    if (!line.startsWith('|')) {
      return false;
    }
    const headers = splitTableRow(line).map((header) => header.toLowerCase());
    return requiredHeaders.every((required) => headers.includes(required));
  });
  if (headerIndex === -1) {
    throw new Error(notFoundMessage ?? `Table not found: ${requiredHeaders.join(', ')}`);
  }
  const headers = splitTableRow(lines[headerIndex]).map((header) => header.toLowerCase());
  const rows = [];
  for (let index = headerIndex + 2; index < lines.length && lines[index].startsWith('|'); index += 1) {
    const cells = splitTableRow(lines[index]);
    if (cells.length !== headers.length) {
      throw new Error(`Invalid table row at line ${index + 1}`);
    }
    rows.push(Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex]])));
  }
  return rows;
}
