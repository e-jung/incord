import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DEFAULT_KEY_SAMPLE } from '../public/audio/keyboard-samples.js';
// Never precache legacy formats or unused script subsets, even if a future
// CSS import accidentally emits them into dist/assets.
const shell = [
  '/',
  '/manifest.webmanifest',
  '/icon-192.png',
  `/audio/${DEFAULT_KEY_SAMPLE}.mp3`,
  ...readdirSync('dist/assets')
    .filter((x) => !/^.*\.(?:woff2?|ttf|otf)$/i.test(x) || /-latin(?:-ext)?-[^.]+\.woff2$/i.test(x))
    .sort()
    .map((x) => '/assets/' + x),
];
// Every deployed byte feeds the cache name: the worker serves cache-first, so an
// icon, manifest or content edit must retire old caches even when names stay put.
const files = readdirSync('dist', { recursive: true, withFileTypes: true })
  .filter((x) => x.isFile())
  .map((x) => join(x.parentPath, x.name))
  .filter((x) => x !== join('dist', 'sw.js'))
  .sort();
const hash = createHash('sha256').update(JSON.stringify(shell));
for (const file of files) hash.update(file).update(readFileSync(file));
const version = hash.digest('hex').slice(0, 16);
const template = readFileSync('public/sw.js', 'utf8');
const cacheMarker = /const CACHE\s*=\s*['"]byheart-v1['"];?/;
const shellMarker = /c\.addAll\(\s*\[[\s\S]*?\]\s*\)/;
if (!cacheMarker.test(template) || !shellMarker.test(template)) {
  throw new Error('Service worker build markers are missing');
}
const sw = template
  .replace(cacheMarker, "const CACHE='byheart-" + version + "';")
  .replace(shellMarker, 'c.addAll(' + JSON.stringify(shell) + ')');
writeFileSync('dist/sw.js', sw);
