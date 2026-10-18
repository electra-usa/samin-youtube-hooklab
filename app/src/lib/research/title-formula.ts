// "Title Formula" search, approximated without the original's embeddings.
// A title is reduced to a skeleton: structural words ("how", "I", "never", "vs"),
// numbers and punctuation are kept; topic words collapse into an X slot.
//   "I Tried 100 AI Tools So You Don't Have To" -> i tried # X so you don't have to
//   "How I Made $10,000 in 30 Days"              -> how i made $# in # days
// Skeletons are compared with a weighted Dice score over skeleton n-grams.
// Pure module (no DB access) so it can be unit-tested with plain Node.

const STRUCTURE_WORDS = `
a an the this that these those every each all any some no none most more less few many much only just even another other such
i me my mine myself we us our ours you your yours yourself he him his she her hers they them their it its
everyone everybody nobody someone somebody anyone anybody everything nothing something anything people
in on at to for from with without of by about into onto after before until till vs versus against like than over under
between through during per off out up down around behind inside outside near across instead
and or but so because if when while then why how what which who whom whose where whether
is are was were be been being am do does did done can could will would should must may might shall
have has had get gets got getting make makes made making go goes going went gone
don't doesn't didn't can't couldn't won't wouldn't shouldn't isn't aren't wasn't weren't haven't hasn't hadn't
i'm i've i'll i'd you're you've you'll it's that's here's there's what's who's let's we're we've they're they've
not never always ever finally actually really still now again here there already almost literally officially
tried try trying tested test testing built build building quit stop stopped started start learned learn
became become becoming bought buy sold sell spent spend paid pay earned earn lost lose found find
need needs want wants know knew see saw watch watched think thought said says tell told ask asked
best worst top ultimate complete easy easiest simple simplest fastest cheapest biggest smallest hardest
secret secrets truth mistake mistakes reason reasons way ways thing things tip tips trick tricks hack hacks
rule rules sign signs step steps guide tutorial explained review reaction reacting reacts beginner beginners
hour hours day days week weeks month months year years minute minutes second seconds time times
new old first last next only free worth wrong right real fake changed change happened happens regret wish
why's isn't everything's nobody's ranking ranked rank tier list comparison compared challenge
`;

const NUMBER_WORDS = new Set(
  "one two three four five six seven eight nine ten eleven twelve fifteen twenty thirty fifty hundred thousand million billion".split(" "),
);

const KEEP = new Set(STRUCTURE_WORDS.split(/\s+/).filter(Boolean));

// Words a user types as slots in a formula query: "How I made $X with Y".
const SLOT_WORDS = new Set(["x", "y", "z", "topic", "thing", "something", "noun", "product", "niche", "person", "___", "..."]);

const TOKEN_RE = /\$?\d[\d,.]*(?:k|m|b|x|%)?|[\p{L}][\p{L}\p{M}'’]*|[?!:|()"“”—–]|\.\.\.|…|\s-\s/giu;

export type Skeleton = string[];

/** Reduce a title (or a typed formula) to its structural skeleton. */
export function titleSkeleton(raw: string, opts: { query?: boolean } = {}): Skeleton {
  const out: string[] = [];
  const push = (t: string) => {
    if (t === "X" && out[out.length - 1] === "X") return;
    out.push(t);
  };
  let text = raw.replace(/[‘’]/g, "'").replace(/\[[^\]]*\]|\{[^}]*\}|<[^>]*>/g, " X ");
  // A typed "$X" / "$N" slot is a money amount.
  if (opts.query) text = text.replace(/\$\s?[a-z]\b/gi, () => " $1 ");
  for (const m of text.matchAll(TOKEN_RE)) {
    const tok = m[0];
    const lower = tok.toLowerCase().trim();
    if (/^\$?\d/.test(tok)) {
      if (/^(19|20)\d\d$/.test(tok)) push("YEAR");
      else if (tok.startsWith("$")) push("$#");
      else if (/%$/.test(tok)) push("#%");
      else if (/x$/i.test(tok)) push("#x");
      else push("#");
      continue;
    }
    if (lower === "?" || lower === "!" || lower === ":" || lower === "|" || lower === "(" || lower === ")") {
      push(lower);
      continue;
    }
    if (lower === '"' || lower === "“" || lower === "”") {
      push('"');
      continue;
    }
    if (lower === "—" || lower === "–" || lower === "-") {
      push("—");
      continue;
    }
    if (lower === "..." || lower === "…") {
      push("…");
      continue;
    }
    const word = lower.replace(/'+$/, "");
    if (opts.query) {
      if (word === "n") {
        push("#");
        continue;
      }
      if (SLOT_WORDS.has(word)) {
        push("X");
        continue;
      }
    }
    if (NUMBER_WORDS.has(word)) push("#");
    else if (KEEP.has(word)) push(word);
    else push("X");
  }
  return out;
}

