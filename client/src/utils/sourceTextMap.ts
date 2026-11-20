/** Searchable rendered text with a reversible map to original UTF-16 offsets. */
export type TextMap = { text: string; offsets: number[]; ends: number[] };
export type TextMatch = { start: number; end: number };

export function mapText(input: string, latex = false): TextMap {
  const map: TextMap = { text: '', offsets: [], ends: [] };
  // Ignore syntax that cannot appear in the PDF. Keep formatting arguments
  // (e.g. \\textbf{...}) so a selection can cross formatting boundaries.
  const hidden = latex
    ? /(?<!\\)%[^\n]*|\\(?:begin|end|label|ref|eqref|pageref|cite\w*|includegraphics|input|include|bibliography|bibliographystyle|documentclass|usepackage|newcommand|renewcommand)(?:\s*\[[^\]]*\])?\s*\{[^}]*\}|\\[a-zA-Z@]+\*?(?:\s*\[[^\]]*\])?/g
    : null;
  let cursor = 0;
  const append = (end: number) => {
    while (cursor < end) {
      const char = String.fromCodePoint(input.codePointAt(cursor)!);
      const normalized = char.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      for (const unit of normalized) {
        map.text += unit;
        // A supplementary Unicode character occupies two UTF-16 code units.
        for (let i = 0; i < unit.length; i++) {
          map.offsets.push(cursor);
          map.ends.push(cursor + char.length);
        }
      }
      cursor += char.length;
    }
  };
  if (hidden) {
    for (const match of input.matchAll(hidden)) {
      append(match.index!);
      cursor = match.index! + match[0].length;
    }
  }
  append(input.length);
  return map;
}

export function mappedRange(map: TextMap, start: number, end: number): TextMatch | null {
  const first = map.offsets.findIndex((offset) => offset >= start);
  if (first < 0 || map.offsets[first] >= end) return null;
  let last = first;
  while (last < map.offsets.length && map.offsets[last] < end) last++;
  return { start: first, end: last };
}

/** Resolve repeated words using surrounding text; never guess ambiguous matches. */
export function matchTextRange(from: TextMap, to: TextMap, range: TextMatch): TextMatch | null {
  const needle = from.text.slice(range.start, range.end);
  if (!needle) return null;
  const candidates: Array<TextMatch & { score: number }> = [];
  let at = to.text.indexOf(needle);
  while (at !== -1) {
    let score = 0;
    for (let i = 1; i <= 80; i++) {
      if (range.start - i < 0 || at - i < 0 || from.text[range.start - i] !== to.text[at - i]) break;
      score++;
    }
    for (let i = 0; i < 80; i++) {
      if (range.end + i >= from.text.length || at + needle.length + i >= to.text.length ||
          from.text[range.end + i] !== to.text[at + needle.length + i]) break;
      score++;
    }
    candidates.push({ start: at, end: at + needle.length, score });
    at = to.text.indexOf(needle, at + 1);
  }
  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length || (candidates.length > 1 && candidates[0].score === candidates[1].score)) return null;
  return { start: candidates[0].start, end: candidates[0].end };
}
