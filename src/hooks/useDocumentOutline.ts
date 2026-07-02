import { useEffect, useState } from 'react';
import { slugify, uniqueSlug } from '../utils/slug';

export interface OutlineItem {
  id: string;
  text: string;
  level: number;
  kind: 'heading' | 'section';
}

const OUTLINE_SELECTOR = 'h2, h3, h4, [data-interactive-section="true"]';
const SECTION_TITLE_SELECTOR = '.interactive-section-title';

function normalizeText(text: string): string {
  return text.trim().toLowerCase();
}

function extractOutline(container: HTMLElement): OutlineItem[] {
  const taken = new Set<string>();
  container.querySelectorAll('[id]').forEach((el) => {
    if (el.id) {
      taken.add(el.id);
    }
  });

  const elements = Array.from(container.querySelectorAll<HTMLElement>(OUTLINE_SELECTOR));
  const items: OutlineItem[] = [];

  for (const el of elements) {
    const isSection = el.getAttribute('data-interactive-section') === 'true';
    const text = (isSection ? el.querySelector(SECTION_TITLE_SELECTOR)?.textContent : el.textContent)?.trim() ?? '';
    if (!text) {
      continue;
    }

    let id = el.id;
    if (!id) {
      id = uniqueSlug(slugify(text), taken);
      el.id = id;
      taken.add(id);
    }

    const kind: OutlineItem['kind'] = isSection ? 'section' : 'heading';
    const level = isSection ? 2 : Number(el.tagName.charAt(1));

    // A section's title is often preceded by an identical markdown heading acting as
    // its lead-in (see e.g. bundled-interactives/first-dashboard) — collapse that pair
    // into a single entry rather than showing the same title twice in a row.
    const previous = items[items.length - 1];
    if (previous?.kind === 'heading' && kind === 'section' && normalizeText(previous.text) === normalizeText(text)) {
      items.pop();
    }

    items.push({ id, text, level, kind });
  }

  return items.length >= 2 ? items : [];
}

export function useDocumentOutline(
  containerRef: React.RefObject<HTMLDivElement>,
  contentKey: string | null,
  ready: boolean
): OutlineItem[] {
  const [outline, setOutline] = useState<OutlineItem[]>([]);

  useEffect(() => {
    if (!ready || !containerRef.current) {
      setOutline([]);
      return;
    }
    setOutline(extractOutline(containerRef.current));
  }, [containerRef, contentKey, ready]);

  return outline;
}
