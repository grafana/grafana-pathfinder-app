/**
 * TipTap's Markdown serializer normalizes the indentation of fenced code block
 * markers, stripping the leading whitespace from opening/closing fence lines
 * while leaving the content lines at their original indentation. This produces
 * invalid CommonMark when code blocks appear inside nested list items (where
 * fences must be indented to match the list continuation indent).
 *
 * This function post-processes TipTap Markdown output to re-align fence markers
 * with the minimum indentation across all non-blank content lines inside the fence.
 *
 * Using the minimum (rather than the first line's) indent recovers the list
 * continuation indent even when the code's own first line is more deeply
 * indented than later lines (e.g., the code starts inside a nested scope).
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

    const originalFenceIndent = openingMatch[1] ?? '';
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

    // Detect the minimum indentation across all non-blank content lines.
    // The list continuation indent is the *least* indented line inside the
    // fence; deeper indentation reflects the code's own internal structure
    // and must not be folded into the fence marker indent.
    let contentIndent = '';
    let minIndentLength = Infinity;
    for (let j = i + 1; j < closingIndex; j++) {
      const innerLine = lines[j];
      if (innerLine === undefined || innerLine.trim().length === 0) {
        continue;
      }
      const indentMatch = innerLine.match(/^(\s*)/);
      const indent = indentMatch?.[1] ?? '';
      if (indent.length < minIndentLength) {
        minIndentLength = indent.length;
        contentIndent = indent;
      }
    }

    // Re-align fence markers to match content indentation, but only when
    // TipTap has stripped the indent from a nested-list fence (original indent
    // was 0-3 spaces). If the original fence was unindented and content is
    // indented 4+ spaces, that's legitimately indented code in a flat block;
    // applying that indent to the fence would violate CommonMark's rule that
    // opening/closing fences may have at most 3 spaces of indentation.
    const maxAllowedIndent = 3;
    const shouldRealign =
      originalFenceIndent.length < minIndentLength &&
      (originalFenceIndent.length > 0 || minIndentLength <= maxAllowedIndent);

    if (shouldRealign) {
      lines[i] = `${contentIndent}${fenceChar.repeat(fenceLength)}${fenceInfo}`;
      lines[closingIndex] = `${contentIndent}${fenceChar.repeat(fenceLength)}`;
    }

    // Skip past this fence block so nested fences aren't re-processed
    i = closingIndex;
  }

  return lines.join('\n');
}
