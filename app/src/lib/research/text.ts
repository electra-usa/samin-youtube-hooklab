// Tokenizing and FTS5 query building for title search (the library's videos_fts
// uses the porter + unicode61 tokenizer, so query terms are stemmed the same way).

const STOPWORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being below between both but by
  can can't cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't
  have haven't having he he'd he'll he's her here here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't
  it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own
  same shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there there's
  these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd we'll we're we've were
  weren't what what's when when's where where's which while who who's whom why why's with won't would wouldn't you you'd you'll you're
  you've your yours yourself yourselves just get got really still also ever every even vs via will`.split(/\s+/).filter(Boolean),
);

// Extra filler that carries no topic in a *reference title* (kept for typed queries).
const TITLE_FILLER = new Set(
  `video videos watch new best top full official ep episode part live shorts short official clip clips ft feat ultimate guide complete
  thing things way ways time times day days year years make made making everyone nobody something nothing actually finally`.split(/\s+/),
);

/** Lowercased word tokens (letters/digits, inner apostrophes kept). */
export function wordTokens(text: string): string[] {
  return (text.toLowerCase().replace(/[‘’]/g, "'").match(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu) ?? []).filter((t) => t.length > 0);
}

/** Topic-bearing terms of a query or title, de-duplicated, in order. */
export function topicTerms(text: string, opts: { fromTitle?: boolean; max?: number } = {}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of wordTokens(text)) {
    if (STOPWORDS.has(t) || seen.has(t)) continue;
    if (opts.fromTitle && (TITLE_FILLER.has(t) || /^\d+$/.test(t))) continue;
    if (t.length < 2 && !/\d/.test(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, opts.max ?? 16);
}

const quote = (term: string) => `"${term.replace(/"/g, '""')}"`;

/** All words must appear in the title (quoted phrases stay phrases). Null when nothing searchable. */
export function keywordMatch(query: string): string | null {
  const parts: string[] = [];
  const phraseRe = /"([^"]+)"/g;
  let rest = query;
  for (const m of query.matchAll(phraseRe)) {
    const words = wordTokens(m[1]);
    if (words.length) parts.push(quote(words.join(" ")));
    rest = rest.replace(m[0], " ");
  }
  for (const w of wordTokens(rest)) parts.push(quote(w));
  if (!parts.length) return null;
  return `title : (${parts.join(" AND ")})`;
}

/** Any topic term may match; the whole phrase is added so titles containing it rank first. */
export function topicMatch(terms: string[], phrase?: string): string | null {
  if (!terms.length) return null;
  const parts = terms.map(quote);
  const phraseWords = phrase ? wordTokens(phrase) : [];
  if (phraseWords.length > 1 && phraseWords.length <= 8) parts.unshift(quote(phraseWords.join(" ")));
  return `title : (${parts.join(" OR ")})`;
}
