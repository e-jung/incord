/** Punctuation is presentation, not a word. Internal apostrophes and hyphens stay. */
export function tokenize(text: string): string[] {
  return text.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:[’'ʼ‐‑-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*(?:(?<=\p{N})[.,]\p{N}+)*/gu) ?? [];
}

const SMALL_INITIALS = ['z', 'o', 't', 't', 'f', 'f', 's', 's', 'e', 'n', 't', 'e', 't', 't', 'f', 'f', 's', 's', 'e', 'n'];
const TENS_INITIALS = ['', '', 't', 't', 'f', 'f', 's', 's', 'e', 'n'];

function numberInitial(digits: string): string {
  // The highest English group leads: 1,200 = one thousand; 23 = twenty-three.
  const integer = digits.replace(/,/g, '').split('.')[0]!.replace(/^0+(?=\d)/, '');
  const groupLength = ((integer.length - 1) % 3) + 1;
  const group = Number(integer.slice(0, groupLength));
  if (group >= 100) return SMALL_INITIALS[Math.floor(group / 100)]!;
  if (group < 20) return SMALL_INITIALS[group]!;
  return TENS_INITIALS[Math.floor(group / 10)]!;
}

/** Accepted physical/on-screen keys; numeric words accept digit OR English initial. */
export function firstLetters(word: string): string[] {
  const clean = word.replace(/^[^\p{L}\p{N}]+/u, '');
  if (!clean) return [];
  const numeric = clean.match(/^\d[\d,]*(?:\.\d+)?/);
  if (numeric) return [clean[0]!, numberInitial(numeric[0])];
  return [Array.from(clean)[0]!.toLocaleLowerCase('en-US')];
}

export function matchesFirstLetter(word: string, key: string): boolean {
  return firstLetters(word).includes(key.toLocaleLowerCase('en-US'));
}

export interface DisplayToken { word: string; text: string; separator: string }

/** Keep punctuation beside its word and preserve the original spacing exactly.
 * Opening quotes/brackets belong to the following word, dashes never add a word.
 */
export function displayTokens(text: string): DisplayToken[] {
  const words = tokenize(text);
  const starts: number[] = [];
  let cursor = 0;
  for (const word of words) {
    starts.push(text.indexOf(word, cursor));
    cursor = starts.at(-1)! + word.length;
  }
  const boundaries = starts.map((start, i) => {
    if (!i) return 0;
    const end = starts[i - 1]! + words[i - 1]!.length;
    const gap = text.slice(end, start);
    // Curly opening quotes and brackets are unambiguous. Straight quotes open
    // after whitespace or a dash (apostrophes within words never reach here).
    const opening = /[“‘([{]|(?:^|[\s—–-])["']/u.exec(gap);
    if (!opening) return start;
    const offset = opening[0].length - 1;
    return end + opening.index + offset;
  });
  return words.map((word, i) => {
    const segment = text.slice(boundaries[i], boundaries[i + 1] ?? text.length);
    const separator = i + 1 < words.length ? segment.match(/\s*$/u)![0] : '';
    return { word, text: separator ? segment.slice(0, -separator.length) : segment, separator };
  });
}

/** Visible mistakes get feedback but only hidden words affect memory scoring. */
export function attemptFeedback(word: string, key: string, hidden: boolean): { slipped: boolean; scoredSlip: boolean } {
  const slipped = !matchesFirstLetter(word, key);
  return { slipped, scoredSlip: hidden && slipped };
}
