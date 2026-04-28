/**
 * TipTap's Markdown serializer normalizes the indentation of fenced code block
 * markers, stripping the leading whitespace from opening/closing fence lines
 * while leaving the content lines at their original indentation. This produces
 * invalid CommonMark when code blocks appear inside nested list items (where
 * fences must be indented to match the list continuation indent).
 *
 * This function post-processes TipTap Markdown output to re-align fence markers
 * with the actual indentation of the first non-blank content line inside the fence.
 */
export function normalizeCodeIndentation(markdown: string): string {
  const lines = markdown.split('\n');
  const openingFenceRegex = /^(\s*)(`{3,}|~{3,})(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }

    const openingMatch = line.match(openingFenceRegex);
    if (!openingMatch) {
      continue;
    }

    const fenceMarker = openingMatch[2];
    if (!fenceMarker) {
      continue;
    }

    const fenceChar = fenceMarker.charAt(0);
    const fenceLength = fenceMarker.length;
    const fenceInfo = openingMatch[3] ?? '';

    // Find the matching closing fence
    let closingIndex = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const innerLine = lines[j];
      if (innerLine === undefined) {
        continue;
      }
      const closingMatch = innerLine.match(/^(\s*)(`{3,}|~{3,})\s*$/);
      if (!closingMatch) {
        continue;
      }
      const closingFence = closingMatch[2];
      if (!closingFence) {
        continue;
      }
      if (closingFence.charAt(0) === fenceChar && closingFence.length >= fenceLength) {
        closingIndex = j;
        break;
      }
    }

    if (closingIndex === -1) {
      continue;
    }

    // Detect the indentation of the first non-blank content line
    let contentIndent = '';
    for (let j = i + 1; j < closingIndex; j++) {
      const innerLine = lines[j];
      if (innerLine === undefined || innerLine.trim().length === 0) {
        continue;
      }
      const indentMatch = innerLine.match(/^(\s*)/);
      contentIndent = indentMatch?.[1] ?? '';
      break;
    }

    // Re-align fence markers to match content indentation
    lines[i] = `${contentIndent}${fenceChar.repeat(fenceLength)}${fenceInfo}`;
    lines[closingIndex] = `${contentIndent}${fenceChar.repeat(fenceLength)}`;

    // Skip past this fence block so nested fences aren't re-processed
    i = closingIndex;
  }

  return lines.join('\n');
}
