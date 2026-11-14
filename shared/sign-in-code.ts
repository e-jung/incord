/* Adapted from family-practice/cloudflare/auth.js.
MIT License

Copyright (c) 2026 Eric Jung

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
// 2,048 curated kid-safe compound words: 16 nature/color prefixes × 128 nouns.
// Three independent 11-bit choices plus 10,000 suffixes = 46.28 bits of entropy.
const prefixes='amber aqua autumn blue bright coral dawn fair gold green jade lilac mint silver sunny violet'.split(' ');
const nouns='acorn apple apron arch aster badger bag bamboo banana basket bay beach bean bear bee bell berry birch bird boat book breeze brook brush bubble bunny butterfly cabin cactus cake camel candle canoe carrot castle cedar cherry chick cloud clover coast cocoa comet coral cotton crane creek cricket crown daisy deer dolphin dove dragon dream duck eagle earth elm feather fern field finch firefly fish flower forest fox frog garden gem goose grape grass grove gull harbor hare hawk hazel hedgehog hill honey horse island ivy jasmine kite kitten kiwi koala lake lamb lantern lark leaf lemon lily lion lotus maple meadow melon moon moss mouse nest oak ocean olive otter owl panda peach pearl pebble pine plum pond poppy rabbit rainbow raven reed ridge river robin rose'.split(' ');
if(nouns.length!==128) throw Error('Code wordlist must contain 128 nouns');
export const CODE_WORDS=Object.freeze(prefixes.flatMap(p=>nouns.map(n=>p+n)));
export function generateSignInCode() {
  const r=crypto.getRandomValues(new Uint32Array(4));
  // Reject suffix range remainder to avoid modulo bias.
  while(r[3]>=4294960000) r[3]=crypto.getRandomValues(new Uint32Array(1))[0];
  return `${CODE_WORDS[r[0]&2047]}-${CODE_WORDS[r[1]&2047]}-${CODE_WORDS[r[2]&2047]}-${String(r[3]%10000).padStart(4,'0')}`;
}

/** Canonical concatenation; punctuation other than hyphens is not accepted. */
export const normalizeCode = (value: unknown): string => typeof value === 'string' && value.length <= 256 ? value.replace(/[-\s]/g, '').toLowerCase() : '';
const words = new Set<string>(CODE_WORDS);
// Compound words vary in length; validate concatenations by segmentation, not hyphens.
export function validCode(value: unknown): boolean {
  const code = normalizeCode(value);
  if (!/^[a-z]+[0-9]{4}$/.test(code)) return false;
  const text = code.slice(0, -4);
  let positions = new Set([0]);
  for (let part = 0; part < 3; part++) {
    const next = new Set<number>();
    for (const start of positions) for (let end = start + 5; end <= Math.min(text.length, start + 24); end++) if (words.has(text.slice(start, end))) next.add(end);
    positions = next;
  }
  return positions.has(text.length);
}
export const SIGN_IN_CODE_ENTROPY_BITS = 33 + Math.log2(10000);
