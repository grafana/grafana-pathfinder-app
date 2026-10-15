import React from 'react';
import { css } from '@emotion/css';
import { Alert } from '@grafana/ui';
import { MarkdownManager } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';

interface Prerequisite {
  id: string;
  label: string;
  format?: unknown;
}

interface MarkdownNode {
  type: string;
  text?: string;
  content?: MarkdownNode[];
  marks?: MarkdownMark[];
}

interface MarkdownMark {
  type: string;
  attrs?: { href?: unknown };
}

const markdownParser = new MarkdownManager({
  extensions: [StarterKit.configure({ link: false }), Link.configure({ openOnClick: false })],
});

const containerClass = css`
  margin: 0 0 16px;
`;

const listClass = css`
  margin: 0;
  padding-left: 20px;
`;

function getPrerequisites(value: unknown): Prerequisite[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is Prerequisite =>
      item !== null &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      typeof item.label === 'string' &&
      item.id.length > 0 &&
      item.label.length > 0
  );
}

function allowedHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function supportsInlineMarkdown(node: MarkdownNode): boolean {
  return (
    node.type === 'paragraph' &&
    Array.isArray(node.content) &&
    node.content.some((textNode) => textNode.type === 'text' && Boolean(textNode.text)) &&
    node.content.every(
      (textNode) =>
        textNode.type === 'text' &&
        typeof textNode.text === 'string' &&
        textNode.marks?.every((mark) => ['bold', 'italic', 'code', 'link'].includes(mark.type)) !== false
    )
  );
}

function renderMarkdownText(node: MarkdownNode, key: string): React.ReactNode {
  if (!node.marks) {
    return node.text;
  }

  return node.marks.reduceRight<React.ReactNode>((child, mark, index) => {
    const markKey = `${key}-${index}`;
    switch (mark.type) {
      case 'bold':
        return <strong key={markKey}>{child}</strong>;
      case 'italic':
        return <em key={markKey}>{child}</em>;
      case 'code':
        return <code key={markKey}>{child}</code>;
      case 'link': {
        const href = allowedHttpsUrl(mark.attrs?.href);
        return href ? (
          <a href={href} key={markKey} target="_blank" rel="noopener noreferrer">
            {child}
          </a>
        ) : (
          child
        );
      }
      default:
        return child;
    }
  }, node.text);
}

function InlineMarkdown({ label }: { label: string }) {
  const parsed = markdownParser.parse(label) as MarkdownNode;
  const paragraph = parsed.content?.length === 1 ? parsed.content[0] : undefined;

  if (!paragraph || !supportsInlineMarkdown(paragraph)) {
    return label;
  }

  return paragraph.content!.map((node, index) => renderMarkdownText(node, String(index)));
}

export function Prerequisites({ prerequisites }: { prerequisites: unknown }) {
  const items = getPrerequisites(prerequisites);
  if (items.length === 0) {
    return null;
  }

  return (
    <Alert className={containerClass} severity="info" title="Prerequisites" role="note">
      <ul className={listClass} data-testid="prerequisites-list">
        {items.map(({ id, label, format }) => (
          <li key={id}>{format === 'markdown' ? <InlineMarkdown label={label} /> : label}</li>
        ))}
      </ul>
    </Alert>
  );
}
