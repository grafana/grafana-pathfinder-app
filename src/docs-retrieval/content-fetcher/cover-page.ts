// Cover-page rendering for learning-path JSON guides.
// A minimal markdown→HTML renderer plus the "what to expect" / "ready to begin"
// extras that decorate the first milestone of a learning path.
import { LearningJourneyMetadata } from '../../types/content.types';
import { sanitizeHtmlUrl } from '../../security';
import { generateJourneyContentWithExtras } from '../learning-journey-helpers';

// SVG icon matching the grafana.com learning path "what to expect" card
const LEARNING_PATH_ICON_SVG = `<svg width="30" height="30" viewBox="0 0 25 26" fill="none"><path d="M16.1401 14.4402C16.2141 14.4402 16.2852 14.4101 16.3373 14.3581c.1982-.2012 4.8531-4.95924 4.8531-9.3068C21.1904 2.26537 18.924.0 16.1391.0c-2.785.0-5.0513 2.26537-5.0513 5.0513.0 4.34756 4.6549 9.1056 4.8541 9.3068C15.9939 14.4111 16.065 14.4402 16.1401 14.4402zM13.5814 5.0513c0-1.41248 1.1452-2.55868 2.5587-2.55868 1.4135.0 2.5577 1.14519 2.5577 2.55868.0 1.41348-1.1452 2.55869-2.5577 2.55869-1.4125.0-2.5587-1.14521-2.5587-2.55869z" fill="#ff671d"/><path d="M24.9034 21.9305C24.0595 18.9113 17.9561 17.4147 12.5704 16.0933 9.54023 15.3496 5.76827 14.4246 5.73524 13.6037 5.72823 13.4225 5.97949 12.7398 9.52922 11.5516 9.80551 11.4585 9.96668 11.1842 9.91262 10.8989 9.85856 10.6136 9.60229 10.4164 9.318 10.4304 4.13956 10.6807.501743 12.1602.0482666 14.1993-.172966 15.1944.26149 16.749 3.58398 18.5009L4.29773 18.8763c2.24736 1.1782 3.87106 2.0301 3.88307 2.8229C8.19482 22.6502 5.93745 24.0507 3.72713 25.296 3.58398 25.3761 3.5139 25.5433 3.55495 25.7024 3.59699 25.8616 3.74014 25.9717 3.90431 25.9717H23.0354C23.1315 25.9717 23.2226 25.9337 23.2907 25.8656c1.4064-1.4075 1.949-2.7309 1.6127-3.9351z" fill="#fbc55a"/></svg>`;

function escapeHtmlEntities(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Minimal markdown-to-HTML for cover page content (headings, paragraphs,
 * unordered lists, and inline links). Not a full parser — just enough for
 * the structures found in learning path cover pages.
 */
export function simpleMarkdownToHtml(md: string): string {
  const lines = md.split('\n');
  const parts: string[] = [];
  let inList = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inList) {
        parts.push('</ul>');
        inList = false;
      }
      continue;
    }
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      if (inList) {
        parts.push('</ul>');
        inList = false;
      }
      const level = headingMatch[1]!.length;
      parts.push(`<h${level}>${inlineMarkdown(headingMatch[2]!)}</h${level}>`);
      continue;
    }
    const listMatch = trimmed.match(/^[-*]\s+(.*)/);
    if (listMatch) {
      if (!inList) {
        parts.push('<ul>');
        inList = true;
      }
      parts.push(`<li>${inlineMarkdown(listMatch[1]!)}</li>`);
    } else {
      if (inList) {
        parts.push('</ul>');
        inList = false;
      }
      parts.push(`<p>${inlineMarkdown(trimmed)}</p>`);
    }
  }
  if (inList) {
    parts.push('</ul>');
  }
  return parts.join('\n');
}

function inlineMarkdown(text: string): string {
  // SECURITY: process markdown links on raw text so hrefs are only escaped once
  // by sanitizeHtmlUrl (which calls escapeHtml internally). Non-link segments
  // are escaped separately via escapeHtmlEntities. (F3, F4, F6)
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  const parts: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = linkRe.exec(text)) !== null) {
    parts.push(escapeHtmlEntities(text.slice(lastIndex, match.index)));
    const label = escapeHtmlEntities(match[1]!);
    const safeHref = sanitizeHtmlUrl(match[2]!);
    if (safeHref) {
      parts.push(`<a href="${safeHref}">${label}</a>`);
    } else {
      parts.push(label);
    }
    lastIndex = match.index + match[0].length;
  }

  parts.push(escapeHtmlEntities(text.slice(lastIndex)));
  return parts.join('');
}

