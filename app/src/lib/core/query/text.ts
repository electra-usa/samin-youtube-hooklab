// Turning a search string into FTS5 expressions over videos_fts (porter + unicode61, so
// every quoted term is stemmed by FTS5 itself). Searches match titles only.

const STOPWORDS = new Set(
  `a about above after again against all am an and any are as at be because been before being below between both but by
  can cannot could did do does doing down during each few for from further had has have having he her here hers herself him
  himself his how i if in into is it its itself just me more most my myself no nor not of off on once only or other our ours
  ourselves out over own same she should so some such than that the their theirs them themselves then there these they this
  those through to too under until up very was we were what when where which while who whom why will with you your yours
  yourself yourselves vs via get got really still also ever even`.split(/\s+/).filter(Boolean),
);

/** Lowercased words (letters/digits; inner apostrophes kept: "don't"). */
export function wordTokens(text: string): string[] {
  return text.toLowerCase().replace(/[‘’]/g, "'").match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) ?? [];
}

/** Topic-bearing words of a query, de-duplicated, in order (stopwords dropped unless nothing else is left). */
export function topicTerms(query: string, max = 10): string[] {
  const words = wordTokens(query);
  const kept = [...new Set(words.filter((w) => !STOPWORDS.has(w) && (w.length > 1 || /\d/.test(w))))];
  return (kept.length ? kept : [...new Set(words)]).slice(0, max);
}

const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** FTS5 expression for one term or phrase, limited to the title column. */
export function titleTerm(termOrPhrase: string): string {
  return `title : ${quote(termOrPhrase)}`;
}

/** Every word must appear in the title; "quoted phrases" stay phrases. Null when nothing is searchable. */
export function keywordExpression(query: string): string | null {
  const parts: string[] = [];
  let rest = query;
  for (const m of query.matchAll(/"([^"]+)"/g)) {
    const words = wordTokens(m[1]);
    if (words.length) parts.push(quote(words.join(" ")));
    rest = rest.replace(m[0], " ");
  }
  for (const w of wordTokens(rest)) parts.push(quote(w));
  return parts.length ? `title : (${parts.join(" AND ")})` : null;
}

/** The whole query as a phrase, when it is 2–8 words long (titles containing it rank first). */
export function topicPhrase(query: string): string | null {
  const words = wordTokens(query);
  return words.length > 1 && words.length <= 8 ? words.join(" ") : null;
}
