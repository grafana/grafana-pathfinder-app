import React from 'react';
import { MarkdownManager } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { parseKioskWebUrl } from '../../security/kiosk-url';

interface Node {
  type: string;
  text?: string;
  content?: Node[];
  marks?: Array<{ type: string; attrs?: { href?: string } }>;
}
const parser = new MarkdownManager({
  extensions: [StarterKit.configure({ link: false }), Link.configure({ openOnClick: false })],
});

function render(node: Node, key: number): React.ReactNode {
  if (node.type === 'text') {
    return (
      node.marks?.reduceRight<React.ReactNode>((content, mark, index) => {
        if (mark.type === 'bold') {
          return <strong key={index}>{content}</strong>;
        }
        if (mark.type === 'italic') {
          return <em key={index}>{content}</em>;
        }
        if (mark.type === 'code') {
          return <code key={index}>{content}</code>;
        }
        const href =
          mark.type === 'link' && mark.attrs?.href
            ? parseKioskWebUrl(mark.attrs.href, window.location.origin)?.href
            : undefined;
        return href ? (
          <a
            key={index}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'inherit', textDecoration: 'underline' }}
          >
            {content}
          </a>
        ) : (
          content
        );
      }, node.text) ?? node.text
    );
  }
  const children = node.content?.map(render);
  switch (node.type) {
    case 'doc':
      return <React.Fragment key={key}>{children}</React.Fragment>;
    case 'paragraph':
      return <p key={key}>{children}</p>;
    case 'bulletList':
      return <ul key={key}>{children}</ul>;
    case 'orderedList':
      return <ol key={key}>{children}</ol>;
    case 'listItem':
      return <li key={key}>{children}</li>;
    case 'hardBreak':
      return <br key={key} />;
    default:
      return (
        <React.Fragment key={key}>
          {node.text}
          {children}
        </React.Fragment>
      );
  }
}

export function KioskMarkdown({ content }: { content: string }) {
  // Keep HTML literal; the Markdown parser must never reinterpret it as an image or link.
  return <>{render(parser.parse(content.replace(/</g, '&lt;').replace(/>/g, '&gt;')) as Node, 0)}</>;
}
