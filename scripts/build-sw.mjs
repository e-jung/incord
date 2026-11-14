import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DEFAULT_KEY_SAMPLE} from '../public/audio/keyboard-samples.js';
// Never precache legacy formats or unused script subsets, even if a future
// CSS import accidentally emits them into dist/assets.
const shell=['/','/manifest.webmanifest','/icon-192.png',`/audio/${DEFAULT_KEY_SAMPLE}.mp3`,...readdirSync('dist/assets').filter(x=>!/^.*\.(?:woff2?|ttf|otf)$/i.test(x)||/-latin(?:-ext)?-[^.]+\.woff2$/i.test(x)).sort().map(x=>'/assets/'+x)];
const version=createHash('sha256').update(JSON.stringify(shell)).update(readFileSync(`dist/audio/${DEFAULT_KEY_SAMPLE}.mp3`)).digest('hex').slice(0,16);
const sw=readFileSync('public/sw.js','utf8').replace("const CACHE='byheart-v1';","const CACHE='byheart-"+version+"';").replace("c.addAll(['/','/manifest.webmanifest','/icon-192.png'])",'c.addAll('+JSON.stringify(shell)+')');
writeFileSync('dist/sw.js',sw);
