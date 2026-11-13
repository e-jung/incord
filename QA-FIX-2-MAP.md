# Independent QA fix batch 2

All 53 QA findings are addressed. Follow-up integration review in d8e63cf also covered OAuth identity acquisition, removed-item consent, local-day slot accounting and consuming dismissed-sheet history. No product decisions deferred or disagreed with. QA covered the pre-fix build; previously corrected copy/layout was retained and reverified. No push/deployment and no writes to byheart-qa.

| QA id | Fix / regression evidence |
|---|---|
| P0-1 | e4d9bdd: third-height current-word scroll; presentation matrix + own 120-word/Heidelberg E2E |
| P0-2 | 7250c83 / 1ea1b11: unique tombstone revival; store and collection remove/Undo/re-add tests |
| P0-3 | 7250c83 / 1ea1b11: cached identity, independent config, reconnect/focus/visibility; offline reconnect E2E |
| P1-1 | 1ea1b11: detached shortcut; close-shortcut persistence regression |
| P1-2 | 1ea1b11 / b81f169: result appears after immediate persistence; result-close regression |
| P1-3 | 1ea1b11: blank no-stakes rehearsal; schedule/history snapshot regression |
| P1-4 | 3b3f44c: FSRS short term disabled; first Good/Easy day-interval tests |
| P1-5 | 1ea1b11: new/learning cap and word/step estimate; daily unit + cap/Start early E2E |
| P1-6 | 1ea1b11: four friendly review titles and next date; four grade E2Es |
| P1-7 | 60a29da / e4d9bdd / 1ea1b11: visible amber/shake feedback; hidden-only scoring tests |
| P1-8 | a8980de / e4d9bdd: human-readable source labels; screenshot assertions |
| P1-9 | 1ea1b11: unique named real collections; My verses/My texts/document E2Es |
| P1-10 | 1ea1b11 / b81f169: default passage, separate toggle, four-verse chunks, >20 confirm; four range E2Es |
| P1-11 | 962ca10: 12 Apostles articles, 17 Nicene clauses, >150-word answer parts; content verification |
| P1-12 | 962ca10: Psalm heading separation, singular Psalm titles; source reconstruction test |
| P1-13 | 962ca10: single-chapter shorthand and explicit forms; content verification |
| P1-14 | 60a29da / e4d9bdd: punctuation-preserving display tokens; quote/dash tests |
| P1-15 | 962ca10 / 1ea1b11: friendly uncached-book error; offline E2E |
| P1-16 | 1ea1b11: row options, confirmation and five-second Undo; collection E2E |
| P1-17 | ac00b4e / 1ea1b11: recovery preserves sessions, explicit Sign out everywhere; real WebAuthn API test |
| P1-18 | 7250c83 / ac00b4e / 1ea1b11: changed-field clocks and per-field merge; store/API tests |
| P1-19 | 1ea1b11: signout clears device, explicit merge/discard decisions; Add/Keep separate E2Es |
| P1-20 | a8980de / e4d9bdd: one plural helper and count assertions |
| P1-21 | a8980de / 1ea1b11: item counts, never falsely word counts; collection assertions |
| P1-22 | e4d9bdd: readable untyped passage ink; theme presentation tests |
| P1-23 | 1ea1b11: learned-only welcome with real capped count; empty-return and learned-return tests |
| P2-1 | e4d9bdd: 44px controls and two-row numeric keyboard; presentation geometry tests |
| P2-2 | e4d9bdd: readable tabs/week labels/cover/hero contrast |
| P2-3 | a8980de: labeled initial/person avatar opens Account |
| P2-4 | e4d9bdd: drawn check-circle/books/compass SVG icons |
| P2-5 | a8980de: single-line rhythm above dots; 375px journey |
| P2-6 | a8980de / e4d9bdd: compact segmented Discover; 375px journey |
| P2-7 | 1ea1b11: numbered questions, collapsed answers, Lord's Days and confirmed bulk actions |
| P2-8 | 1ea1b11: preview sheet and Added marker/open-existing collection; starter journeys |
| P2-9 | 1ea1b11: actual-added count and duplicate notice |
| P2-10 | 1ea1b11: own-text success retained on destination collection |
| P2-11 | 1ea1b11: read-along result explains words will hide |
| P2-12 | 1ea1b11: final result shows next review, no nonexistent next step |
| P2-13 | 1ea1b11: explicit Review date with short month |
| P2-14 | 1ea1b11: navigation scroll reset; history E2E |
| P2-15 | 1ea1b11 / d8e63cf / b81f169: tab/detail/sheet history and guarded root; history E2E |
| P2-16 | ac00b4e / 1ea1b11: searchable supported-zone select + Worker validation |
| P2-17 | 7250c83 / ac00b4e / a8980de: trimmed names/person fallback and server/export display name |
| P2-18 | 1ea1b11: mutually cleared notices, friendly canceled-passkey error |
| P2-19 | ac00b4e: friendly deleted/unknown account passkey message |
| P2-20 | 7250c83 / 1ea1b11: stable canonical item order independent of sync arrival |
| P2-21 | 1ea1b11: cap applied before welcome choice |
| P2-22 | e4d9bdd: assetsInlineLimit 0; production CSS has no data-font URL |
| P2-23 | ac00b4e: anonymous me = 200 user:null; API test |
| P2-24 | 962ca10: dotted and space verse references; content verification |
| P2-25 | a8980de / 1ea1b11: factual, informative copy and results |
| P2-26 | e4d9bdd / 1ea1b11: semantic copy.ts + plural helper; numeric ui map removed |
| P2-27 | 1ea1b11 / 8d198c7: DEV/device-debug gallery gate; production gate E2E |