const GRAM_WEIGHTS = { u: 1, b: 2, t: 3, c: 1 } as const;

// Interchangeable formula words: "STOP doing X" ~ "NEVER do X", "I tried" ~ "I tested".
const WORD_CLASSES: Record<string, string> = {
  stop: "NEG", never: "NEG", "don't": "NEG", quit: "NEG",
  best: "SUP", worst: "SUP", top: "SUP", ultimate: "SUP", easiest: "SUP", simplest: "SUP", fastest: "SUP",
  cheapest: "SUP", biggest: "SUP", smallest: "SUP", hardest: "SUP",
  tried: "TRY", tested: "TRY", try: "TRY", test: "TRY", trying: "TRY", testing: "TRY",
  made: "GOT", earned: "GOT", got: "GOT", built: "GOT", bought: "GOT", spent: "GOT", lost: "GOT",
  this: "DEM", these: "DEM", that: "DEM", those: "DEM",
  "#": "NUM", "$#": "NUM", "#%": "NUM", "#x": "NUM",
  i: "ME", "i'm": "ME", "i've": "ME", my: "ME", we: "ME", our: "ME",
  you: "YOU", your: "YOU", "you're": "YOU",
};

/** Weighted n-gram features of a skeleton. Slots ("X") count only inside bigrams/trigrams. */
export function skeletonFeatures(skel: Skeleton): Map<string, number> {
  const feats = new Map<string, number>();
  const add = (key: string, w: number) => feats.set(key, Math.max(feats.get(key) ?? 0, w));
  const seq = ["^", ...skel, "$"];
  for (const t of skel) if (t !== "X") add(`u:${t}`, GRAM_WEIGHTS.u);
  for (let i = 0; i + 1 < seq.length; i++) add(`b:${seq[i]} ${seq[i + 1]}`, GRAM_WEIGHTS.b);
  for (let i = 0; i + 2 < seq.length; i++) add(`t:${seq[i]} ${seq[i + 1]} ${seq[i + 2]}`, GRAM_WEIGHTS.t);
  // Class-level bigrams let near-synonymous formulas meet halfway.
  const cls = seq.map((t) => WORD_CLASSES[t] ?? t);
  for (let i = 0; i + 1 < cls.length; i++) {
    if (cls[i] !== seq[i] || cls[i + 1] !== seq[i + 1]) add(`c:${cls[i]} ${cls[i + 1]}`, GRAM_WEIGHTS.c);
  }
  return feats;
}

/**
 * In-memory index over (id, title) pairs, stored in typed arrays (~80 MB per 150k titles).
 * New library rows are appended in batches without rebuilding (about 8 µs per title).
 */
export type FormulaIndex = {
  ids: string[];
  skeletonKeys: string[];
  /** Feature ids per title, flattened: offsets[i]..offsets[i+1] index into featIds. */
  offsets: Int32Array;
  featIds: Int32Array;
  totals: Float32Array;
  /** Weight of each feature id (u=1, b=2, t=3, c=1). */
  featWeight: number[];
  /** Title positions per feature id. */
  postings: (Int32Array | undefined)[];
  vocab: Map<string, number>;
};

export function createFormulaIndex(): FormulaIndex {
  return {
    ids: [],
    skeletonKeys: [],
    offsets: Int32Array.of(0),
    featIds: new Int32Array(0),
    totals: new Float32Array(0),
    featWeight: [],
    postings: [],
    vocab: new Map(),
  };
}

