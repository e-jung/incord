# By Heart content packs

Source snapshot: 2026-11-13. Only the 66-book Protestant canon is published in Bible packs. Bible text is fetched **per book**, never the complete Bible at startup. Practice masking is a view over these words.

## Build / refresh

Run `python3 scripts/build-content.py` from the repository; verify with `node scripts/verify-content.mjs`. Python 3 standard library only; no network, npm package, API key, or external command is needed. All source bytes live in `content/raw/`; all generated JSON lives in `public/content/`. `content/source-lock.json` records exact download URLs and SHA-256 hashes. Output is deterministic UTF-8 JSON without timestamps. Commit source and generated output together.

`python3 scripts/build-content.py --download` downloads and verifies the locked snapshots. It deliberately refuses changed upstream bytes. For a content update, review the publisher's edition/license, replace only the affected lock entry and raw snapshot deliberately, regenerate, compare, and commit. The upstream source is mutable; the committed raw snapshot and hash, not the URL's current contents, define our version.

## Bible editions

| Pack | Publisher download | Status and edition |
| --- | --- | --- |
| BSB | https://bereanbible.com/bsb.txt | Berean Standard Bible, publisher's full plain text. Dedicated to public domain / CC0; see https://berean.bible/licensing.htm and the dedication in the raw text. 31,102 verse records. |
| KJV | https://ebible.org/Scriptures/eng-kjv_usfm.zip?download=1 | eBible.org King James Version, USFM edition with Strong's annotations; public domain in the USA. 31,102 verses. Publisher information: https://ebible.org/eng-kjv/copyright.htm . Rights in the Authorized Version in the United Kingdom are vested in the Crown; this pack does **not** assert a grant of UK permission. |
| WEB | https://ebible.org/Scriptures/eng-web_usfm.zip?download=1 | eBible.org World English Bible, current American English edition (not WEB Updated / British). Public domain; https://worldenglish.bible/ and https://ebible.org/eng-web/copyright.htm . 31,098 nonempty verse records; source text-critical omissions are not fabricated. World English Bible is a trademark identifying the unaltered translation. |

USFM conversion retains Scripture wording (including translator-supplied words), removes formatting, Strong's attributes, editorial section headers, footnotes/cross-references, and psalm superscription labels. Whitespace is collapsed; verse/chapter numbering remains the publisher's. BSB publisher-supplied empty records remain empty in the source representation and are excluded from lookup results. No harmonization between translations is attempted.

BSB attribution (optional publisher wording): “The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible Hub, Discovery Bible, unfoldingWord, Bible Aquifer, OpenBible.com, and the Berean Bible Translation Committee. This text of God's Word has been dedicated to the public domain.”

## Historic documents

- **Westminster Shorter Catechism**, 1647 English text, 107 Q&A. Structured transcription from https://github.com/NonlinearFruit/Creeds.json/blob/master/creeds/westminster_shorter_catechism.json ; it identifies the original edition at https://archive.org/details/bim_early-english-books-1641-1700_the-humble-advice-of-the_westminster-assembly-of-_1647_0 . The historical text is public domain. No license is asserted over that repository's software/metadata, which is not republished in the output. Not the OPC modern-English study edition.
- **Heidelberg Catechism**, full 129 Q&A, historic English translation printed in Philip Schaff's *The Creeds of Christendom*, volume III (1877), https://ccel.org/ccel/schaff/creeds3.iv.vi.html . Extract the English column from this bilingual historic edition; preserve Schaff's textual brackets in answers, including Q80. Remove footnote apparatus, page numbers and headings; join page continuations. Omit the outer editorial parentheses around Q80. Group by the standard 52 Lord's Days. This is **not** the copyrighted CRC/RCA 2011 or Canadian Reformed modern translation. The inspected Creeds.json Heidelberg transcription was intentionally not used or shipped because its historical edition could not be established.
- **Apostles' Creed**, traditional English received form in Schaff volume II (1877), https://ccel.org/ccel/schaff/creeds2.iv.i.i.i.html . Full creed is one memory item. Omit Schaff's optional “(begotten)” and bracketed explanatory glosses “Hades, spirit-world” and “flesh”; omit footnotes.
- **Nicene Creed**, traditional Western Protestant received form, Schaff volume II (1877), https://ccel.org/ccel/schaff/creeds2.iv.i.ii.ii.html . Full creed is one memory item. Include Western additions Schaff marks in brackets (including *and the Son*), remove brackets and the explanatory gloss *essence*, omit footnotes. Add a comma before *God of God* after removing its editorial brackets. This is the Niceno-Constantinopolitan creed (381), not the shorter creed of 325, and not ELLC/ICET wording.

Schaff's nineteenth-century English wording is public domain. The committed HTML is the exact archival source for reproducibility; modern CCEL navigation/scripts are not published by the app. No modern translation or copyrighted proof-text compilation is bundled.

## Schema / client interface

`src/content.ts` exports `starters`, `documents`, `books`, `translations`, and asynchronous `lookupReference(reference, translation = 'BSB')`.

Every item: `{ id, title, text, collection, translation }`; catechism items also have `number`, and Heidelberg items have `lordsDay` (1–52). Catechism title = question; text = answer. Documents/starters: `{ id, title, subtitle, color, items }`. Scripture IDs are stable `${translationLower}-${bookCode}-${chapter}-${verse}`. Documents use `wsc-N`, `heidelberg-N`, `apostles`, `nicene`. `translation` is empty for historic documents.

`public/content/<translationLower>/<osisLikeBookCode>.json` stores `{ book, translation, chapters: { [chapter]: { [verse]: text } } }`. `books.json` maps codes to display names; `manifest.json` records pack counts. The lookup accepts standard names/abbreviations, chapter ranges, verse ranges and cross-chapter ranges; invalid references throw actionable errors rather than silently truncating. Browser/service-worker caching of successfully downloaded book packs belongs to the PWA shell; in-memory deduplication is provided here. All starter items and documents are statically bundled so they are available before any Bible-book fetch.
