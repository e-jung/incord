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
source = source.replace("import {contentCopy} from './config/content-copy';", (await fs.readFile(path.join(root,'src/config/content-copy.ts'),'utf8')).replace('export const','const'));
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
assert.equal(documents[1].items.length, 129);
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
assert.equal(new Set(ids).size, 238);
assert.ok(documents[1].items[79].text.includes('accursed idolatry'));
assert.ok(documents[2].items[0].text.includes('resurrection of the body'));
assert.ok(documents[3].items[0].text.includes('proceedeth from the Father and the Son'));
console.log('Content verified: 198 book packs / 93,302 verse records; 238 document items; five starters; lazy fetching, alias/range parsing, invalid-reference rejection, and pack integrity.');
