/** Run with `node scripts/verify-content.mjs` after an offline rebuild. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFile(path.join(root, 'public/content', name), 'utf8').then(JSON.parse);
let source = await fs.readFile(path.join(root, 'src/content.ts'), 'utf8');
for (const [variable, file] of [['documentData','documents.json'],['starterData','starters.json'],['bookData','books.json']]) {
  source = source.replace(new RegExp(`import ${variable} from '[^']+';`), `const ${variable} = ${JSON.stringify(await read(file))};`);
}
const copySource = await fs.readFile(path.join(root,'src/config/copy.ts'),'utf8');
const lookupCopy = copySource.match(/export const contentCopy=[\s\S]*?} as const;/)?.[0];
assert.ok(lookupCopy, 'canonical lookup copy exists');
source = source.replace("import {contentCopy} from './config/copy';", lookupCopy.replace('export const', 'const'));
source = source.replaceAll('import.meta.env.BASE_URL', "'/'");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
let fetchCount = 0;
globalThis.fetch = async url => {
  fetchCount++;
  const relative = String(url).replace('/content/', '');
  return { ok: true, json: () => read(relative) };
};
const { lookupReference, starters, documents } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
assert.equal(documents[0].items.length, 107);
assert.equal(documents[1].items.length, 132);
assert.equal(new Set(documents[1].items.map(q => q.lordsDay)).size, 52);
assert.deepEqual(documents[1].items.filter(q => q.lordsDay === 1).map(q => q.number), [1, 2]);
assert.deepEqual(documents[1].items.filter(q => q.lordsDay === 52).map(q => q.number), [127, 128, 129]);
assert.equal(starters.length, 5);
assert.equal(starters[0].items.length, 10);
assert.equal(starters[1].items.length, 12);
assert.equal(starters[4].items.length, 6);
assert.equal(fetchCount, 0, 'starters and documents require no book download');
assert.equal((await lookupReference('Romans 8:28-30')).length, 3);
assert.equal(fetchCount, 1);
await lookupReference('Rom. 8:28');
assert.equal(fetchCount, 1, 'same book cache');
assert.match((await lookupReference('John 3:16','KJV'))[0].text, /only begotten Son/);
assert.equal((await lookupReference('John 3:36-4:2', 'KJV')).length, 3);
assert.equal((await lookupReference('Psalm 23')).length, 6);
assert.equal((await lookupReference('I John 1:9')).length, 1);
assert.equal((await lookupReference('Genesis 1-2','WEB')).length, 56);
for (const reference of ['Notabook 1:1','Romans 8:30-28','John 99','Romans 8:999','Romans 0:1','John 3:16-2:1','John 3:0','']) {
  await assert.rejects(() => lookupReference(reference), undefined, reference);
}
await assert.rejects(() => lookupReference('John 3:16','ESV'));
// P1-13 / P2-24: common reference notation, all five one-chapter books.
for (const [short, explicit] of [['Jude 3','Jude 1:3'], ['Jude 24–25','Jude 1:24-25'], ['Philemon 4','Philemon 1:4'], ['Obadiah 3','Obadiah 1:3'], ['2 John 4','2 John 1:4'], ['3 John 4','3 John 1:4'], ['John 3.16','John 3:16'], ['jn 3 16','John 3:16'], ['jn 3.16-18','John 3:16-18']]) {
  assert.deepEqual(await lookupReference(short), await lookupReference(explicit), short);
}
// P1-11: twelve articles, bounded catechism parts, no words lost at seams.
assert.equal(documents[2].items.length, 12);
assert.equal(documents[3].items.length, 17);
assert.equal(starters[3].items.length, 12);
for (const doc of documents.slice(0,2)) {
  for (const entry of doc.items) assert.ok(entry.text.split(/\s+/).length <= 150, entry.id);
}
for (const [number, wordCount, parts] of [[77,170,2],[92,345,3]]) {
  const entries=documents[1].items.filter(i => i.number === number);
  assert.equal(entries.length, parts);
  assert.equal(entries.map(i => i.text).join(' ').split(/\s+/).length, wordCount);
  entries.forEach((entry,i) => assert.match(entry.title, new RegExp(`Q${number} \\(${i+1}/${parts}\\)`)));
}
// P1-12: the first verse contains Scripture, while headings stay optional metadata.
const psalms=await read('bsb/psa.json');
assert.equal(Object.keys(psalms.headings).length,116);
assert.equal(psalms.headings['23'], 'A Psalm of David.');
for (const [chapter, start] of [['3','O LORD'],['18','I love You'],['23','The LORD is my shepherd'],['51','Have mercy'],['52','Why do you boast'],['54','Save me'],['60','You have rejected'],['75','We give thanks'],['120','In my distress']]) {
  assert.ok(psalms.chapters[chapter]['1'].startsWith(start), `Psalm ${chapter}:1`);
}
const rawBSB=await fs.readFile(path.join(root,'content/raw/bsb.txt'),'utf8');
for (const line of rawBSB.split(/\r?\n/)) {
  const verse=/^Psalm (\d+):1\t(.*)$/.exec(line);
  if (!verse) continue;
  const [, chapter, original]=verse;
  assert.equal([psalms.headings[chapter],psalms.chapters[chapter]['1']].filter(Boolean).join(' '),original.trim(), `Psalm ${chapter} heading preserves source words`);
}
assert.equal(psalms.headings['1'], undefined);
assert.match(psalms.chapters['1']['1'], /^Blessed is the man/);
assert.equal((await lookupReference('Psalm 23:1'))[0].title, 'Psalm 23:1');
assert.equal((await lookupReference('Psalm 23:1'))[0].heading, 'A Psalm of David.');
assert.ok(starters[4].items.every(i => i.title.startsWith('Psalm ') && !i.text.startsWith('A Psalm')));
// P1-15: network failure is friendly, and a failed download can be retried.
const workingFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new TypeError('Failed to fetch')};
await assert.rejects(()=>lookupReference('Isaiah 1:1'), /This book isn.t saved on this device yet. Connect once to download it./);
globalThis.fetch=workingFetch;
assert.equal((await lookupReference('Isaiah 1:1')).length,1);
const counts = {};
for (const translation of ['bsb','kjv','web']) {
  let count = 0;
  for (const book of await read('books.json')) {
    const pack = await read(`${translation}/${book.id}.json`);
    assert.equal(pack.book, book.name);
    assert.equal(pack.translation, translation.toUpperCase());
    for (const [chapter, verses] of Object.entries(pack.chapters)) {
      assert.ok(Number(chapter) > 0);
      for (const [verse, text] of Object.entries(verses)) {
        count++;
        assert.ok(Number(verse) > 0);
        assert.equal(typeof text, 'string');
        assert.ok(!text.includes('strong=') && !text.includes('\\'), `${translation}/${book.id} ${chapter}:${verse}: USFM leakage`);
      }
    }
  }
  counts[translation] = count;
}
assert.deepEqual(counts, { bsb: 31102, kjv: 31102, web: 31098 });
const ids = documents.flatMap(d => d.items.map(i => i.id));
assert.equal(new Set(ids).size, ids.length);
assert.equal(ids.length, 268);
assert.ok(documents[1].items.find(i => i.number === 80).text.includes('accursed idolatry'));
assert.ok(documents[2].items.map(i => i.text).join(' ').includes('resurrection of the body'));
assert.ok(documents[3].items.map(i => i.text).join(' ').includes('proceedeth from the Father and the Son'));
console.log('Content verified: 198 book packs / 93,302 verse records; 268 document items; five starters; lazy fetching, alias/range parsing, invalid-reference rejection, and pack integrity.');
