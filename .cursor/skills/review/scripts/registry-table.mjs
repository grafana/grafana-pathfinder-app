export function splitTableRow(row) {
  const cells = [];
  let cell = '';
  for (const character of row.slice(1, -1)) {
    if (character !== '|') {
      cell += character;
      continue;
    }
    let precedingBackslashes = 0;
    for (let index = cell.length - 1; index >= 0 && cell[index] === '\\'; index -= 1) {
      precedingBackslashes += 1;
    }
    if (precedingBackslashes % 2 === 1) {
      cell = `${cell.slice(0, -1)}|`;
      continue;
    }
    cells.push(cell.trim());
    cell = '';
  }
  cells.push(cell.trim());
  return cells;
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
