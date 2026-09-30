const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;

function headingsOf(lines) {
  const headings = [];
  let fence = null;
  lines.forEach((line, index) => {
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      if (fence === null) {
        fence = fenceMatch[1];
      } else if (fenceMatch[1] === fence) {
        fence = null;
      }
      return;
    }
    if (fence !== null) {
      return;
    }
    const match = line.match(HEADING_RE);
    if (match) {
      headings.push({ index, level: match[1].length, text: match[2] });
    }
  });
  return headings;
}

export function extractSection(markdown, heading) {
  const lines = markdown.split('\n');
  const headings = headingsOf(lines);
  const matches = headings.filter((candidate) => candidate.text === heading);
  if (matches.length === 0) {
    const known = headings.filter((candidate) => candidate.level > 1).map((candidate) => candidate.text);
    throw new Error(`Section not found: "${heading}". Known sections: ${known.map((text) => `"${text}"`).join(', ')}`);
  }
  if (matches.length > 1) {
    throw new Error(`Section heading is ambiguous: "${heading}" appears ${matches.length} times`);
  }
  const [start] = matches;
  const end = headings.find((candidate) => candidate.index > start.index && candidate.level <= start.level);
  return lines
    .slice(start.index, end === undefined ? lines.length : end.index)
    .join('\n')
    .trimEnd();
}

export function extractSections(markdown, headings) {
  if (headings.length === 0) {
    throw new Error('Expected at least one section heading');
  }
  return headings.map((heading) => extractSection(markdown, heading)).join('\n\n');
}
