import { describe, expect, it } from 'vitest';
import {
  attemptFeedback,
  displayTokens,
  firstLetters,
  matchesFirstLetter,
  tokenize,
} from './index';

describe('tokenize', () => {
  it.each([
    ['', []],
    ['  \n\t — “ ” … !! ', []],
    ['“In the beginning,” God created.', ['In', 'the', 'beginning', 'God', 'created']],
    [
      "Man's well-being isn’t self‐made or self‑taught.",
      ["Man's", 'well-being', 'isn’t', 'self‐made', 'or', 'self‑taught'],
    ],
    ['—Grace—peace / hope; love: joy!', ['Grace', 'peace', 'hope', 'love', 'joy']],
    ['He said, “Let there be light.”', ['He', 'said', 'Let', 'there', 'be', 'light']],
    ['Éternel e\u0301ternel λόγος 神', ['Éternel', 'e\u0301ternel', 'λόγος', '神']],
    ['word,2; hope.3', ['word', '2', 'hope', '3']],
    ['Psalm 23:1; 1,000 and 3.14', ['Psalm', '23', '1', '1,000', 'and', '3.14']],
    ["'tis rock--solid", ['tis', 'rock', 'solid']],
  ])('tokenizes %j', (text, expected) => expect(tokenize(text as string)).toEqual(expected));
});

describe('firstLetters', () => {
  it.each([
    ['“Beginning,”', ['b']],
    ["Man's", ['m']],
    ['well-being', ['w']],
    ['(ISN’T)', ['i']],
    ['Éternel', ['é']],
    ['神', ['神']],
    ['', []],
    ['—“”!', []],
    ['0', ['0', 'z']],
    ['1', ['1', 'o']],
    ['2', ['2', 't']],
    ['3', ['3', 't']],
    ['4', ['4', 'f']],
    ['5', ['5', 'f']],
    ['6', ['6', 's']],
    ['7', ['7', 's']],
    ['8', ['8', 'e']],
    ['9', ['9', 'n']],
    ['10', ['1', 't']],
    ['11', ['1', 'e']],
    ['12', ['1', 't']],
    ['18', ['1', 'e']],
    ['19', ['1', 'n']],
    ['23', ['2', 't']],
    ['40', ['4', 'f']],
    ['90', ['9', 'n']],
    ['123', ['1', 'o']],
    ['2,000', ['2', 't']],
    ['23,000', ['2', 't']],
    ['1000000', ['1', 'o']],
    ['3.14', ['3', 't']],
    ['007', ['0', 's']],
    ['(42)', ['4', 'f']],
  ])('accepts initials for %s', (word, expected) =>
    expect(firstLetters(word as string)).toEqual(expected),
  );
  it('matches case-insensitively without allowing arbitrary letters or whole words', () => {
    expect(matchesFirstLetter('God', 'G')).toBe(true);
    expect(matchesFirstLetter('12', 'T')).toBe(true);
    expect(matchesFirstLetter('12', '1')).toBe(true);
    expect(matchesFirstLetter('12', '2')).toBe(false);
    expect(matchesFirstLetter('God', 'God')).toBe(false);
    expect(matchesFirstLetter('God', 'x')).toBe(false);
  });
});

describe('punctuation presentation (P1-14)', () => {
  it.each([
    ['He said, “Let there be light.”', ['He', 'said,', '“Let', 'there', 'be', 'light.”']],
    [
      'Jesus answered, “I am the way, the truth, and the life.”',
      ['Jesus', 'answered,', '“I', 'am', 'the', 'way,', 'the', 'truth,', 'and', 'the', 'life.”'],
    ],
    [
      'my prayer—it comes from lips free of deceit.',
      ['my', 'prayer—', 'it', 'comes', 'from', 'lips', 'free', 'of', 'deceit.'],
    ],
    ['he said—“it’s well-known”', ['he', 'said—', '“it’s', 'well-known”']],
    ['hope—(rock-solid) — "Quoted"', ['hope—', '(rock-solid) —', '"Quoted"']],
    ['men… ‘Man’s’', ['men…', '‘Man’s’']],
  ])('attaches opening/closing punctuation in %s', (text, expected) => {
    const tokens = displayTokens(text as string);
    expect(tokens.map((t) => t.text)).toEqual(expected);
    expect(tokens.map((t) => t.text + t.separator).join('')).toBe(text);
    expect(tokens.map((t) => t.word)).toEqual(tokenize(text as string));
  });
  it('preserves whitespace and never creates a dash word', () => {
    const text = '  “Peace”—hope.\n\n[Love]  end.  ';
    const tokens = displayTokens(text);
    expect(tokens.map((t) => t.text + t.separator).join('')).toBe(text);
    expect(tokens).toHaveLength(4);
    expect(displayTokens('— “ ”')).toEqual([]);
  });
});

describe('visible slip feedback (P1-7)', () => {
  it('marks a visible mistake without charging the hidden-word allowance', () => {
    expect(attemptFeedback('God', 'x', false)).toEqual({ slipped: true, scoredSlip: false });
    expect(attemptFeedback('God', 'x', true)).toEqual({ slipped: true, scoredSlip: true });
    expect(attemptFeedback('God', 'G', false)).toEqual({ slipped: false, scoredSlip: false });
  });
});
