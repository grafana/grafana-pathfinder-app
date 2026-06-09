export function tokensFromSelector(selector: string): string[] {
  const tokens = new Set<string>();
  const stringMatches = selector.matchAll(/"([^"]+)"|'([^']+)'/g);
  for (const m of stringMatches) {
    const raw = (m[1] ?? m[2] ?? '').trim();
    if (raw) {
      tokens.add(raw);
      raw.split(/\s+/).forEach((word) => {
        if (word.length >= 3) {
          tokens.add(word);
        }
      });
    }
  }
  if (tokens.size === 0) {
    selector.split(/[\s>+~,]/).forEach((part) => {
      const cleaned = part.replace(/^[.#]/, '').trim();
      if (cleaned.length >= 3) {
        tokens.add(cleaned);
      }
    });
  }
  return Array.from(tokens).slice(0, 6);
}

export function tagFromSelector(selector: string): string | undefined {
  const trimmed = selector.trim();
  if (!trimmed || /^[[#.:]/.test(trimmed) || /^(?:grafana|panel):/i.test(trimmed)) {
    return undefined;
  }
  const match = trimmed.match(/^([a-z][a-z0-9-]*)/i);
  return match?.[1]?.toLowerCase();
}

export function describeElement(el: Element, maxText = 60): string | null {
  const text = (el.textContent ?? '').trim().slice(0, maxText);
  const testId = el.getAttribute('data-testid');
  const ariaLabel = el.getAttribute('aria-label');
  const id = el.getAttribute('id');
  const role = el.getAttribute('role');
  if (!text && !testId && !ariaLabel && !id) {
    return null;
  }
  const attrs: string[] = [];
  if (testId) {
    attrs.push(`data-testid="${testId}"`);
  }
  if (ariaLabel) {
    attrs.push(`aria-label="${ariaLabel}"`);
  }
  if (id) {
    attrs.push(`id="${id}"`);
  }
  if (role && el.tagName.toLowerCase() !== role.toLowerCase()) {
    attrs.push(`role="${role}"`);
  }
  const tag = el.tagName.toLowerCase();
  return `<${tag}> "${text}" [${attrs.join(', ')}]`;
}

export function isNavPollution(el: Element): boolean {
  const testId = el.getAttribute('data-testid') ?? '';
  const ariaLabel = el.getAttribute('aria-label') ?? '';
  if (
    /^(?:data-testid )?Nav menu /i.test(testId) ||
    /navigation mega-menu/i.test(testId) ||
    /breadcrumb/i.test(testId) ||
    /^icon-/i.test(testId)
  ) {
    return true;
  }
  if (/^Bookmark /i.test(ariaLabel) || /^Collapse section:/i.test(ariaLabel) || /^Expand section:/i.test(ariaLabel)) {
    return true;
  }
  if (el.tagName.toLowerCase() === 'svg') {
    return true;
  }
  return false;
}

export function isPathfinderInternal(el: Element): boolean {
  if (el.closest?.('[data-pathfinder-content="true"]')) {
    return true;
  }
  const testId = el.getAttribute('data-testid') ?? '';
  if (/^interactive-step-/i.test(testId)) {
    return true;
  }
  return false;
}

export function scoreCandidate(el: Element, tokens: string[]): number {
  const haystack =
    `${el.getAttribute('data-testid') ?? ''} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('id') ?? ''} ${(el.textContent ?? '').slice(0, 120)}`.toLowerCase();
  let score = 0;
  for (const tok of tokens) {
    if (tok.length < 3) {
      continue;
    }
    if (haystack.includes(tok.toLowerCase())) {
      score += 5;
    }
  }
  if (el.hasAttribute('data-testid')) {
    score += 1;
  }
  return score;
}

function nearMatches(failingReftarget: string): Array<{ attr: string; value: string; text: string }> {
  if (!failingReftarget || typeof document === 'undefined') {
    return [];
  }
  const tokens = tokensFromSelector(failingReftarget);
  const seen = new Set<string>();
  const candidates: Array<{ attr: string; value: string; text: string }> = [];
  const tryQuery = (attr: 'data-testid' | 'aria-label' | 'id', token: string) => {
    let escaped: string;
    try {
      escaped = (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(token) : token).replace(/"/g, '\\"');
    } catch {
      escaped = token.replace(/"/g, '\\"');
    }
    let matches: NodeListOf<Element>;
    try {
      matches = document.querySelectorAll(`[${attr}*="${escaped}"]`);
    } catch {
      return;
    }
    for (const el of Array.from(matches).slice(0, 8)) {
      if (isPathfinderInternal(el)) {
        continue;
      }
      const value = el.getAttribute(attr) ?? '';
      const key = `${attr}=${value}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push({ attr, value, text: (el.textContent ?? '').trim().slice(0, 60) });
      if (candidates.length >= 12) {
        return;
      }
    }
  };
  for (const token of tokens) {
    if (candidates.length >= 12) {
      break;
    }
    tryQuery('data-testid', token);
    tryQuery('aria-label', token);
    tryQuery('id', token);
  }
  return candidates;
}

export function collectDomContext(failingReftarget: string): string {
  if (typeof document === 'undefined') {
    return '';
  }
  const sections: string[] = [];
  sections.push(`Page: ${window.location.pathname}`);
  if (document.title) {
    sections.push(`Title: ${document.title}`);
  }

  const candidates = nearMatches(failingReftarget);
  if (candidates.length > 0) {
    const lines = candidates.map((c) => `- ${c.attr}="${c.value}"${c.text ? ` (text: "${c.text}")` : ''}`);
    sections.push(`Near-matches in live DOM for failing selector:\n${lines.join('\n')}`);
  } else {
    sections.push('Near-matches in live DOM for failing selector: (none — failing tokens not found)');
  }

  const toggleSelector = '[role="tab"], [aria-selected], [aria-pressed], [aria-expanded], select, [data-testid*="tab"]';
  const toggleSeen = new Set<string>();
  const toggles: string[] = [];
  for (const el of Array.from(document.querySelectorAll(toggleSelector))) {
    if (isNavPollution(el) || isPathfinderInternal(el)) {
      continue;
    }
    const line = describeElement(el);
    if (!line || toggleSeen.has(line)) {
      continue;
    }
    toggleSeen.add(line);
    toggles.push(line);
    if (toggles.length >= 12) {
      break;
    }
  }
  if (toggles.length > 0) {
    sections.push(
      `Visible tabs / toggles (activate one of these via "prepend-step" if it could reveal the missing target):\n${toggles.join('\n')}`
    );
  }

  const tokens = tokensFromSelector(failingReftarget);
  const interactiveSelector = 'button, [role="button"], a[href], input:not([type="hidden"]), [data-testid]';
  const seenSig = new Set<string>();
  const ranked: Array<{ score: number; line: string }> = [];
  for (const el of Array.from(document.querySelectorAll(interactiveSelector))) {
    if (isNavPollution(el) || isPathfinderInternal(el)) {
      continue;
    }
    if (!el.hasAttribute('data-testid') && !el.hasAttribute('aria-label') && !el.hasAttribute('id')) {
      continue;
    }
    const line = describeElement(el);
    if (!line || seenSig.has(line)) {
      continue;
    }
    seenSig.add(line);
    ranked.push({ score: scoreCandidate(el, tokens), line });
  }
  ranked.sort((a, b) => b.score - a.score);
  const described = ranked.slice(0, 35).map((r) => r.line);
  if (described.length > 0) {
    sections.push(`Interactive candidates (text + attributes, ranked by relevance):\n${described.join('\n')}`);
  }

  const headings = Array.from(document.querySelectorAll('h1,h2,h3'))
    .filter((el) => !isPathfinderInternal(el))
    .map((el) => (el.textContent ?? '').trim())
    .filter(Boolean)
    .slice(0, 8);
  if (headings.length > 0) {
    sections.push(`Headings: ${headings.join(' | ')}`);
  }

  return sections.join('\n\n');
}