function wrapInOrangeOutlineList(heading: string, bodyMarkdown: string): string {
  const bodyHtml = simpleMarkdownToHtml(bodyMarkdown);
  return [
    '<div class="orange-outline-list">',
    '  <div class="icon-heading">',
    `    <div class="icon-heading__container">${LEARNING_PATH_ICON_SVG}</div>`,
    `    <div class="no-anchor-heading"><h2>${escapeHtmlEntities(heading)}</h2></div>`,
    '  </div>',
    bodyHtml,
    '</div>',
  ].join('\n');
}

const EXPECT_HEADING_RE = /^#{1,3}\s+(?:here[''\u2019]s\s+)?what\s+to\s+expect/im;
const NEXT_HEADING_RE = /^#{1,3}\s+/m;

/**
 * Inject "Ready to begin" button, bottom navigation, and orange-outline-list
 * card styling into JSON guide content for path packages.
 *
 * Existing markdown blocks are preserved as-is so the downstream renderer
 * (`parseMarkdownToElements`) handles full markdown — `**bold**`, `*italic*`,
 * code spans, etc. Only two surgical changes happen here:
 *   1. The "Here's what to expect" markdown block (if any) is wrapped in the
 *      orange-outline-list card via `wrapExpectBlockInOrangeOutline`.
 *   2. The cover-page extras (Ready to Begin button + bottom navigation) are
 *      appended as a single trailing HTML block.
 *
 * Falls back to returning the original content if parsing fails.
 */
export function injectJourneyExtrasIntoJsonGuide(jsonContent: string, metadata: LearningJourneyMetadata): string {
  try {
    const parsed = JSON.parse(jsonContent) as {
      id?: string;
      title?: string;
      blocks?: Array<{ type: string; content?: string }>;
      [key: string]: unknown;
    };
    if (!parsed.blocks || !Array.isArray(parsed.blocks)) {
      return jsonContent;
    }

    wrapExpectBlockInOrangeOutline(parsed.blocks);

    const extrasHtml = generateJourneyContentWithExtras('', metadata);
    const blocks = extrasHtml.trim() ? [...parsed.blocks, { type: 'html', content: extrasHtml }] : parsed.blocks;

    return JSON.stringify({
      ...parsed,
      blocks,
    });
  } catch {
    return jsonContent;
  }
}

/**
 * Find a markdown block containing a "Here's what to expect" heading and replace
 * it with an HTML block wrapped in the orange-outline-list card. The markdown body
 * is converted to HTML via simpleMarkdownToHtml so list items render correctly.
 *
 * Content after the next heading boundary is preserved as a separate markdown block.
 *
 */
function wrapExpectBlockInOrangeOutline(blocks: Array<{ type: string; content?: string }>): void {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.type !== 'markdown' || !block.content) {
      continue;
    }

    const match = block.content.match(EXPECT_HEADING_RE);
    if (!match) {
      continue;
    }

    const headingLine = match[0];
    const headingText = headingLine.replace(/^#{1,3}\s+/, '').trim();
    const contentBeforeHeading = block.content.slice(0, match.index!).trim();
    const afterHeading = block.content.slice(match.index! + headingLine.length).trim();

    const { body, remainder } = splitAtNextHeading(afterHeading);
    const replacement: Array<{ type: string; content: string }> = [];

    if (contentBeforeHeading) {
      replacement.push({ type: 'markdown', content: contentBeforeHeading });
    }

    let cardBody = body;
    if (!cardBody && i + 1 < blocks.length && blocks[i + 1]!.type === 'markdown' && blocks[i + 1]!.content) {
      cardBody = blocks[i + 1]!.content!;
      blocks.splice(i + 1, 1);
    }

    replacement.push({ type: 'html', content: wrapInOrangeOutlineList(headingText, cardBody || '') });

    if (remainder) {
      replacement.push({ type: 'markdown', content: remainder });
    }

    blocks.splice(i, 1, ...replacement);
    return;
  }
}

function splitAtNextHeading(text: string): { body: string; remainder: string } {
  if (!text) {
    return { body: '', remainder: '' };
  }
  const nextMatch = text.match(NEXT_HEADING_RE);
  if (!nextMatch) {
    return { body: text, remainder: '' };
  }
  if (nextMatch.index === 0) {
    return { body: '', remainder: text };
  }
  return {
    body: text.slice(0, nextMatch.index!).trim(),
    remainder: text.slice(nextMatch.index!).trim(),
  };
}
