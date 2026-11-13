import { describe, expect, it } from 'vitest';
import { firstLetters, matchesFirstLetter, tokenize } from './index';

describe('tokenize', () => {
  it.each([
    ['', []], ['  \n\t — “ ” … !! ', []],
    ['“In the beginning,” God created.', ['In', 'the', 'beginning', 'God', 'created']],
    ["Man's well-being isn’t self‐made or self‑taught.", ["Man's", 'well-being', 'isn’t', 'self‐made', 'or', 'self‑taught']],
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
    ['“Beginning,”', ['b']], ["Man's", ['m']], ['well-being', ['w']], ['(ISN’T)', ['i']],
    ['Éternel', ['é']], ['神', ['神']], ['', []], ['—“”!', []],
    ['0', ['0', 'z']], ['1', ['1', 'o']], ['2', ['2', 't']], ['3', ['3', 't']],
    ['4', ['4', 'f']], ['5', ['5', 'f']], ['6', ['6', 's']], ['7', ['7', 's']], ['8', ['8', 'e']], ['9', ['9', 'n']],
    ['10', ['1', 't']], ['11', ['1', 'e']], ['12', ['1', 't']], ['18', ['1', 'e']], ['19', ['1', 'n']],
    ['23', ['2', 't']], ['40', ['4', 'f']], ['90', ['9', 'n']], ['123', ['1', 'o']],
    ['2,000', ['2', 't']], ['23,000', ['2', 't']], ['1000000', ['1', 'o']],
    ['3.14', ['3', 't']], ['007', ['0', 's']], ['(42)', ['4', 'f']],
  ])('accepts initials for %s', (word, expected) => expect(firstLetters(word as string)).toEqual(expected));
  it('matches case-insensitively without allowing arbitrary letters or whole words', () => {
    expect(matchesFirstLetter('God', 'G')).toBe(true);
    expect(matchesFirstLetter('12', 'T')).toBe(true);
    expect(matchesFirstLetter('12', '1')).toBe(true);
    expect(matchesFirstLetter('12', '2')).toBe(false);
    expect(matchesFirstLetter('God', 'God')).toBe(false);
    expect(matchesFirstLetter('God', 'x')).toBe(false);
  });
});