function concat<T extends Int32Array | Float32Array>(a: T, b: ArrayLike<number>, make: (n: number) => T): T {
  const out = make(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

export function addToFormulaIndex(index: FormulaIndex, rows: Iterable<{ id: string; title: string }>): FormulaIndex {
  const offsets: number[] = [];
  const featIds: number[] = [];
  const totals: number[] = [];
  const posts = new Map<number, number[]>();
  const base = index.featIds.length;
  for (const row of rows) {
    const skel = titleSkeleton(row.title);
    const idx = index.ids.length;
    index.ids.push(row.id);
    index.skeletonKeys.push(skel.join(" "));
    let total = 0;
    for (const [key, w] of skeletonFeatures(skel)) {
      let fid = index.vocab.get(key);
      if (fid === undefined) {
        fid = index.featWeight.length;
        index.vocab.set(key, fid);
        index.featWeight.push(w);
      }
      featIds.push(fid);
      total += w;
      const list = posts.get(fid);
      if (list) list.push(idx);
      else posts.set(fid, [idx]);
    }
    totals.push(total);
    offsets.push(base + featIds.length);
  }
  if (!offsets.length) return index;
  index.offsets = concat(index.offsets, offsets, (n) => new Int32Array(n));
  index.featIds = concat(index.featIds, featIds, (n) => new Int32Array(n));
  index.totals = concat(index.totals, totals, (n) => new Float32Array(n));
  for (const [fid, list] of posts) {
    const prev = index.postings[fid];
    index.postings[fid] = prev ? concat(prev, list, (n) => new Int32Array(n)) : Int32Array.from(list);
  }
  return index;
}

export function buildFormulaIndex(rows: Iterable<{ id: string; title: string }>): FormulaIndex {
  return addToFormulaIndex(createFormulaIndex(), rows);
}

export type FormulaMatch = { id: string; score: number };

/**
 * Rank indexed titles by formula similarity to `query` (a typed formula or a reference title).
 * Returns at most `limit` matches with score >= minScore, best first.
 */
export function matchFormula(
  index: FormulaIndex,
  query: string,
  opts: { limit?: number; minScore?: number; typed?: boolean } = {},
): FormulaMatch[] {
  const limit = opts.limit ?? 3000;
  const skel = titleSkeleton(query, { query: opts.typed });
  if (!skel.length) return [];
  const qFeats = skeletonFeatures(skel);
  const qKey = skel.join(" ");
  let qTotal = 0;
  const qWeights = new Map<number, number>();
  for (const [key, w] of qFeats) {
    qTotal += w;
    const fid = index.vocab.get(key);
    if (fid !== undefined) qWeights.set(fid, w);
  }
  const n = index.ids.length;
  if (!n) return [];
  // Candidates come from the query's rarer features; very common grams ("^ X") only add score.
  const overlap = new Float32Array(n);
  const touched: number[] = [];
  const common = Math.max(50, n * 0.2);
  let usedRare = false;
  for (const [fid, w] of qWeights) {
    const list = index.postings[fid];
    if (!list || list.length > common) continue;
    usedRare = true;
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      if (overlap[i] === 0) touched.push(i);
      overlap[i] += w;
    }
  }
  const scored: FormulaMatch[] = [];
  if (!usedRare) {
    // Only common grams (e.g. a bare topic title): fall back to identical skeletons.
    for (let i = 0; i < n && scored.length < limit; i++) {
      if (index.skeletonKeys[i] === qKey) scored.push({ id: index.ids[i], score: 1 });
    }
    return scored;
  }
  // Below ~0.3 the shared structure is mostly incidental ("X # X !").
  const minScore = opts.minScore ?? 0.3;
  for (const i of touched) {
    // Exact weighted overlap over all of the candidate's features.
    let shared = 0;
    for (let k = index.offsets[i]; k < index.offsets[i + 1]; k++) {
      // A title lists each feature once, and a feature's weight is fixed.
      shared += qWeights.get(index.featIds[k]) ?? 0;
    }
    let score = (2 * shared) / (qTotal + index.totals[i]);
    if (index.skeletonKeys[i] === qKey) score = Math.max(score, 1);
    if (score >= minScore) scored.push({ id: index.ids[i], score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
