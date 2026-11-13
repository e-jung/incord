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
