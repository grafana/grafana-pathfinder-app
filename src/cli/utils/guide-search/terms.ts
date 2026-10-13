/**
 * Term normalization for guide search: lowercase, split on non-alphanumerics,
 * drop stopwords, and apply a light suffix stemmer so "alerts", "alerting",
 * and "alert" share one term.
 */

const STOPWORDS = new Set([
  'a',
  'about',
  'all',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'available',
  'be',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'get',
  'grafana',
  'guide',
  'guides',
  'help',
  'how',
  'i',
  'in',
  'into',
  'is',
  'it',
  'learn',
  'me',
  'my',
  'need',
  'of',
  'on',
  'or',
  'our',
  'set',
  'show',
  'some',
  'step',
  'that',
  'the',
  'there',
  'this',
  'to',
  'tutorial',
  'tutorials',
  'up',
  'using',
  'want',
  'way',
  'we',
  'what',
  'with',
  'you',
  'your',
]);

const KEPT_DOUBLE_ENDINGS = new Set(['ll', 'ss', 'zz']);

export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/);
}

/** Meaningful, stemmed terms of `text`, in first-seen order without duplicates. */
export function normalizeTerms(text: string): string[] {
  const terms: string[] = [];
  for (const token of tokenize(text)) {
    if (token === '' || STOPWORDS.has(token)) {
      continue;
    }
    const term = stem(token);
    if (!terms.includes(term)) {
      terms.push(term);
    }
  }
  return terms;
}

export function stem(token: string): string {
  if (token.length <= 3 || /\d/.test(token)) {
    return token;
  }
  let term = token;
  if (term.endsWith('ies') && term.length > 4) {
    term = `${term.slice(0, -3)}y`;
  } else if (term.endsWith('sses')) {
    term = term.slice(0, -2);
  } else if (term.endsWith('ing') && term.length > 5) {
    term = undouble(term.slice(0, -3));
  } else if (term.endsWith('ed') && term.length > 4) {
    term = undouble(term.slice(0, -2));
  } else if (term.endsWith('s') && !/(ss|us|is)$/.test(term)) {
    term = term.slice(0, -1);
  }
  if (term.endsWith('e') && term.length > 4) {
    term = term.slice(0, -1);
  }
  return term;
}

function undouble(term: string): string {
  const ending = term.slice(-2);
  if (ending.length === 2 && ending[0] === ending[1] && /[b-df-hj-np-tv-z]/.test(ending[1]!)) {
    return KEPT_DOUBLE_ENDINGS.has(ending) ? term : term.slice(0, -1);
  }
  return term;
}
